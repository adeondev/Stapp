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

#[tokio::test]
async fn conversa_direta_chega_so_para_os_dois_e_conta_as_nao_lidas() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let mut daniel = entrar(addr, "daniel").await;
    let welcome_daniel = daniel.wait_for("welcome").await;
    let eu = welcome_daniel["self_user_id"].as_str().unwrap().to_string();

    // Bob antes da alice: o diretorio e uma foto do momento do welcome, entao
    // quem entra depois so aparece para quem reconectar (ou pelo user.online).
    let mut bob = entrar(addr, "bob").await;
    bob.wait_for("welcome").await;
    let mut alice = entrar(addr, "alice").await;
    let welcome_alice = alice.wait_for("welcome").await;

    // O diretorio da alice tem os outros dois, e nao ela mesma.
    let diretorio = welcome_alice["directory"].as_array().unwrap();
    let nomes: Vec<&str> = diretorio
        .iter()
        .map(|e| e["username"].as_str().unwrap())
        .collect();
    assert!(nomes.contains(&"daniel") && nomes.contains(&"bob"), "{nomes:?}");
    assert!(!nomes.contains(&"alice"), "voce nao aparece no proprio diretorio");

    let id_alice = welcome_alice["self_user_id"].as_str().unwrap().to_string();
    daniel
        .send(json!({ "t": "dm.send", "user_id": id_alice, "text": "  so pra voce  " }))
        .await;

    // O autor ve a propria mensagem, com a conversa nomeada pela outra pessoa.
    let eco = daniel.wait_for("dm.new").await;
    assert_eq!(eco["user_id"], id_alice.as_str());
    assert_eq!(eco["msg"]["text"], "so pra voce");
    assert_eq!(eco["unread"], 0);

    // A destinataria recebe com uma nao lida.
    let recebida = alice.wait_for("dm.new").await;
    assert_eq!(recebida["user_id"], eu.as_str());
    assert_eq!(recebida["msg"]["author_username"], "daniel");
    assert_eq!(recebida["unread"], 1);

    // Abrir zera, e o historico volta com a mensagem.
    alice.send(json!({ "t": "dm.open", "user_id": eu })).await;
    let historico = alice.wait_for("dm.history").await;
    assert_eq!(historico["msgs"].as_array().unwrap().len(), 1);
    assert_eq!(historico["msgs"][0]["text"], "so pra voce");
    assert_eq!(historico["msgs"][0]["kind"], "text");

    bob.close().await;
    alice.close().await;
    daniel.close().await;
}

#[tokio::test]
async fn a_conversa_espera_quem_estava_offline() {
    let dir = common::TestDir::new();

    // Alice cria a conta e sai; daniel escreve enquanto ela nao esta.
    let (id_alice, id_daniel) = {
        let addr = common::start(common::config(dir.database(), true)).await;
        let mut alice = entrar(addr, "alice").await;
        let id_alice = alice.wait_for("welcome").await["self_user_id"]
            .as_str()
            .unwrap()
            .to_string();
        alice.close().await;

        let mut daniel = entrar(addr, "daniel").await;
        let id_daniel = daniel.wait_for("welcome").await["self_user_id"]
            .as_str()
            .unwrap()
            .to_string();
        daniel
            .send(json!({ "t": "dm.send", "user_id": id_alice, "text": "te procurei" }))
            .await;
        daniel.wait_for("dm.new").await;
        daniel.close().await;
        (id_alice, id_daniel)
    };
    let _ = id_alice;

    // Servidor novo, mesmo banco: a conversa a espera na lista, ja com a nao lida.
    let addr = common::start(common::config(dir.database(), false)).await;
    let mut alice = common::Client::connect(addr).await;
    alice.wait_for("auth.required").await;
    alice
        .send(json!({ "t": "auth.login", "username": "alice", "password": SENHA }))
        .await;
    alice.wait_for("welcome").await;

    let lista = alice.wait_for("dm.list").await;
    let conversas = lista["conversations"].as_array().unwrap();
    assert_eq!(conversas.len(), 1);
    assert_eq!(conversas[0]["user_id"], id_daniel.as_str());
    assert_eq!(conversas[0]["unread"], 1);
    assert_eq!(conversas[0]["last"]["text"], "te procurei");

    alice.close().await;
}

const SENHA: &str = "uma senha bem seguraa";

/// Conecta, cria a conta e devolve o cliente logo apos o `auth.required`.
async fn entrar(addr: std::net::SocketAddr, username: &str) -> common::Client {
    let mut cliente = common::Client::connect(addr).await;
    cliente.wait_for("auth.required").await;
    cliente
        .send(json!({ "t": "auth.register", "username": username, "password": SENHA }))
        .await;
    cliente
}
