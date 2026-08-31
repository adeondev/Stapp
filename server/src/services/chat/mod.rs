use std::sync::Arc;

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

pub async fn send(
    state: &Arc<AppState>,
    peer_id: &str,
    channel: String,
    raw_text: &str,
    attachment_ids: Vec<String>,
) {
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

    let text = clean_text(raw_text).unwrap_or_default();
    if text.is_empty() && attachment_ids.is_empty() {
        return;
    }
    let Some(author) = state.identity_of(peer_id).await else {
        return;
    };

    let msg_id = Uuid::new_v4().to_string();
    if !attachment_ids.is_empty() {
        if let Err(err) = state.db.bind_attachments(&msg_id, &attachment_ids) {
            tracing::error!(%err, "falha vinculando anexos");
        }
    }

    let attachments = state
        .db
        .list_attachments(&msg_id, None)
        .unwrap_or_default();

    let msg = Message {
        id: msg_id.clone(),
        channel: channel.clone(),
        author_id: author.user_id,
        author_username: author.username,
        text,
        ts: now_ms(),
        attachments,
        poll: None,
    };

    // Se o disco falhar, a conversa continua — so o historico fica torto.
    if let Err(err) = state.db.insert(&msg) {
        tracing::error!(%err, "falha gravando mensagem");
    }
    let text_for_preview = msg.text.clone();
    state.broadcast(ServerMsg::ChatNew { channel, msg });

    // Dispara scraping assíncrono para links seguros em background
    if let Some(target_url) = crate::services::preview::extract_first_url(&text_for_preview) {
        let app_state = state.clone();
        tokio::spawn(async move {
            if let Some(preview) = crate::services::preview::scrape_metadata(&target_url).await {
                app_state.broadcast(ServerMsg::LinkPreviewEnriched {
                    message_id: msg_id,
                    preview,
                });
            }
        });
    }
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
