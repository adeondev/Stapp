use uuid::Uuid;

use crate::channel::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::state::AppState;

/// Envia de uma vez o historico de todos os canais de texto.
/// Assim, trocar de canal na UI nao exige outra ida ao servidor.
pub fn send_history(state: &AppState, peer_id: &str) {
    let limit = state.config.storage.history_limit;

    for channel in state.config.text_channels() {
        match state.db.history(&channel.id, limit) {
            Ok(msgs) => state.send_to(
                peer_id,
                ServerMsg::ChatHistory {
                    channel: channel.id.clone(),
                    msgs,
                },
            ),
            Err(err) => tracing::error!(channel = %channel.id, %err, "falha lendo historico"),
        }
    }
}

pub async fn send(state: &AppState, peer_id: &str, channel: String, raw_text: &str) {
    match state.config.channel(&channel) {
        Some(ch) if ch.kind == ChannelKind::Text => {}
        _ => {
            state.send_to(
                peer_id,
                ServerMsg::Error {
                    message: "canal de texto invalido".into(),
                },
            );
            return;
        }
    }

    let Some(text) = clean_text(raw_text) else {
        return;
    };
    let Some(author) = state.identity_of(peer_id).await else {
        return;
    };

    let msg = Message {
        id: Uuid::new_v4().to_string(),
        channel: channel.clone(),
        author_id: author.user_id,
        author_username: author.username,
        text,
        ts: now_ms(),
    };

    // Se o disco falhar, a conversa continua — so o historico fica torto.
    if let Err(err) = state.db.insert(&msg) {
        tracing::error!(%err, "falha gravando mensagem");
    }
    state.broadcast(ServerMsg::ChatNew { channel, msg });
}

fn clean_text(raw: &str) -> Option<String> {
    let text: String = raw
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(2000)
        .collect();
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Target;
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
}
