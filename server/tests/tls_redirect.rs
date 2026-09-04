use axum_server::Handle;
use std::net::SocketAddr;
use std::time::Duration;

#[tokio::test]
async fn http_redirect_server_redireciona_requisicoes_reais() {
    let handle = Handle::<SocketAddr>::new();
    let server_handle = handle.clone();
    let router = stapp_server::redirect_to_https_app(443);
    let bind_addr: SocketAddr = "127.0.0.1:0".parse().unwrap();

    let server = tokio::spawn(async move {
        axum_server::bind(bind_addr)
            .handle(server_handle)
            .serve(router.into_make_service())
            .await
            .unwrap();
    });

    let addr = handle.listening().await.expect("servidor iniciou");

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("criar cliente reqwest");

    let url = format!("http://127.0.0.1:{}/canal/geral?page=2", addr.port());
    let res = client.get(&url).send().await.expect("enviar requisicao HTTP");

    assert_eq!(res.status(), reqwest::StatusCode::MOVED_PERMANENTLY);
    assert_eq!(
        res.headers().get("location").unwrap(),
        "https://127.0.0.1/canal/geral?page=2"
    );

    handle.graceful_shutdown(Some(Duration::from_secs(1)));
    server.await.unwrap();
}

#[tokio::test]
async fn http_redirect_server_com_porta_customizada() {
    let handle = Handle::<SocketAddr>::new();
    let server_handle = handle.clone();
    let router = stapp_server::redirect_to_https_app(8443);
    let bind_addr: SocketAddr = "127.0.0.1:0".parse().unwrap();

    let server = tokio::spawn(async move {
        axum_server::bind(bind_addr)
            .handle(server_handle)
            .serve(router.into_make_service())
            .await
            .unwrap();
    });

    let addr = handle.listening().await.expect("servidor iniciou");

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("criar cliente reqwest");

    let url = format!("http://127.0.0.1:{}/api/v1/status", addr.port());
    let res = client
        .get(&url)
        .header("host", "chat.local")
        .send()
        .await
        .expect("enviar requisicao HTTP");

    assert_eq!(res.status(), reqwest::StatusCode::MOVED_PERMANENTLY);
    assert_eq!(
        res.headers().get("location").unwrap(),
        "https://chat.local:8443/api/v1/status"
    );

    handle.graceful_shutdown(Some(Duration::from_secs(1)));
    server.await.unwrap();
}
