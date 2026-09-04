use std::sync::Arc;

use uuid::Uuid;

use crate::config::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::services::messages;
use crate::session::AppState;
use crate::storage::MessageLocation;

/// Envia de uma vez o historico de todos os canais de texto.
/// Assim, trocar de canal na UI nao exige outra ida ao servidor.
pub async fn send_history(state: &AppState, peer_id: &str) {
    let limit = state.config.storage.history_limit;

    for channel in state.config.text_channels() {
        match state.db.history(&channel.id, limit).await {
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

#[cfg(test)]
pub async fn send(
    state: &Arc<AppState>,
    peer_id: &str,
    channel: String,
    raw_text: &str,
    attachment_ids: Vec<String>,
    reply_to: Option<String>,
) {
    send_with_nonce(
        state,
        peer_id,
        channel,
        raw_text,
        attachment_ids,
        reply_to,
        None,
    )
    .await
}

pub async fn send_with_nonce(
    state: &Arc<AppState>,
    peer_id: &str,
    channel: String,
    raw_text: &str,
    attachment_ids: Vec<String>,
    reply_to: Option<String>,
    client_nonce: Option<String>,
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
    if let Some(nonce) = client_nonce.as_deref() {
        if nonce.len() > 100 {
            return state.send_to(
                peer_id,
                ServerMsg::MessageFailed {
                    client_nonce: nonce.into(),
                    message: "identificador de envio invalido".into(),
                },
            );
        }
        if let Ok(Some(message_id)) = state
            .db
            .message_id_for_nonce(&author.user_id, &channel, nonce)
            .await
        {
            return state.send_to(
                peer_id,
                ServerMsg::MessageAccepted {
                    client_nonce: nonce.into(),
                    message_id,
                },
            );
        }
    }

    // Responder algo de outro escopo nao e so cosmetico: sem esta guarda,
    // apontar um id de conversa dentro de um canal publico faria a previa vazar
    // o texto da DM dos outros para o servidor inteiro.
    let resposta = match reply_to {
        Some(alvo) => {
            let mesmo_escopo = matches!(
                state.db.locate_message(&alvo).await,
                Ok(Some(MessageLocation::Channel { channel: ref c, .. })) if *c == channel
            );
            if mesmo_escopo {
                state.db.reply_ref(&alvo).await.ok().flatten()
            } else {
                None
            }
        }
        None => None,
    };

    let citadas = messages::mentions::resolve(state, &text).await;
    let msg_id = Uuid::new_v4().to_string();
    let mut msg = Message {
        id: msg_id.clone(),
        channel: channel.clone(),
        author_id: author.user_id,
        author_username: author.username,
        text,
        ts: now_ms(),
        attachments: Vec::new(),
        poll: None,
        reply_to: resposta,
        edited_at: None,
        reactions: Vec::new(),
        mentions: citadas.user_ids,
        mentions_everyone: citadas.everyone,
    };

    // Se o disco falhar, a conversa continua — so o historico fica torto.
    if let Err(err) = state
        .db
        .insert_channel_message_with_attachments(
            &msg,
            client_nonce.as_deref(),
            &attachment_ids,
            state.config.limits.max_attachments_per_message,
        )
        .await
    {
        tracing::error!(%err, "falha gravando mensagem");
        if let Some(client_nonce) = client_nonce {
            state.send_to(
                peer_id,
                ServerMsg::MessageFailed {
                    client_nonce,
                    message: err.to_string(),
                },
            );
        } else {
            state.send_to(
                peer_id,
                ServerMsg::Error {
                    message: "nao consegui enviar a mensagem".into(),
                },
            );
        }
        return;
    }
    msg.attachments = state
        .db
        .list_attachments(&msg_id, None)
        .await
        .unwrap_or_default();
    let text_for_preview = msg.text.clone();
    state.broadcast(ServerMsg::ChatNew { channel, msg });
    if let Some(client_nonce) = client_nonce {
        state.send_to(
            peer_id,
            ServerMsg::MessageAccepted {
                client_nonce,
                message_id: msg_id.clone(),
            },
        );
    }

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

pub async fn mark_read(state: &AppState, peer_id: &str, channel: String, message_id: String) {
    if !matches!(state.config.channel(&channel), Some(ch) if ch.kind == ChannelKind::Text) {
        return;
    }
    let Some(identity) = state.identity_of(peer_id).await else {
        return;
    };
    match state
        .db
        .mark_channel_read(&identity.user_id, &channel, &message_id, now_ms())
        .await
    {
        Ok(readers) => state.broadcast(ServerMsg::ChatReads {
            channel,
            message_id,
            readers,
        }),
        Err(error) => tracing::warn!(%error, "falha marcando canal como lido"),
    }
}

#[cfg(test)]
mod tests;
