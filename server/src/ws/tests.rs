use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

fn peer() -> PeerId {
    "peer".to_string()
}

#[test]
fn auth_error_codes_use_snake_case() {
    let json = serde_json::to_string(&ServerMsg::AuthError {
        code: AuthErrorCode::TooManySessions,
        message: "limite".into(),
        retry_after_ms: None,
    })
    .unwrap();
    assert!(json.contains("\"too_many_sessions\""));
    assert!(!json.contains("retry_after_ms"));
}

#[tokio::test]
async fn registration_is_configurable_and_enters_immediately() {
    let mut server = TestServer::new(10, 4);
    Arc::get_mut(&mut server.state)
        .unwrap()
        .config
        .auth
        .allow_registration = true;
    let mut events = server.state.subscribe();

    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthRegister {
            username: "Daniel".into(),
            password: "uma senha realmente segura".into(),
        },
    )
    .await;

    assert_eq!(phase, Phase::Authenticated);
    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    assert!(
        matches!(event.msg, ServerMsg::Welcome { ref self_user_id, .. } if !self_user_id.is_empty())
    );
}

#[tokio::test]
async fn rejects_registration_when_closed_and_remote_plaintext_auth() {
    let server = TestServer::new(10, 4);
    let mut events = server.state.subscribe();

    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthRegister {
            username: "Daniel".into(),
            password: "uma senha realmente segura".into(),
        },
    )
    .await;
    assert_eq!(phase, Phase::Anonymous);
    assert!(matches!(
        events.try_recv().unwrap().msg,
        ServerMsg::AuthError {
            code: AuthErrorCode::RegistrationDisabled,
            ..
        }
    ));

    let phase = route(
        &server.state,
        &peer(),
        "192.168.0.2:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthLogin {
            username: "Daniel".into(),
            password: "uma senha realmente segura".into(),
        },
    )
    .await;
    assert_eq!(phase, Phase::Anonymous);
    assert!(matches!(
        events.try_recv().unwrap().msg,
        ServerMsg::AuthError {
            code: AuthErrorCode::SecureTransportRequired,
            ..
        }
    ));
}

#[tokio::test]
async fn conexao_anonima_nao_alcanca_o_resto_do_protocolo() {
    let server = TestServer::new(10, 4);
    let mut events = server.state.subscribe();

    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::ChatSend {
            channel: "geral".into(),
            text: "oi".into(),
        },
    )
    .await;

    assert_eq!(phase, Phase::Anonymous);
    assert!(matches!(
        events.try_recv().unwrap().msg,
        ServerMsg::AuthError {
            code: AuthErrorCode::InvalidCredentials,
            ..
        }
    ));
}

#[tokio::test]
async fn sessao_autenticada_continua_autenticada() {
    let mut server = TestServer::new(10, 4);
    Arc::get_mut(&mut server.state)
        .unwrap()
        .config
        .auth
        .allow_registration = true;

    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthRegister {
            username: "Daniel".into(),
            password: "uma senha realmente segura".into(),
        },
    )
    .await;
    assert_eq!(phase, Phase::Authenticated);

    // Reautenticar no mesmo socket e ignorado, sem derrubar a sessao.
    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        phase,
        ClientMsg::AuthLogin {
            username: "Daniel".into(),
            password: "uma senha realmente segura".into(),
        },
    )
    .await;
    assert_eq!(phase, Phase::Authenticated);
}
