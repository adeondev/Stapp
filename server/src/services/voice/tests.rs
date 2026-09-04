use std::path::PathBuf;
use tokio::sync::broadcast::error::TryRecvError;

use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

#[tokio::test]
async fn sends_roster_before_announcing_a_voice_join() {
    let server = TestServer::new(10, 4).await;
    let first = "first".to_string();
    let second = "second".to_string();
    let first_account = server.account("First").await;
    let second_account = server.account("Second").await;
    server
        .state
        .register_session(&first, &first_account)
        .await
        .unwrap();
    server
        .state
        .register_session(&second, &second_account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    join(&server.state, &first, "voz-a").await;
    let first_roster = events.try_recv().unwrap();
    let first_joined = events.try_recv().unwrap();
    assert!(matches!(first_roster.target, Target::Peer(ref id) if id == &first));
    assert!(matches!(
        first_roster.msg,
        ServerMsg::VoiceRoster { ref peers, .. } if peers.is_empty()
    ));
    assert!(matches!(first_joined.target, Target::Except(ref id) if id == &first));
    assert!(matches!(
        first_joined.msg,
        ServerMsg::VoiceJoined { ref peer } if peer.peer_id == first
    ));

    join(&server.state, &second, "voz-a").await;
    let second_roster = events.try_recv().unwrap();
    let second_joined = events.try_recv().unwrap();
    assert!(matches!(
        second_roster.msg,
        ServerMsg::VoiceRoster { ref peers, .. }
            if peers.len() == 1 && peers[0].peer_id == first
    ));
    assert!(matches!(second_joined.target, Target::Except(ref id) if id == &second));
    assert!(matches!(
        second_joined.msg,
        ServerMsg::VoiceJoined { ref peer } if peer.peer_id == second
    ));
}

#[tokio::test]
async fn mesh_signaling_relay_is_retired_and_emits_no_events() {
    let server = TestServer::new(10, 4).await;
    let first = "first".to_string();
    let second = "second".to_string();
    let first_account = server.account("First").await;
    let second_account = server.account("Second").await;
    server
        .state
        .register_session(&first, &first_account)
        .await
        .unwrap();
    server
        .state
        .register_session(&second, &second_account)
        .await
        .unwrap();
    server.state.join_voice(&first, "voz-a", 4).await.unwrap();
    server.state.join_voice(&second, "voz-a", 4).await.unwrap();
    let mut events = server.state.subscribe();

    relay(
        &server.state,
        &first,
        &second,
        serde_json::json!({ "kind": "retired_signal" }),
    )
    .await;
    assert!(matches!(events.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn o_canal_de_uma_conversa_e_o_mesmo_dos_dois_lados() {
    let a = "aaa".to_string();
    let b = "bbb".to_string();
    assert_eq!(direct_channel(&a, &b), direct_channel(&b, &a));
    assert_eq!(direct_participants(&direct_channel(&a, &b)), Some((a, b)));
    // Uma sala normal nao e confundida com conversa.
    assert_eq!(direct_participants("voz-a"), None);
    assert_eq!(direct_participants("dm:"), None);
}

#[tokio::test]
async fn a_call_de_uma_conversa_nao_vaza_para_terceiros() {
    let server = TestServer::new(10, 4).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    let bob = server.account("Bob").await;
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();
    server.state.register_session("b1", &bob).await.unwrap();

    let canal = direct_channel(&daniel.id, &alice.id);
    server
        .state
        .authorize_direct_call(&daniel.id, &alice.id)
        .await;
    let mut events = server.state.subscribe();

    join(&server.state, &"d1".to_string(), &canal).await;
    join(&server.state, &"a1".to_string(), &canal).await;

    let mut viu_bob = false;
    while let Ok(envelope) = events.try_recv() {
        match (&envelope.target, &envelope.msg) {
            // Um Target::All num evento de voz ja seria o vazamento.
            (Target::All, ServerMsg::VoiceJoined { .. })
            | (Target::All, ServerMsg::VoiceLeft { .. }) => {
                panic!("evento de call direta saiu em broadcast")
            }
            (Target::Peer(peer), ServerMsg::VoiceJoined { .. }) if peer == "b1" => viu_bob = true,
            _ => {}
        }
    }
    assert!(!viu_bob, "o bob nao pode saber que os dois estao em call");

    // Sair tambem so conta para os dois.
    let mut events = server.state.subscribe();
    leave(&server.state, &"a1".to_string()).await;
    while let Ok(envelope) = events.try_recv() {
        if let (Target::Peer(peer), ServerMsg::VoiceLeft { .. }) = (&envelope.target, &envelope.msg)
        {
            assert_ne!(peer, "b1", "o bob nao precisa saber que ela saiu");
        }
        assert!(
            !matches!(envelope.target, Target::All),
            "saida de call direta nao vai em broadcast"
        );
    }
}

#[tokio::test]
async fn ninguem_entra_na_conversa_de_voz_dos_outros() {
    let server = TestServer::new(10, 4).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    let bob = server.account("Bob").await;
    server.state.register_session("b1", &bob).await.unwrap();

    let canal = direct_channel(&daniel.id, &alice.id);
    let mut events = server.state.subscribe();
    join(&server.state, &"b1".to_string(), &canal).await;

    let recusou = events
        .try_recv()
        .ok()
        .map(|envelope| {
            matches!(
                envelope.msg,
                ServerMsg::VoiceDenied {
                    code: crate::protocol::VoiceDeniedCode::Forbidden,
                    ..
                }
            )
        })
        .unwrap_or(false);
    assert!(
        recusou,
        "entrar na call de conversa alheia tem que ser recusado"
    );
    assert!(server.state.peers_in_voice(&canal).await.is_empty());
}

#[tokio::test]
async fn validate_backend_com_chaves_padrao_dev_sucesso() {
    let mut config = crate::test_support::config(PathBuf::from("test.db"), 10, 4);
    config.voice.backend = "livekit".into();
    config.voice.api_key = Some("devkey".into());
    config.voice.api_secret = Some("secret".into());
    assert!(validate_backend(&config.voice).is_ok());
    assert!(is_enabled(&config.voice));
}

#[tokio::test]
async fn validate_backend_sem_chaves_retorna_ok_em_modo_degradado() {
    let mut config = crate::test_support::config(PathBuf::from("test.db"), 10, 4);
    config.voice.backend = "livekit".into();
    config.voice.api_key = None;
    config.voice.api_secret = None;
    config.voice.api_key_env = "CHAVE_INEXISTENTE_XYZ".into();
    config.voice.api_secret_env = "SEGREDO_INEXISTENTE_XYZ".into();
    // Nao deve falhar a inicializacao: retorna Ok(()) e opera degradado
    assert!(validate_backend(&config.voice).is_ok());
    assert!(!is_enabled(&config.voice));
}

#[tokio::test]
async fn validate_backend_disabled_retorna_ok() {
    let mut config = crate::test_support::config(PathBuf::from("test.db"), 10, 4);
    config.voice.backend = "disabled".into();
    assert!(validate_backend(&config.voice).is_ok());
    assert!(!is_enabled(&config.voice));
}

#[tokio::test]
async fn join_com_voice_desativado_recusa_com_unavailable() {
    let mut config = crate::test_support::config(PathBuf::from("test.db"), 10, 4);
    config.voice.backend = "disabled".into();
    let server = TestServer::with_config(config).await;
    let alice = server.account("Alice").await;
    server.state.register_session("a1", &alice).await.unwrap();

    let mut events = server.state.subscribe();
    join(&server.state, &"a1".to_string(), "voz-a").await;

    let recusou = events
        .try_recv()
        .ok()
        .map(|envelope| {
            matches!(
                envelope.msg,
                ServerMsg::VoiceDenied {
                    code: crate::protocol::VoiceDeniedCode::Unavailable,
                    ..
                }
            )
        })
        .unwrap_or(false);
    assert!(recusou, "entrar em call com voz desativada tem que recusar com Unavailable");
}

#[tokio::test]
async fn join_livekit_sem_credenciais_recusa_com_unavailable() {
    let mut config = crate::test_support::config(PathBuf::from("test.db"), 10, 4);
    config.voice.backend = "livekit".into();
    config.voice.api_key = None;
    config.voice.api_secret = None;
    config.voice.api_key_env = "VAR_INEXISTENTE_1".into();
    config.voice.api_secret_env = "VAR_INEXISTENTE_2".into();
    let server = TestServer::with_config(config).await;
    let alice = server.account("Alice").await;
    server.state.register_session("a1", &alice).await.unwrap();

    let mut events = server.state.subscribe();
    join(&server.state, &"a1".to_string(), "voz-a").await;

    let recusou = events
        .try_recv()
        .ok()
        .map(|envelope| {
            matches!(
                envelope.msg,
                ServerMsg::VoiceDenied {
                    code: crate::protocol::VoiceDeniedCode::Unavailable,
                    ..
                }
            )
        })
        .unwrap_or(false);
    assert!(recusou, "entrar em sala LiveKit sem credenciais tem que recusar com Unavailable");
}
