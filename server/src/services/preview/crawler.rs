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
