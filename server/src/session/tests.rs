use super::*;
use crate::test_support::TestServer;

#[tokio::test]
async fn aggregates_presence_and_enforces_limits() {
    let server = TestServer::new(1, 4).await;
    let first = server.account("Daniel").await;
    let second = server.account("Alice").await;

    assert!(
        server
            .state
            .register_session("one", &first)
            .await
            .unwrap()
            .first_session
    );
    assert!(
        !server
            .state
            .register_session("two", &first)
            .await
            .unwrap()
            .first_session
    );
    assert_eq!(server.state.snapshot().await.len(), 1);
    assert!(matches!(
        server.state.register_session("other", &second).await,
        Err(SessionError::ServerFull)
    ));
}

#[tokio::test]
async fn limits_sessions_per_account() {
    let dir = crate::test_support::TestDir::new();
    let mut config = crate::test_support::config(dir.database(), 10, 4);
    config.auth.max_sessions_per_user = 2;
    let server = TestServer::with_config(config).await;
    let account = server.account("Daniel").await;

    server
        .state
        .register_session("one", &account)
        .await
        .unwrap();
    server
        .state
        .register_session("two", &account)
        .await
        .unwrap();
    assert!(matches!(
        server.state.register_session("three", &account).await,
        Err(SessionError::TooManySessions)
    ));
}

#[tokio::test]
async fn keeps_one_voice_session_per_account() {
    let server = TestServer::new(10, 2).await;
    let account = server.account("Daniel").await;
    server
        .state
        .register_session("one", &account)
        .await
        .unwrap();
    server
        .state
        .register_session("two", &account)
        .await
        .unwrap();

    server
        .state
        .join_voice(&"one".into(), "voz-a", 4)
        .await
        .unwrap();
    let (segundo, takeover) = server
        .state
        .join_voice(&"two".into(), "voz-a", 4)
        .await
        .unwrap();
    assert_eq!(segundo.peer.peer_id, "two");
    assert!(takeover.is_some());
    let t = takeover.unwrap();
    assert_eq!(t.old_peer_id, "one");
    assert_eq!(t.channel, "voz-a");
    assert!(t.published);

    let peers = server.state.peers_in_voice("voz-a").await;
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0], "two");
}

#[tokio::test]
async fn removes_presence_only_with_the_last_session() {
    let server = TestServer::new(10, 2).await;
    let account = server.account("Daniel").await;
    server
        .state
        .register_session("one", &account)
        .await
        .unwrap();
    server
        .state
        .register_session("two", &account)
        .await
        .unwrap();

    assert!(
        !server
            .state
            .remove_session("one")
            .await
            .unwrap()
            .last_session
    );
    assert!(
        server
            .state
            .remove_session("two")
            .await
            .unwrap()
            .last_session
    );
}

#[tokio::test]
async fn a_call_lotada_recusa_mais_um() {
    // O limite agora vem por chamada, entao ele e o proprio caso de teste.
    const CABE_UM: usize = 1;
    let server = TestServer::new(10, 1).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    server.state.register_session("one", &daniel).await.unwrap();
    server.state.register_session("two", &alice).await.unwrap();

    server
        .state
        .join_voice(&"one".into(), "voz-a", CABE_UM)
        .await
        .unwrap();
    assert!(matches!(
        server
            .state
            .join_voice(&"two".into(), "voz-a", CABE_UM)
            .await,
        Err(VoiceJoinError::Full)
    ));
}

#[tokio::test]
async fn o_roster_nao_inclui_quem_esta_chegando() {
    let server = TestServer::new(10, 4).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    server.state.register_session("one", &daniel).await.unwrap();
    server.state.register_session("two", &alice).await.unwrap();

    let (primeiro, _) = server
        .state
        .join_voice(&"one".into(), "voz-a", 4)
        .await
        .unwrap();
    assert!(primeiro.roster.is_empty());

    let (segundo, _) = server
        .state
        .join_voice(&"two".into(), "voz-a", 4)
        .await
        .unwrap();
    assert_eq!(segundo.roster.len(), 1);
    assert_eq!(segundo.roster[0].peer_id, "one");
    assert_eq!(segundo.peer.peer_id, "two");
}

#[tokio::test]
async fn reservas_concorrentes_contam_no_limite_e_so_confirmacao_publica() {
    use std::time::Duration;

    let server = TestServer::new(10, 1).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    server.state.register_session("one", &daniel).await.unwrap();
    server.state.register_session("two", &alice).await.unwrap();

    server
        .state
        .reserve_voice(&"one".into(), "voz-a", 1, Duration::from_secs(15))
        .await
        .unwrap();
    assert!(server.state.peers_in_voice("voz-a").await.is_empty());
    assert!(matches!(
        server
            .state
            .reserve_voice(&"two".into(), "voz-a", 1, Duration::from_secs(15))
            .await,
        Err(VoiceJoinError::Full)
    ));

    let confirmed = server
        .state
        .confirm_voice(&"one".into(), "voz-a")
        .await
        .unwrap();
    assert!(confirmed.roster.is_empty());
    assert_eq!(server.state.peers_in_voice("voz-a").await, vec!["one"]);
}

#[tokio::test]
async fn reserva_expirada_nao_vira_participante() {
    use std::time::Duration;

    let server = TestServer::new(10, 2).await;
    let account = server.account("Daniel").await;
    server
        .state
        .register_session("one", &account)
        .await
        .unwrap();
    server
        .state
        .reserve_voice(&"one".into(), "voz-a", 2, Duration::from_millis(1))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert!(matches!(
        server.state.confirm_voice(&"one".into(), "voz-a").await,
        Err(VoiceJoinError::GrantExpired)
    ));
    assert!(server.state.peers_in_voice("voz-a").await.is_empty());
}

#[tokio::test]
async fn reserve_voice_executa_takeover_de_sessao_fantasma() {
    use std::time::Duration;
    let server = TestServer::new(10, 2).await;
    let account = server.account("Daniel").await;
    server
        .state
        .register_session("zombie", &account)
        .await
        .unwrap();
    server
        .state
        .register_session("fresh", &account)
        .await
        .unwrap();

    server
        .state
        .join_voice(&"zombie".into(), "voz-geral", 4)
        .await
        .unwrap();
    assert_eq!(
        server.state.peers_in_voice("voz-geral").await,
        vec!["zombie"]
    );

    let takeover = server
        .state
        .reserve_voice(
            &"fresh".into(),
            "voz-geral",
            4,
            Duration::from_secs(15),
        )
        .await
        .unwrap();
    assert!(takeover.is_some());
    let t = takeover.unwrap();
    assert_eq!(t.old_peer_id, "zombie");
    assert_eq!(t.channel, "voz-geral");
    assert!(t.published);

    // Sessao antiga foi desalojada do canal
    assert!(server.state.peers_in_voice("voz-geral").await.is_empty());

    // Sessao nova confirma a entrada
    server
        .state
        .confirm_voice(&"fresh".into(), "voz-geral")
        .await
        .unwrap();
    assert_eq!(
        server.state.peers_in_voice("voz-geral").await,
        vec!["fresh"]
    );
}

#[tokio::test]
async fn is_in_voice_identifica_presenca_corretamente() {
    let server = TestServer::new(10, 2).await;
    let account = server.account("Daniel").await;
    server
        .state
        .register_session("sess1", &account)
        .await
        .unwrap();
    assert!(!server.state.is_in_voice(&"sess1".into()).await);

    server
        .state
        .join_voice(&"sess1".into(), "voz-b", 4)
        .await
        .unwrap();
    assert!(server.state.is_in_voice(&"sess1".into()).await);

    server.state.leave_voice(&"sess1".into()).await.unwrap();
    assert!(!server.state.is_in_voice(&"sess1".into()).await);
}

