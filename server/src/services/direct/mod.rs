//! Mensagens diretas.
//!
//! Diferente do chat de canal, nada aqui vai por broadcast: a mensagem e
//! entregue so nas conexoes das duas contas envolvidas. Quem estiver offline
//! nao perde nada — recebe pelo historico quando conectar.

use std::sync::Arc;

use uuid::Uuid;

use crate::protocol::{
    DirectMessage, DirectMessageKind, DirectSummary, DirectoryEntry, ServerMsg, UserId, now_ms,
};
use crate::services::messages;
use crate::services::social;
use crate::session::AppState;
use crate::storage::{MessageLocation, conversation_id};

/// Todo mundo com conta neste servidor, menos voce. E a lista de quem da para
/// chamar numa conversa nova.
pub async fn directory(state: &AppState, me: &UserId) -> Vec<DirectoryEntry> {
    match state.db.list_accounts().await {
        Ok(accounts) => accounts
            .into_iter()
            .filter(|account| &account.id != me && account.disabled_at.is_none())
            .map(|account| DirectoryEntry {
                user_id: account.id,
                username: account.username,
            })
            .collect(),
        Err(err) => {
            tracing::error!(%err, "falha listando contas para o diretorio");
            Vec::new()
        }
    }
}

/// A lista lateral de conversas: com quem voce ja falou, mais recente primeiro.
pub async fn send_list(state: &AppState, peer_id: &str) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };

    let partners = match state.db.direct_partners(&me.user_id).await {
        Ok(partners) => partners,
        Err(err) => {
            tracing::error!(%err, "falha listando conversas");
            return;
        }
    };

    let mut conversations = Vec::with_capacity(partners.len());
    for other in partners {
        if let Some(summary) = summary(state, &me.user_id, &other).await {
            conversations.push(summary);
        }
    }

    state.send_to(peer_id, ServerMsg::DmList { conversations });
}

pub async fn open(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if !account_exists(state, &other).await {
        return refuse(state, peer_id, "essa conta nao existe");
    }
    let exists = state
        .db
        .direct_conversation_exists(&me.user_id, &other)
        .await
        .unwrap_or(false);
    if !exists && !state.db.can_direct(&me.user_id, &other).await.unwrap_or(false) {
        return denied(state, peer_id, other);
    }

    let conversation = conversation_id(&me.user_id, &other);
    let limit = state.config.storage.history_limit;

    let msgs = match state.db.direct_history(&conversation, limit).await {
        Ok(msgs) => msgs,
        Err(err) => {
            tracing::error!(%err, "falha lendo conversa");
            return;
        }
    };

    state.send_to(
        peer_id,
        ServerMsg::DmHistory {
            user_id: other,
            msgs,
        },
    );
}

#[cfg(test)]
pub async fn mark_read(state: &AppState, peer_id: &str, other: UserId) {
    mark_read_at(state, peer_id, other, None).await
}

pub async fn mark_read_at(
    state: &AppState,
    peer_id: &str,
    other: UserId,
    message_id: Option<String>,
) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    let conversation = conversation_id(&me.user_id, &other);
    mark_and_notify(state, &me.user_id, &other, &conversation, message_id).await;
}

#[cfg(test)]
pub async fn send(
    state: &Arc<AppState>,
    peer_id: &str,
    other: UserId,
    raw_text: &str,
    attachment_ids: Vec<String>,
    reply_to: Option<String>,
) {
    send_with_nonce(
        state,
        peer_id,
        other,
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
    other: UserId,
    raw_text: &str,
    attachment_ids: Vec<String>,
    reply_to: Option<String>,
    client_nonce: Option<String>,
) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if other == me.user_id {
        return refuse(state, peer_id, "nao da para conversar consigo mesmo");
    }
    if !account_exists(state, &other).await {
        return refuse(state, peer_id, "essa conta nao existe");
    }
    if !state.db.can_direct(&me.user_id, &other).await.unwrap_or(false) {
        return denied(state, peer_id, other);
    }
    let text = messages::clean_text(raw_text).unwrap_or_default();
    if !messages::fits(&text, state.config.limits.max_text_chars) {
        return messages::reject_too_long(state, peer_id, state.config.limits.max_text_chars);
    }
    if text.is_empty() && attachment_ids.is_empty() {
        return;
    }

    let first_message = !state
        .db
        .direct_conversation_exists(&me.user_id, &other)
        .await
        .unwrap_or(false);
    let conversation = conversation_id(&me.user_id, &other);
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
            .direct_id_for_nonce(&me.user_id, &conversation, nonce)
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

    // Mesma guarda do canal, na outra direcao: responder um id de canal dentro
    // da conversa colaria um trecho publico onde ele nao foi escrito.
    let resposta = match reply_to {
        Some(alvo) => {
            let mesmo_escopo = matches!(
                state.db.locate_message(&alvo).await,
                Ok(Some(MessageLocation::Direct { conversation_id: ref c, .. })) if *c == conversation
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
    let mut msg = DirectMessage {
        id: msg_id.clone(),
        author_id: me.user_id.clone(),
        author_username: me.username.clone(),
        kind: DirectMessageKind::Text,
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

    if let Err(err) = state
        .db
        .insert_direct_message_with_attachments(
            &conversation,
            &msg,
            client_nonce.as_deref(),
            &attachment_ids,
            state.config.limits.max_attachments_per_message,
        )
        .await
    {
        tracing::error!(%err, "falha gravando mensagem direta");
        if let Some(client_nonce) = client_nonce {
            state.send_to(
                peer_id,
                ServerMsg::MessageFailed {
                    client_nonce,
                    message: err.to_string(),
                },
            );
        } else {
            refuse(state, peer_id, "nao consegui guardar a mensagem");
        }
        return;
    }
    msg.attachments = state
        .db
        .list_attachments(&msg_id, None)
        .await
        .unwrap_or_default();

    // Quem escreveu ja leu o que escreveu.
    mark(state, &me.user_id, &conversation, Some(&msg_id)).await;

    let msg_id = msg.id.clone();
    let text_for_preview = msg.text.clone();
    deliver(state, &me.user_id, &other, msg).await;
    if let Some(client_nonce) = client_nonce {
        state.send_to(
            peer_id,
            ServerMsg::MessageAccepted {
                client_nonce,
                message_id: msg_id.clone(),
            },
        );
    }
    if first_message {
        social::refresh_pair(state, &me.user_id, &other).await;
    }

    if let Some(target_url) = crate::services::preview::extract_first_url(&text_for_preview) {
        let app_state = state.clone();
        let author_id = me.user_id.clone();
        let other_id = other.clone();
        tokio::spawn(async move {
            if let Some(preview) = crate::services::preview::scrape_metadata(&target_url).await {
                let enriched_msg = ServerMsg::LinkPreviewEnriched {
                    message_id: msg_id,
                    preview,
                };
                for session_peer in app_state.sessions_of(&author_id).await {
                    app_state.send_to(&session_peer, enriched_msg.clone());
                }
                for session_peer in app_state.sessions_of(&other_id).await {
                    app_state.send_to(&session_peer, enriched_msg.clone());
                }
            }
        });
    }
}

/// Entrega uma mensagem ja gravada nas duas pontas.
///
/// Cada lado recebe um payload diferente: `user_id` e sempre a OUTRA pessoa na
/// visao de quem recebe, e `unread` e a contagem daquele destinatario. Usada
/// tambem pelo rastro de chamada, que grava direto no banco.
pub async fn deliver(state: &AppState, author: &UserId, other: &UserId, msg: DirectMessage) {
    let conversation = conversation_id(author, other);

    for (dono, contraparte) in [(author, other), (other, author)] {
        let unread = state
            .db
            .direct_unread(dono, &conversation)
            .await
            .unwrap_or_default();
        for peer in state.sessions_of(dono).await {
            state.send_to(
                &peer,
                ServerMsg::DmNew {
                    user_id: contraparte.clone(),
                    msg: msg.clone(),
                    unread,
                },
            );
        }
    }
}

async fn summary(state: &AppState, me: &UserId, other: &UserId) -> Option<DirectSummary> {
    let account = state.db.account_by_id(other).await.ok()??;
    let conversation = conversation_id(me, other);
    Some(DirectSummary {
        user_id: account.id,
        username: account.username,
        last: state.db.direct_last(&conversation).await.ok().flatten(),
        unread: state
            .db
            .direct_unread(me, &conversation)
            .await
            .unwrap_or_default(),
    })
}

pub async fn account_exists(state: &AppState, user_id: &UserId) -> bool {
    matches!(state.db.account_by_id(user_id).await, Ok(Some(_)))
}

async fn mark(state: &AppState, reader: &UserId, conversation: &str, message_id: Option<&str>) -> bool {
    match state
        .db
        .mark_direct_read_message(reader, conversation, now_ms(), message_id)
        .await
    {
        Ok(marked) => marked,
        Err(err) => {
            tracing::error!(%err, "falha marcando conversa como lida");
            false
        }
    }
}

/// Marca como lida e avisa **todas** as sessoes de quem leu. Sem este aviso a
/// aba que ja estava com a conversa aberta continuaria mostrando o badge.
async fn mark_and_notify(
    state: &AppState,
    reader: &UserId,
    other: &UserId,
    conversation: &str,
    message_id: Option<String>,
) {
    if !mark(state, reader, conversation, message_id.as_deref()).await {
        return;
    }
    for peer in state.sessions_of(reader).await {
        state.send_to(
            &peer,
            ServerMsg::DmRead {
                user_id: other.clone(),
                reader_id: Some(reader.clone()),
                message_id: message_id.clone(),
            },
        );
    }
    for peer in state.sessions_of(other).await {
        state.send_to(
            &peer,
            ServerMsg::DmRead {
                user_id: reader.clone(),
                reader_id: Some(reader.clone()),
                message_id: message_id.clone(),
            },
        );
    }
}

fn refuse(state: &AppState, peer_id: &str, message: &str) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: message.to_string(),
        },
    );
}

fn denied(state: &AppState, peer_id: &str, user_id: UserId) {
    state.send_to(peer_id, ServerMsg::DmDenied { user_id });
}

#[cfg(test)]
mod tests;
