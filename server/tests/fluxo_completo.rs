//! Teste de integracao: sobe o servidor de verdade e conversa com ele pelo
//! WebSocket, usando **so a API publica** do crate.
//!
//! E o complemento dos testes unitarios que ficam ao lado do codigo em
//! `src/**/tests.rs`: aqueles conferem uma peca isolada e podem ver o que e
//! privado; este confere o caminho inteiro do jeito que o cliente ve.

mod common;

use serde_json::json;

#[tokio::test]
async fn health_responde_sem_autenticacao() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), false)).await;

    let corpo = reqwest_simples(&format!("http://{addr}/health")).await;
    assert!(corpo.contains("ok"), "{corpo}");
}

#[tokio::test]
async fn conexao_nova_recebe_auth_required_com_o_nome_do_servidor() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let mut cliente = common::Client::connect(addr).await;
    let aviso = cliente.wait_for("auth.required").await;

    assert_eq!(aviso["server_name"], "Stapp de teste");
    assert_eq!(aviso["registration_enabled"], true);
    cliente.close().await;
}

#[tokio::test]
async fn registro_desligado_recusa_criar_conta() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), false)).await;

    let mut cliente = common::Client::connect(addr).await;
    cliente.wait_for("auth.required").await;
    cliente
        .send(json!({ "t": "auth.register", "username": "daniel", "password": "uma senha bem seguraa" }))
        .await;

    let erro = cliente.wait_for("auth.error").await;
    assert_eq!(erro["code"], "registration_disabled");
    cliente.close().await;
}

#[tokio::test]
async fn duas_pessoas_se_veem_conversam_e_entram_na_call() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    // --- daniel entra
    let mut daniel = common::Client::connect(addr).await;
    daniel.wait_for("auth.required").await;
    daniel
        .send(json!({ "t": "auth.register", "username": "daniel", "password": "uma senha bem seguraa" }))
        .await;

    let welcome = daniel.wait_for("welcome").await;
    assert_eq!(welcome["server_name"], "Stapp de teste");
    assert_eq!(welcome["voice"]["backend"], "mesh");
    assert_eq!(welcome["channels"].as_array().unwrap().len(), 2);

    let historico = daniel.wait_for("chat.history").await;
    assert_eq!(historico["channel"], "geral");
    assert!(historico["msgs"].as_array().unwrap().is_empty());

    // --- alice entra e daniel e avisado
    let mut alice = common::Client::connect(addr).await;
    alice.wait_for("auth.required").await;
    alice
        .send(json!({ "t": "auth.register", "username": "alice", "password": "outra senha seguraa" }))
        .await;
    alice.wait_for("welcome").await;

    let entrou = daniel.wait_for("user.online").await;
    assert_eq!(entrou["user"]["username"], "alice");

    // --- texto chega dos dois lados, com autor
    daniel
        .send(json!({ "t": "chat.send", "channel": "geral", "text": "  bora testar  " }))
        .await;

    let para_daniel = daniel.wait_for("chat.new").await;
    let para_alice = alice.wait_for("chat.new").await;
    assert_eq!(para_daniel["msg"]["text"], "bora testar");
    assert_eq!(para_alice["msg"]["author_username"], "daniel");

    // --- voz: quem chega recebe o roster, quem estava recebe o aviso
    daniel
        .send(json!({ "t": "voice.join", "channel": "sala" }))
        .await;
    let roster_daniel = daniel.wait_for("voice.roster").await;
    assert!(roster_daniel["peers"].as_array().unwrap().is_empty());

    alice
        .send(json!({ "t": "voice.join", "channel": "sala" }))
        .await;
    let roster_alice = alice.wait_for("voice.roster").await;
    let avisado = daniel.wait_for("voice.joined").await;
    assert_eq!(roster_alice["peers"].as_array().unwrap().len(), 1);
    assert_eq!(roster_alice["peers"][0]["username"], "daniel");
    assert_eq!(avisado["peer"]["username"], "alice");

    // --- sair da call limpa o roster do outro
    alice.close().await;
    let saiu = daniel.wait_for("voice.left").await;
    assert!(saiu["peer_id"].is_string());
    daniel.wait_for("user.offline").await;

    daniel.close().await;
}

#[tokio::test]
async fn o_historico_sobrevive_a_um_restart_do_servidor() {
    let dir = common::TestDir::new();

    {
        let addr = common::start(common::config(dir.database(), true)).await;
        let mut daniel = common::Client::connect(addr).await;
        daniel.wait_for("auth.required").await;
        daniel
            .send(json!({ "t": "auth.register", "username": "daniel", "password": "uma senha bem seguraa" }))
            .await;
        daniel.wait_for("welcome").await;
        daniel
            .send(json!({ "t": "chat.send", "channel": "geral", "text": "fica pra depois" }))
            .await;
        daniel.wait_for("chat.new").await;
        daniel.close().await;
    }

    // Servidor novo, mesmo arquivo de banco.
    let addr = common::start(common::config(dir.database(), false)).await;
    let mut daniel = common::Client::connect(addr).await;
    daniel.wait_for("auth.required").await;
    daniel
        .send(json!({ "t": "auth.login", "username": "daniel", "password": "uma senha bem seguraa" }))
        .await;
    daniel.wait_for("welcome").await;

    let historico = daniel.wait_for("chat.history").await;
    assert_eq!(historico["msgs"][0]["text"], "fica pra depois");
    daniel.close().await;
}

/// GET simples sem trazer um cliente HTTP so para isto.
async fn reqwest_simples(url: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let sem_esquema = url.trim_start_matches("http://");
    let (host, caminho) = sem_esquema.split_once('/').unwrap();
    let mut stream = tokio::net::TcpStream::connect(host).await.unwrap();
    stream
        .write_all(format!("GET /{caminho} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes())
        .await
        .unwrap();

    let mut resposta = String::new();
    stream.read_to_string(&mut resposta).await.unwrap();
    resposta
}
