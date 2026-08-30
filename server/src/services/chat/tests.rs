use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

#[tokio::test]
async fn sanitizes_persists_and_broadcasts_a_message() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    send(&server.state, "peer", "geral".into(), "  oi\0\nmundo  ").await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::All));
    match event.msg {
        ServerMsg::ChatNew { channel, msg } => {
            assert_eq!(channel, "geral");
            assert_eq!(msg.author_id, account.id);
            assert_eq!(msg.author_username, "Daniel");
            assert_eq!(msg.text, "oi\nmundo");
        }
        other => panic!("evento inesperado: {other:?}"),
    }

    let history = server.state.db.history("geral", 10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].text, "oi\nmundo");
}

#[tokio::test]
async fn rejects_non_text_channels() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    send(&server.state, "peer", "voz-a".into(), "nao deveria entrar").await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    assert!(matches!(event.msg, ServerMsg::Error { .. }));
    assert!(server.state.db.history("voz-a", 10).unwrap().is_empty());
}

#[tokio::test]
async fn sends_history_only_to_the_requested_peer() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    send(&server.state, "peer", "geral".into(), "mensagem").await;
    let mut events = server.state.subscribe();

    send_history(&server.state, "peer");

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    match event.msg {
        ServerMsg::ChatHistory { channel, msgs } => {
            assert_eq!(channel, "geral");
            assert_eq!(msgs.len(), 1);
            assert_eq!(msgs[0].text, "mensagem");
        }
        other => panic!("evento inesperado: {other:?}"),
    }
}

#[test]
fn limits_text_to_two_thousand_characters() {
    let text = "a".repeat(2100);
    assert_eq!(clean_text(&text).unwrap().len(), 2000);
    assert_eq!(clean_text("\0\r\t"), None);
}
