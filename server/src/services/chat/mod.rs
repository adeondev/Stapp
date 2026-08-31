use std::sync::Arc;

use uuid::Uuid;

use crate::config::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::services::messages;
use crate::session::AppState;
use crate::storage::MessageLocation;

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
    reply_to: Option<String>,
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

    let text = messages::clean_text(raw_text).unwrap_or_default();
    if !messages::fits(&text, state.config.limits.max_text_chars) {
        return messages::reject_too_long(state, peer_id, state.config.limits.max_text_chars);
    }
    if text.is_empty() && attachment_ids.is_empty() {
        return;
    }
    let Some(author) = state.identity_of(peer_id).await else {
        return;
    };

    // Responder algo de outro escopo nao e so cosmetico: sem esta guarda,
    // apontar um id de conversa dentro de um canal publico faria a previa vazar
    // o texto da DM dos outros para o servidor inteiro.
    let resposta = reply_to.and_then(|alvo| {
        let mesmo_escopo = matches!(
            state.db.locate_message(&alvo),
            Ok(Some(MessageLocation::Channel { channel: ref c, .. })) if *c == channel
        );
        // mesmo_canal: fora do escopo, a resposta simplesmente nao existe.
        mesmo_escopo
            .then(|| state.db.reply_ref(&alvo).ok().flatten())
            .flatten()
    });

    let citadas = messages::mentions::resolve(state, &text);
    let msg_id = Uuid::new_v4().to_string();
    if !attachment_ids.is_empty() {
        if let Err(err) = state.db.bind_attachments(&msg_id, &attachment_ids) {
            tracing::error!(%err, "falha vinculando anexos");
        }
    }

    let attachments = state.db.list_attachments(&msg_id, None).unwrap_or_default();

    let msg = Message {
        id: msg_id.clone(),
        channel: channel.clone(),
        author_id: author.user_id,
        author_username: author.username,
        text,
        ts: now_ms(),
        attachments,
        poll: None,
        reply_to: resposta,
        edited_at: None,
        reactions: Vec::new(),
        mentions: citadas.user_ids,
        mentions_everyone: citadas.everyone,
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

#[cfg(test)]
mod tests;
