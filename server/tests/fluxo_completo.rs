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
    assert!(
        corpo
            .to_ascii_lowercase()
            .contains("content-security-policy:")
    );
    assert!(corpo.to_ascii_lowercase().contains("x-frame-options: deny"));
}

#[tokio::test]
async fn conexao_nova_recebe_auth_required_com_o_nome_do_servidor() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let mut cliente = common::Client::connect(addr).await;
    let aviso = cliente.wait_for("auth.required").await;

    assert_eq!(aviso["server_name"], "Stapp de teste");
    assert_eq!(aviso["registration_enabled"], true);
    assert_eq!(
        aviso["protocol_version"],
        stapp_server::protocol::PROTOCOL_VERSION
    );
    assert!(aviso["server_id"].as_str().is_some_and(|id| !id.is_empty()));
    cliente.close().await;
}

#[tokio::test]
async fn refresh_rotaciona_cookie_logout_revoga_e_origem_estranha_e_rejeitada() {
    let dir = common::TestDir::new();
    let mut config = common::config(dir.database(), true);
    config
        .auth
        .allowed_origins
        .push("http://localhost:5173".into());
    let addr = common::start(config).await;

    assert_eq!(
        common::preflight(addr, "/auth/login", "http://localhost:5173").await,
        204
    );
    assert_eq!(
        common::preflight(addr, "/auth/login", "https://origem-invalida.example").await,
        403
    );

    let login = common::auth(addr, "register", "daniel", SENHA, true).await;
    assert_eq!(login.status, 200);
    let attributes = login.set_cookie.as_deref().unwrap();
    assert!(attributes.starts_with("__Secure-stapp-refresh-"));
    for attribute in [
        "Path=/auth",
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Max-Age=",
    ] {
        assert!(
            attributes.contains(attribute),
            "cookie sem {attribute}: {attributes}"
        );
    }

    let first_cookie = login.cookie.as_deref().unwrap();
    let first_access = login.body["access_token"].as_str().unwrap();
    let rotated = common::refresh(addr, first_cookie).await;
    assert_eq!(rotated.status, 200);
    assert_ne!(rotated.body["access_token"].as_str().unwrap(), first_access);
    assert_ne!(rotated.cookie.as_deref().unwrap(), first_cookie);

    // Uma resposta perdida pode repetir o token anterior durante a janela curta.
    let concurrent = common::refresh(addr, first_cookie).await;
    assert_eq!(concurrent.status, 200);
    let current_cookie = concurrent.cookie.as_deref().unwrap();

    let logout = common::logout(addr, current_cookie).await;
    assert_eq!(logout.status, 204);
    assert!(logout.set_cookie.as_deref().unwrap().contains("Max-Age=0"));
    assert_eq!(common::refresh(addr, current_cookie).await.status, 401);

    let session_cookie =
        common::auth(addr, "register", "alice", "outra senha seguraa", false).await;
    assert!(
        !session_cookie
            .set_cookie
            .as_deref()
            .unwrap()
            .contains("Max-Age=")
    );

    let tauri = common::auth_from_origin(
        addr,
        "register",
        "carol",
        "mais uma senha segura",
        true,
        "tauri://localhost",
    )
    .await;
    let tauri_cookie = tauri.set_cookie.as_deref().unwrap();
    assert!(tauri_cookie.contains("SameSite=None"));
    assert!(tauri_cookie.contains("Partitioned"));

    let dev_login = common::auth_from_origin(
        addr,
        "login",
        "daniel",
        SENHA,
        false,
        "http://localhost:5173",
    )
    .await;
    assert_eq!(dev_login.status, 200);

    let rejected = common::auth_from_origin(
        addr,
        "login",
        "daniel",
        SENHA,
        false,
        "https://origem-invalida.example",
    )
    .await;
    assert_eq!(rejected.status, 403);
}

#[tokio::test]
async fn refresh_persistente_sobrevive_a_reinicio_do_estado_do_servidor() {
    let dir = common::TestDir::new();
    let first = common::start(common::config(dir.database(), true)).await;
    let session = common::auth(first, "register", "daniel", SENHA, true).await;
    let cookie = session.cookie.as_deref().unwrap();

    // O novo AppState nao conhece os access tokens em memoria do anterior,
    // mas restaura pelo refresh armazenado apenas como hash no SQLite.
    let second = common::start(common::config(dir.database(), false)).await;
    let restored = common::refresh(second, cookie).await;
    assert_eq!(restored.status, 200);
    assert!(restored.body["access_token"].as_str().is_some());
}

#[tokio::test]
async fn duas_instancias_no_mesmo_host_usam_cookies_com_nomes_distintos() {
    let first_dir = common::TestDir::new();
    let second_dir = common::TestDir::new();
    let first = common::start(common::config(first_dir.database(), true)).await;
    let second = common::start(common::config(second_dir.database(), true)).await;

    let a = common::auth(first, "register", "daniel", SENHA, true).await;
    let b = common::auth(second, "register", "daniel", SENHA, true).await;
    let cookie_name = |response: &common::AuthResponse| {
        response
            .cookie
            .as_deref()
            .unwrap()
            .split('=')
            .next()
            .unwrap()
            .to_string()
    };
    assert_ne!(cookie_name(&a), cookie_name(&b));
}

#[tokio::test]
async fn registro_desligado_recusa_criar_conta() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), false)).await;

    let erro = common::auth(addr, "register", "daniel", SENHA, true).await;
    assert_eq!(erro.status, 403);
    assert_eq!(erro.body["code"], "registration_disabled");
}

#[tokio::test]
async fn duas_pessoas_se_veem_conversam_e_entram_na_call() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    // --- daniel entra
    let sessao_daniel = common::auth(addr, "register", "daniel", SENHA, true).await;
    let mut daniel = common::Client::connect(addr).await;
    daniel.wait_for("auth.required").await;
    daniel
        .authenticate(sessao_daniel.body["access_token"].as_str().unwrap())
        .await;

    let welcome = daniel.wait_for("welcome").await;
    assert_eq!(welcome["server_name"], "Stapp de teste");
    assert_eq!(welcome["voice"]["backend"], "mesh");
    assert_eq!(welcome["channels"].as_array().unwrap().len(), 2);

    let historico = daniel.wait_for("chat.history").await;
    assert_eq!(historico["channel"], "geral");
    assert!(historico["msgs"].as_array().unwrap().is_empty());

    // --- alice entra e daniel e avisado
    let sessao_alice = common::auth(addr, "register", "alice", "outra senha seguraa", true).await;
    let mut alice = common::Client::connect(addr).await;
    alice.wait_for("auth.required").await;
    alice
        .authenticate(sessao_alice.body["access_token"].as_str().unwrap())
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
        let sessao = common::auth(addr, "register", "daniel", SENHA, true).await;
        let mut daniel = common::Client::connect(addr).await;
        daniel.wait_for("auth.required").await;
        daniel
            .authenticate(sessao.body["access_token"].as_str().unwrap())
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
    let sessao = common::auth(addr, "login", "daniel", SENHA, true).await;
    let mut daniel = common::Client::connect(addr).await;
    daniel.wait_for("auth.required").await;
    daniel
        .authenticate(sessao.body["access_token"].as_str().unwrap())
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
        .write_all(
            format!("GET /{caminho} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
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
    assert!(
        nomes.contains(&"daniel") && nomes.contains(&"bob"),
        "{nomes:?}"
    );
    assert!(
        !nomes.contains(&"alice"),
        "voce nao aparece no proprio diretorio"
    );

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
    let sessao = common::auth(addr, "login", "alice", SENHA, true).await;
    let mut alice = common::Client::connect(addr).await;
    alice.wait_for("auth.required").await;
    alice
        .authenticate(sessao.body["access_token"].as_str().unwrap())
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

#[tokio::test]
async fn privacidade_amizade_conversa_existente_e_bloqueio_sao_autorizados_no_servidor() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;
    let mut daniel = entrar(addr, "daniel").await;
    let daniel_id = daniel.wait_for("welcome").await["self_user_id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut alice = entrar(addr, "alice").await;
    let alice_id = alice.wait_for("welcome").await["self_user_id"]
        .as_str()
        .unwrap()
        .to_string();

    alice
        .send(json!({ "t": "privacy.update", "allow_member_dms": false }))
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| msg["allow_member_dms"] == false)
        .await;
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["can_start_dm"] == false
        })
        .await;
    daniel
        .send(json!({ "t": "dm.send", "user_id": alice_id, "text": "ainda nao" }))
        .await;
    assert_eq!(daniel.wait_for("dm.denied").await["user_id"], alice_id);

    daniel
        .send(json!({ "t": "friend.request", "user_id": alice_id }))
        .await;
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "outgoing"
        })
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "incoming"
        })
        .await;
    alice
        .send(json!({ "t": "friend.accept", "user_id": daniel_id }))
        .await;
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "friend"
        })
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "friend"
        })
        .await;

    daniel
        .send(json!({ "t": "dm.send", "user_id": alice_id, "text": "agora sim" }))
        .await;
    daniel.wait_for("dm.new").await;
    alice.wait_for("dm.new").await;
    // O primeiro DM atualiza has_conversation nas duas sessoes.
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["has_conversation"] == true
        })
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["has_conversation"] == true
        })
        .await;

    daniel
        .send(json!({ "t": "friend.remove", "user_id": alice_id }))
        .await;
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "none"
        })
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "none"
        })
        .await;
    daniel
        .send(json!({ "t": "dm.send", "user_id": alice_id, "text": "historico mantem a conversa" }))
        .await;
    daniel.wait_for("dm.new").await;
    alice.wait_for("dm.new").await;

    alice
        .send(json!({ "t": "user.block", "user_id": daniel_id }))
        .await;
    alice
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["relationship"] == "blocked"
        })
        .await;
    daniel
        .wait_for_matching("social.snapshot", |msg| {
            msg["members"][0]["can_start_dm"] == false
        })
        .await;
    daniel
        .send(json!({ "t": "dm.send", "user_id": alice_id, "text": "bloqueado" }))
        .await;
    daniel.wait_for("dm.denied").await;
    daniel
        .send(json!({ "t": "call.start", "user_id": alice_id }))
        .await;
    assert_eq!(daniel.wait_for("call.ended").await["reason"], "unavailable");

    // O bloqueio nao apaga o historico existente.
    daniel
        .send(json!({ "t": "dm.open", "user_id": alice_id }))
        .await;
    assert_eq!(
        daniel.wait_for("dm.history").await["msgs"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    alice.close().await;
    daniel.close().await;
}

#[tokio::test]
async fn o_perfil_editado_chega_nos_outros_sem_reconectar() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let mut daniel = entrar(addr, "daniel").await;
    let welcome = daniel.wait_for("welcome").await;
    let eu = welcome["self_user_id"].as_str().unwrap().to_string();

    // O welcome ja traz o perfil de quem entrou, com o padrao.
    let meu = welcome["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["user_id"] == eu.as_str())
        .expect("o proprio perfil vem no welcome");
    assert_eq!(meu["display_name"], "daniel");
    assert_eq!(meu["accent"], "blue");
    assert_eq!(meu["has_avatar"], false);

    let mut alice = entrar(addr, "alice").await;
    alice.wait_for("welcome").await;

    // Alice edita; daniel recebe sem pedir nada.
    alice
        .send(json!({
            "t": "profile.update",
            "display_name": "Alice do Stapp",
            "accent": "purple",
            "bio": "bio de teste"
        }))
        .await;

    let evento = daniel.wait_for("user.profile").await;
    assert_eq!(evento["profile"]["display_name"], "Alice do Stapp");
    assert_eq!(evento["profile"]["accent"], "purple");
    assert_eq!(evento["profile"]["bio"], "bio de teste");
    // O username continua sendo o login dela.
    assert_eq!(evento["profile"]["username"], "alice");

    alice.close().await;
    daniel.close().await;
}

#[tokio::test]
async fn cor_invalida_e_recusada_e_nao_anuncia_perfil() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let mut daniel = entrar(addr, "daniel").await;
    daniel.wait_for("welcome").await;

    daniel
        .send(json!({ "t": "profile.update", "accent": "rosa-choque" }))
        .await;

    let erro = daniel.wait_for("error").await;
    assert!(
        erro["message"].as_str().unwrap().contains("cor"),
        "{:?}",
        erro["message"]
    );

    daniel.close().await;
}

/// Um PNG de verdade, para o teste nao depender de arquivo no disco.
fn png_de_teste(lado: u32) -> Vec<u8> {
    let mut imagem = image::RgbaImage::new(lado, lado);
    for (_x, _y, pixel) in imagem.enumerate_pixels_mut() {
        *pixel = image::Rgba([10, 150, 240, 255]);
    }
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(imagem)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

#[tokio::test]
async fn o_avatar_sobe_aparece_para_os_outros_e_pode_ser_removido() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    let sessao = common::auth(addr, "register", "daniel", SENHA, true).await;
    let token = sessao.body["access_token"].as_str().unwrap().to_string();

    let mut daniel = common::Client::connect(addr).await;
    daniel.wait_for("auth.required").await;
    daniel.authenticate(&token).await;
    let eu = daniel.wait_for("welcome").await["self_user_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Quem observa: alguem ja conectado, que nao pode precisar recarregar.
    let mut alice = entrar(addr, "alice").await;
    alice.wait_for("welcome").await;

    assert_eq!(
        common::avatar_get(addr, &eu).await.0,
        404,
        "sem imagem ainda, a rota tem que devolver 404 para o cliente cair no gerado"
    );

    assert_eq!(
        common::avatar_upload(addr, &token, &png_de_teste(400)).await,
        204
    );

    // A alice recebe o perfil novo sem pedir nada.
    let evento = alice
        .wait_for_matching("user.profile", |msg| {
            msg["profile"]["user_id"] == eu.as_str()
        })
        .await;
    assert_eq!(evento["profile"]["has_avatar"], true);
    let versao = evento["profile"]["updated_at"].as_i64().unwrap();
    assert!(versao > 0, "o updated_at e o que invalida o cache");

    // E a imagem sai como WebP, qualquer que tenha sido a entrada.
    let (status, corpo, cabecalhos) = common::avatar_get(addr, &eu).await;
    assert_eq!(status, 200);
    // Sem isto o navegador recusa a imagem embutida a partir de outra porta,
    // mesmo com o GET respondendo 200 — foi assim que o bug apareceu.
    assert!(
        cabecalhos.contains("cross-origin-resource-policy: cross-origin"),
        "o avatar precisa poder ser embutido: {cabecalhos}"
    );
    assert_eq!(
        image::guess_format(&corpo).unwrap(),
        image::ImageFormat::WebP
    );

    // Remover volta para o avatar gerado.
    assert_eq!(common::avatar_delete(addr, &token).await, 204);
    let voltou = alice
        .wait_for_matching("user.profile", |msg| {
            msg["profile"]["user_id"] == eu.as_str() && msg["profile"]["has_avatar"] == false
        })
        .await;
    assert_eq!(voltou["profile"]["has_avatar"], false);
    assert_eq!(common::avatar_get(addr, &eu).await.0, 404);

    alice.close().await;
    daniel.close().await;
}

#[tokio::test]
async fn upload_sem_sessao_e_o_que_nao_e_imagem_sao_recusados() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;
    let sessao = common::auth(addr, "register", "daniel", SENHA, true).await;
    let token = sessao.body["access_token"].as_str().unwrap().to_string();

    assert_eq!(
        common::avatar_upload_sem_token(addr, &png_de_teste(100)).await,
        401,
        "sem token nao entra nem imagem boa"
    );
    assert_eq!(
        common::avatar_upload(addr, "token-inventado", &png_de_teste(100)).await,
        401
    );
    assert_eq!(
        common::avatar_upload(addr, &token, b"isto nao e uma imagem").await,
        400,
        "a extensao nao existe; quem decide e o decodificador"
    );
    assert_eq!(common::avatar_upload(addr, &token, b"").await, 400);
}

#[tokio::test]
async fn o_upload_responde_o_preflight_do_navegador() {
    let dir = common::TestDir::new();
    let addr = common::start(common::config(dir.database(), true)).await;

    // Em dev o app roda noutra porta, entao o POST com Authorization vira
    // cross-origin e o navegador manda um OPTIONS antes. Sem esta resposta o
    // upload nem sai da pagina — foi assim que o bug apareceu no navegador.
    let status = common::preflight(addr, "/avatars", &format!("http://{}", addr)).await;
    assert_eq!(status, 204, "o preflight de /avatars precisa passar");
}

const SENHA: &str = "uma senha bem seguraa";

/// Conecta, cria a conta e devolve o cliente logo apos o `auth.required`.
async fn entrar(addr: std::net::SocketAddr, username: &str) -> common::Client {
    let sessao = common::auth(addr, "register", username, SENHA, true).await;
    let mut cliente = common::Client::connect(addr).await;
    cliente.wait_for("auth.required").await;
    cliente
        .authenticate(sessao.body["access_token"].as_str().unwrap())
        .await;
    cliente
}
