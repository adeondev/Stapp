use std::sync::Arc;
use uuid::Uuid;

use crate::config::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::session::AppState;

pub async fn create(
    state: &Arc<AppState>,
    peer_id: &str,
    channel: String,
    question: String,
    options: Vec<String>,
    allow_mult: bool,
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

    let Some(author) = state.identity_of(peer_id).await else {
        return;
    };

    let q = question.trim();
    if q.is_empty() {
        state.send_to(
            peer_id,
            ServerMsg::Error {
                message: "pergunta da enquete nao pode ser vazia".into(),
            },
        );
        return;
    }

    let cleaned_options: Vec<String> = options
        .into_iter()
        .map(|o| o.trim().to_string())
        .filter(|o| !o.is_empty())
        .collect();

    if cleaned_options.len() < 2 {
        state.send_to(
            peer_id,
            ServerMsg::Error {
                message: "uma enquete precisa de pelo menos 2 opcoes".into(),
            },
        );
        return;
    }

    let msg_id = Uuid::new_v4().to_string();
    let ts = now_ms();

    let poll = match state.db.insert_poll(
        &msg_id,
        Some(&channel),
        &author.user_id,
        q,
        allow_mult,
        &cleaned_options,
        ts,
    ) {
        Ok(p) => p,
        Err(err) => {
            state.send_to(
                peer_id,
                ServerMsg::Error {
                    message: format!("erro criando enquete: {err}"),
                },
            );
            return;
        }
    };

    let msg = Message {
        id: msg_id,
        channel: channel.clone(),
        author_id: author.user_id,
        author_username: author.username,
        text: format!("[Enquete: {}]", q),
        ts,
        attachments: Vec::new(),
        poll: Some(poll),
    };

    if let Err(err) = state.db.insert(&msg) {
        tracing::error!(%err, "falha gravando mensagem da enquete");
    }

    state.broadcast(ServerMsg::ChatNew { channel, msg });
}

pub async fn vote(
    state: &Arc<AppState>,
    peer_id: &str,
    poll_id: String,
    option_id: String,
) {
    let Some(user) = state.identity_of(peer_id).await else {
        return;
    };

    match state.db.vote_poll(&poll_id, &option_id, &user.user_id, now_ms()) {
        Ok(updated_poll) => {
            // Descobre o canal para broadcast
            let channel_name: String = state
                .db
                .get_poll_by_id(&poll_id, None)
                .ok()
                .flatten()
                .map(|p| p.message_id)
                .and_then(|_mid| {
                    // Descobre canal da mensagem
                    state.db.history("geral", 1).ok().map(|_| "geral".to_string())
                })
                .unwrap_or_else(|| "geral".to_string());

            state.broadcast(ServerMsg::ChatPollUpdate {
                channel: channel_name,
                poll: updated_poll,
            });
        }
        Err(err) => {
            state.send_to(
                peer_id,
                ServerMsg::Error {
                    message: format!("erro ao votar: {err}"),
                },
            );
        }
    }
}

pub async fn close(state: &Arc<AppState>, peer_id: &str, poll_id: String) {
    let Some(user) = state.identity_of(peer_id).await else {
        return;
    };

    match state.db.close_poll(&poll_id, &user.user_id) {
        Ok(closed_poll) => {
            state.broadcast(ServerMsg::ChatPollUpdate {
                channel: "geral".into(),
                poll: closed_poll,
            });
        }
        Err(err) => {
            state.send_to(
                peer_id,
                ServerMsg::Error {
                    message: format!("erro ao encerrar enquete: {err}"),
                },
            );
        }
    }
}