use std::sync::Arc;
use uuid::Uuid;

use crate::config::ChannelKind;
use crate::protocol::{Message, ServerMsg, now_ms};
use crate::session::AppState;
use crate::storage::MessageLocation;

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

    let poll = match state
        .db
        .insert_poll(
            &msg_id,
            Some(&channel),
            &author.user_id,
            q,
            allow_mult,
            &cleaned_options,
            ts,
        )
        .await
    {
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
        reply_to: None,
        edited_at: None,
        reactions: Vec::new(),
        mentions: Vec::new(),
        mentions_everyone: false,
    };

    if let Err(err) = state.db.insert(&msg).await {
        tracing::error!(%err, "falha gravando mensagem da enquete");
    }

    state.broadcast(ServerMsg::ChatNew { channel, msg });
}

pub async fn vote(state: &Arc<AppState>, peer_id: &str, poll_id: String, option_id: String) {
    let Some(user) = state.identity_of(peer_id).await else {
        return;
    };

    match state
        .db
        .vote_poll(&poll_id, &option_id, &user.user_id, now_ms())
        .await
    {
        Ok(updated_poll) => {
            let Some(channel) = canal_da_enquete(state, &updated_poll.message_id).await else {
                return;
            };
            state.broadcast(ServerMsg::ChatPollUpdate {
                channel,
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

    match state.db.close_poll(&poll_id, &user.user_id).await {
        Ok(closed_poll) => {
            let Some(channel) = canal_da_enquete(state, &closed_poll.message_id).await else {
                return;
            };
            state.broadcast(ServerMsg::ChatPollUpdate {
                channel,
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

/// O canal em que a enquete foi criada.
///
/// Antes daqui existir, `vote` e `close` chutavam `"geral"` — a enquete de
/// qualquer outro canal atualizava no canal errado na tela de todo mundo. A
/// consulta que faltava e a mesma que os comandos de mensagem usam para
/// descobrir o escopo pelo id.
async fn canal_da_enquete(state: &AppState, message_id: &str) -> Option<String> {
    match state.db.locate_message(message_id).await {
        Ok(Some(MessageLocation::Channel { channel, .. })) => Some(channel),
        // Enquete em conversa direta nao existe hoje: `poll.create` so aceita
        // canal. Se um dia existir, o anuncio tem que sair por `sessions_of`,
        // nunca por broadcast — por isso aqui e `None` em vez de um palpite.
        _ => {
            tracing::warn!(%message_id, "enquete sem canal conhecido; nada anunciado");
            None
        }
    }
}
