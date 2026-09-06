//! Fila assíncrona do crawler de links com backpressure e shutdown gracioso.

use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use reqwest::Client;
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinSet;

use crate::protocol::UserId;
use crate::session::AppState;

pub const DEFAULT_QUEUE_CAPACITY: usize = 128;
pub const DEFAULT_MAX_CONCURRENCY: usize = 4;
pub const CRAWLER_TIMEOUT: Duration = Duration::from_secs(5);
pub const CRAWLER_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const SHUTDOWN_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

/// Destino do preview enriquecido para despacho.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrawlTarget {
    /// Broadcast para todos os clientes conectados ao servidor.
    Channel,
    /// Envio exclusivo para as sessoes dos participantes da conversa direta.
    Direct {
        author_id: UserId,
        other_id: UserId,
    },
}

/// Tarefa de crawling a ser processada em background.
#[derive(Debug, Clone)]
pub struct CrawlJob {
    pub message_id: String,
    pub url: String,
    pub target: CrawlTarget,
}

/// Servico de fila e crawler assincrono de previews de URL.
pub struct LinkPreviewCrawler {
    tx: mpsc::Sender<CrawlJob>,
    shutdown_tx: watch::Sender<bool>,
    state: OnceLock<Weak<AppState>>,
    worker_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl LinkPreviewCrawler {
    /// Inicia o servico de crawler com capacidade de fila e concorrencia especificadas.
    pub fn start(queue_capacity: usize, max_concurrency: usize) -> Arc<Self> {
        let (tx, rx) = mpsc::channel(queue_capacity);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let crawler = Arc::new(Self {
            tx,
            shutdown_tx,
            state: OnceLock::new(),
            worker_handle: Mutex::new(None),
        });

        let crawler_clone = crawler.clone();
        let handle = tokio::spawn(async move {
            run_worker_loop(rx, shutdown_rx, max_concurrency, crawler_clone).await;
        });

        *crawler.worker_handle.lock().unwrap() = Some(handle);
        crawler
    }

    /// Vincula o estado da aplicacao (como Weak) para envio de eventos.
    pub fn bind_state(&self, state: Weak<AppState>) {
        let _ = self.state.set(state);
    }

    /// Enfileira uma solicitacao de crawl de URL.
    ///
    /// Se a fila estiver cheia (backpressure), o job e descartado imediatamente
    /// retornando `false`, sem travar ou atrasar a entrega de mensagens.
    pub fn enqueue(&self, job: CrawlJob) -> bool {
        match self.tx.try_send(job) {
            Ok(()) => true,
            Err(mpsc::error::TrySendError::Full(job)) => {
                tracing::warn!(
                    url = %job.url,
                    "fila de link previews cheia ({}), descartando link sob backpressure",
                    self.tx.max_capacity()
                );
                false
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                tracing::debug!("crawler ja foi encerrado, descartando job");
                false
            }
        }
    }

    /// Retorna a capacidade maxima configurada da fila.
    pub fn capacity(&self) -> usize {
        self.tx.max_capacity()
    }

    /// Executa o desligamento coordenado do crawler, aguardando scrapes em
    /// andamento ate um limite de tempo seguro.
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
        let handle = self.worker_handle.lock().unwrap().take();
        if let Some(handle) = handle {
            if let Err(err) = handle.await {
                tracing::warn!("erro ao aguardar finalizacao do worker do crawler: {err}");
            }
        }
    }
}

impl Drop for LinkPreviewCrawler {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
    }
}

async fn run_worker_loop(
    mut rx: mpsc::Receiver<CrawlJob>,
    mut shutdown_rx: watch::Receiver<bool>,
    max_concurrency: usize,
    crawler: Arc<LinkPreviewCrawler>,
) {
    let client = match Client::builder()
        .timeout(CRAWLER_TIMEOUT)
        .connect_timeout(CRAWLER_CONNECT_TIMEOUT)
        .user_agent("StappBot/1.0 (+https://stapp.chat)")
        .pool_max_idle_per_host(5)
        // Redirecionamento automatico pularia a validacao de SSRF de cada salto.
        // Quem segue a cadeia e `fetch_validating_each_hop`, revalidando o host
        // e os IPs resolvidos antes de cada conexao. Nao troque por Policy::limited.
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            tracing::error!("falha ao inicializar reqwest::Client no crawler: {err}");
            return;
        }
    };

    let semaphore = Arc::new(Semaphore::new(max_concurrency));
    let mut join_set = JoinSet::new();

    loop {
        tokio::select! {
            biased;

            res = shutdown_rx.changed() => {
                if res.is_ok() && *shutdown_rx.borrow() {
                    tracing::info!("crawler recebeu sinal de shutdown, encerrando fila");
                    break;
                }
            }

            Some(res) = join_set.join_next(), if !join_set.is_empty() => {
                if let Err(err) = res {
                    tracing::debug!("tarefa de scraping finalizada com erro: {err}");
                }
            }

            job = rx.recv() => {
                match job {
                    Some(job) => {
                        let permit = match semaphore.clone().acquire_owned().await {
                            Ok(permit) => permit,
                            Err(_) => break,
                        };

                        let client = client.clone();
                        let crawler = crawler.clone();

                        join_set.spawn(async move {
                            let _permit = permit;
                            process_crawl_job(&client, &crawler, job).await;
                        });
                    }
                    None => {
                        // Canal fechado
                        break;
                    }
                }
            }
        }
    }

    // Drena tarefas em andamento no JoinSet ate o timeout seguro
    if !join_set.is_empty() {
        let _ = tokio::time::timeout(SHUTDOWN_DRAIN_TIMEOUT, async {
            while let Some(res) = join_set.join_next().await {
                if let Err(err) = res {
                    tracing::debug!("tarefa de crawl em shutdown finalizou com erro: {err}");
                }
            }
        })
        .await;
    }
}

async fn process_crawl_job(
    client: &Client,
    crawler: &LinkPreviewCrawler,
    job: CrawlJob,
) {
    if let Some(preview) = super::scrape_metadata_with_client(client, &job.url).await
        && let Some(weak) = crawler.state.get()
        && let Some(state) = weak.upgrade()
    {
        state
            .dispatch_link_preview(job.message_id, preview, &job.target)
            .await;
    }
}

use scraper::{Html, Selector};
use url::Url;

use super::ssrf;

/// Extrai metadados de vídeo incorporável (YouTube, Vimeo, OpenGraph/Twitter player).
/// Retorna: (embed_url, provider, video_width, video_height, fallback_image, fallback_site_name).
pub fn extract_video_metadata(
    target_url: &str,
    document: Option<&Html>,
) -> (
    Option<String>,
    Option<String>,
    Option<u32>,
    Option<u32>,
    Option<String>,
    Option<String>,
) {
    let mut embed_url: Option<String> = None;
    let mut provider: Option<String> = None;
    let mut video_width: Option<u32> = None;
    let mut video_height: Option<u32> = None;
    let mut fallback_image: Option<String> = None;
    let mut fallback_site_name: Option<String> = None;

    if let Ok(parsed_target) = Url::parse(target_url) {
        if let Some(yt_id) = extract_youtube_video_id(&parsed_target) {
            embed_url = Some(format!("https://www.youtube-nocookie.com/embed/{yt_id}"));
            provider = Some("YouTube".to_string());
            video_width = Some(1280);
            video_height = Some(720);
            fallback_image = Some(format!("https://i.ytimg.com/vi/{yt_id}/hqdefault.jpg"));
            fallback_site_name = Some("YouTube".to_string());
        }
    }

    if let Some(doc) = document {
        let og_video = extract_meta_attr(doc, "meta[property='og:video:secure_url']", "content")
            .or_else(|| extract_meta_attr(doc, "meta[property='og:video:url']", "content"))
            .or_else(|| extract_meta_attr(doc, "meta[property='og:video']", "content"))
            .or_else(|| extract_meta_attr(doc, "meta[name='twitter:player']", "content"));

        if let Some(candidate_url) = og_video {
            if ssrf::is_safe_embed_url(&candidate_url) {
                if provider.is_none() {
                    provider = detect_provider_from_url(&candidate_url);
                }
                embed_url = Some(candidate_url);
            }
        }

        if let Some(w_str) = extract_meta_attr(doc, "meta[property='og:video:width']", "content")
            .or_else(|| extract_meta_attr(doc, "meta[name='twitter:player:width']", "content"))
        {
            if let Ok(w) = w_str.parse::<u32>() {
                video_width = Some(w);
            }
        }

        if let Some(h_str) = extract_meta_attr(doc, "meta[property='og:video:height']", "content")
            .or_else(|| extract_meta_attr(doc, "meta[name='twitter:player:height']", "content"))
        {
            if let Ok(h) = h_str.parse::<u32>() {
                video_height = Some(h);
            }
        }
    }

    (
        embed_url,
        provider,
        video_width,
        video_height,
        fallback_image,
        fallback_site_name,
    )
}

pub fn extract_youtube_video_id(parsed: &Url) -> Option<String> {
    let host = parsed.host_str()?.to_lowercase();
    let host = host.trim_start_matches("www.");

    if host == "youtu.be" {
        let segment = parsed.path_segments()?.next()?;
        if is_valid_video_id(segment) {
            return Some(segment.to_string());
        }
    } else if host == "youtube.com" || host == "m.youtube.com" || host == "youtube-nocookie.com" {
        let path = parsed.path();
        if path.starts_with("/watch") {
            for (k, v) in parsed.query_pairs() {
                if k == "v" && is_valid_video_id(&v) {
                    return Some(v.to_string());
                }
            }
        } else if let Some(stripped) = path.strip_prefix("/shorts/") {
            let id = stripped.split('/').next().unwrap_or("");
            if is_valid_video_id(id) {
                return Some(id.to_string());
            }
        } else if let Some(stripped) = path.strip_prefix("/embed/") {
            let id = stripped.split('/').next().unwrap_or("");
            if is_valid_video_id(id) {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn is_valid_video_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn detect_provider_from_url(url_str: &str) -> Option<String> {
    let parsed = Url::parse(url_str).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    if host.contains("youtube") || host.contains("youtu.be") {
        Some("YouTube".to_string())
    } else if host.contains("vimeo") {
        Some("Vimeo".to_string())
    } else if host.contains("twitch") {
        Some("Twitch".to_string())
    } else if host.contains("soundcloud") {
        Some("SoundCloud".to_string())
    } else if host.contains("streamable") {
        Some("Streamable".to_string())
    } else if host.contains("dailymotion") {
        Some("Dailymotion".to_string())
    } else {
        None
    }
}

fn extract_meta_attr(document: &Html, selector_str: &str, attr: &str) -> Option<String> {
    let selector = Selector::parse(selector_str).ok()?;
    let element = document.select(&selector).next()?;
    let value = element.value().attr(attr)?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
