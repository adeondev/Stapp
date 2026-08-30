use uuid::Uuid;

use crate::config::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::session::AppState;

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
mod tests;
