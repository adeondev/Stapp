use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

fn peer() -> PeerId {
    "peer".to_string()
}

fn drena_ate<F>(
    events: &mut tokio::sync::broadcast::Receiver<crate::session::Envelope>,
    combina: F,
) -> ServerMsg
where
    F: Fn(&ServerMsg) -> bool,
{
    while let Ok(envelope) = events.try_recv() {
        if combina(&envelope.msg) {
            return envelope.msg;
        }
    }
    panic!("nenhum evento correspondente na fila");
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
async fn access_token_valido_abre_a_sessao() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    let access = server.state.auth.tokens.issue_access(&account);
    let mut events = server.state.subscribe();
    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthAccess {
            access_token: access.token,
        },
    )
    .await;
    assert_eq!(phase, Phase::Authenticated);
    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    assert!(matches!(event.msg, ServerMsg::Welcome { .. }));
}

#[tokio::test]
async fn access_token_invalido_permanece_anonimo() {
    let server = TestServer::new(10, 4);
    let mut events = server.state.subscribe();
    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthAccess {
            access_token: "nao-existe".into(),
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
            attachment_ids: Vec::new(),
            reply_to: None,
        },
    )
    .await;
    assert_eq!(phase, Phase::Anonymous);
    assert!(matches!(
        events.try_recv().unwrap().msg,
        ServerMsg::AuthError { .. }
    ));
}

#[tokio::test]
async fn sessao_autenticada_ignora_nova_tentativa_de_auth() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    let first = server.state.auth.tokens.issue_access(&account);
    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthAccess {
            access_token: first.token,
        },
    )
    .await;
    let second = server.state.auth.tokens.issue_access(&account);
    let phase = route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        phase,
        ClientMsg::AuthAccess {
            access_token: second.token,
        },
    )
    .await;
    assert_eq!(phase, Phase::Authenticated);
}

#[tokio::test]
async fn welcome_dispara_snapshot_social_personalizado() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    let _alice = server.account("Alice");
    let access = server.state.auth.tokens.issue_access(&account);
    let mut events = server.state.subscribe();
    route(
        &server.state,
        &peer(),
        "127.0.0.1:1234".parse().unwrap(),
        Phase::Anonymous,
        ClientMsg::AuthAccess {
            access_token: access.token,
        },
    )
    .await;
    assert!(matches!(
        drena_ate(&mut events, |msg| matches!(
            msg,
            ServerMsg::SocialSnapshot { .. }
        )),
        ServerMsg::SocialSnapshot { .. }
    ));
}
