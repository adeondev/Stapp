use super::ssrf::*;
use super::*;

#[test]
fn ssrf_bloqueia_ips_privados_e_locais() {
    assert!(!is_safe_url("http://localhost:8787"));
    assert!(!is_safe_url("http://127.0.0.1:8787"));
    assert!(!is_safe_url("http://192.168.1.1"));
    assert!(!is_safe_url("http://10.0.0.1"));
    assert!(!is_safe_url("http://169.254.169.254/latest/meta-data"));
    assert!(!is_safe_url("http://[::1]/"));
    assert!(!is_safe_url("file:///etc/passwd"));
    assert!(!is_safe_url("ftp://exemplo.com"));
}

#[test]
fn ssrf_permite_urls_publicas() {
    assert!(is_safe_url("https://github.com"));
    assert!(is_safe_url("https://stapp.chat/about"));
    assert!(is_safe_url("http://8.8.8.8/dns"));
}

#[test]
fn extrai_primeira_url_valida() {
    let text = "veja este link https://github.com e teste";
    assert_eq!(
        extract_first_url(text),
        Some("https://github.com".to_string())
    );

    let ssrf_text = "olhe http://localhost:8787 aqui";
    assert_eq!(extract_first_url(ssrf_text), None);
}

#[tokio::test]
async fn crawler_respeita_backpressure_quando_fila_enche() {
    let crawler = LinkPreviewCrawler::start(2, 1);

    let job1 = CrawlJob {
        message_id: "m1".into(),
        url: "https://stapp.chat/1".into(),
        target: CrawlTarget::Channel,
    };
    let job2 = CrawlJob {
        message_id: "m2".into(),
        url: "https://stapp.chat/2".into(),
        target: CrawlTarget::Channel,
    };
    let job3 = CrawlJob {
        message_id: "m3".into(),
        url: "https://stapp.chat/3".into(),
        target: CrawlTarget::Channel,
    };
    let job4 = CrawlJob {
        message_id: "m4".into(),
        url: "https://stapp.chat/4".into(),
        target: CrawlTarget::Channel,
    };

    let enqueued1 = crawler.enqueue(job1);
    let enqueued2 = crawler.enqueue(job2);
    let enqueued3 = crawler.enqueue(job3);
    let enqueued4 = crawler.enqueue(job4);

    // Como a fila e limitada em 2 e a concorrencia e 1, nem todos podem ser enfileirados sob rajada rapida
    assert!(enqueued1);
    // Pelo menos uma requisicao de sobrecarga sofre backpressure sem quebrar o processo
    assert!(!enqueued1 || !enqueued2 || !enqueued3 || !enqueued4);

    crawler.shutdown().await;
}

#[tokio::test]
async fn crawler_shutdown_gracioso_interrompe_novas_tarefas() {
    let crawler = LinkPreviewCrawler::start(10, 2);

    let job = CrawlJob {
        message_id: "m1".into(),
        url: "https://stapp.chat/doc".into(),
        target: CrawlTarget::Channel,
    };
    assert!(crawler.enqueue(job));

    crawler.shutdown().await;

    // Apos o shutdown, enfileiramentos sao rejeitados
    let job_after = CrawlJob {
        message_id: "m2".into(),
        url: "https://stapp.chat/doc2".into(),
        target: CrawlTarget::Channel,
    };
    assert!(!crawler.enqueue(job_after));
}

#[tokio::test]
async fn despacho_de_preview_para_canal_e_conversa_direta() {
    use crate::protocol::{ServerMsg, UrlPreview};
    use crate::test_support::TestServer;

    let server = TestServer::new(10, 6).await;
    let user_a = server.account("Daniel").await;
    let user_b = server.account("Alice").await;

    server.state.register_session("peer-a", &user_a).await.unwrap();
    server.state.register_session("peer-b", &user_b).await.unwrap();

    let mut sub_a = server.state.subscribe();
    let mut sub_b = server.state.subscribe();

    let sample_preview = UrlPreview {
        url: "https://stapp.chat".into(),
        title: Some("Stapp".into()),
        description: Some("Chat seguro e portatil".into()),
        image: None,
        site_name: Some("Stapp".into()),
    };

    // 1. Despacho para canal (broadcast)
    server
        .state
        .dispatch_link_preview("msg-channel".into(), sample_preview.clone(), &CrawlTarget::Channel)
        .await;

    let env_a = sub_a.recv().await.unwrap();
    let env_b = sub_b.recv().await.unwrap();

    assert!(matches!(
        env_a.msg,
        ServerMsg::LinkPreviewEnriched { ref message_id, .. } if message_id == "msg-channel"
    ));
    assert!(matches!(
        env_b.msg,
        ServerMsg::LinkPreviewEnriched { ref message_id, .. } if message_id == "msg-channel"
    ));

    // 2. Despacho para DM (apenas participantes)
    server
        .state
        .dispatch_link_preview(
            "msg-dm".into(),
            sample_preview,
            &CrawlTarget::Direct {
                author_id: user_a.id.clone(),
                other_id: user_b.id.clone(),
            },
        )
        .await;

    let dm_env1 = sub_a.recv().await.unwrap();
    let dm_env2 = sub_a.recv().await.unwrap();

    let targets = vec![
        match &dm_env1.target {
            crate::session::Target::Peer(p) => p.as_str(),
            _ => "",
        },
        match &dm_env2.target {
            crate::session::Target::Peer(p) => p.as_str(),
            _ => "",
        },
    ];
    assert!(targets.contains(&"peer-a"));
    assert!(targets.contains(&"peer-b"));

    server.state.shutdown().await;
}
