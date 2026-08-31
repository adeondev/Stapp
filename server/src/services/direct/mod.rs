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
use crate::services::social;
use crate::session::AppState;
use crate::storage::conversation_id;

/// Todo mundo com conta neste servidor, menos voce. E a lista de quem da para
/// chamar numa conversa nova.
pub fn directory(state: &AppState, me: &UserId) -> Vec<DirectoryEntry> {
    match state.db.list_accounts() {
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

    let partners = match state.db.direct_partners(&me.user_id) {
        Ok(partners) => partners,
        Err(err) => {
            tracing::error!(%err, "falha listando conversas");
            return;
        }
    };

    let mut conversations = Vec::with_capacity(partners.len());
    for other in partners {
        if let Some(summary) = summary(state, &me.user_id, &other) {
            conversations.push(summary);
        }
    }

    state.send_to(peer_id, ServerMsg::DmList { conversations });
}

pub async fn open(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if !account_exists(state, &other) {
        return refuse(state, peer_id, "essa conta nao existe");
    }
    let exists = state
        .db
        .direct_conversation_exists(&me.user_id, &other)
        .unwrap_or(false);
    if !exists && !state.db.can_direct(&me.user_id, &other).unwrap_or(false) {
        return denied(state, peer_id, other);
    }

    let conversation = conversation_id(&me.user_id, &other);
    let limit = state.config.storage.history_limit;

    let msgs = match state.db.direct_history(&conversation, limit) {
        Ok(msgs) => msgs,
        Err(err) => {
            tracing::error!(%err, "falha lendo conversa");
            return;
        }
    };

    // Abrir a conversa ja marca tudo como lido.
    mark_and_notify(state, &me.user_id, &other, &conversation).await;

    state.send_to(
        peer_id,
        ServerMsg::DmHistory {
            user_id: other,
            msgs,
        },
    );
}

pub async fn mark_read(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    let conversation = conversation_id(&me.user_id, &other);
    mark_and_notify(state, &me.user_id, &other, &conversation).await;
}

pub async fn send(
    state: &Arc<AppState>,
    peer_id: &str,
    other: UserId,
    raw_text: &str,
    attachment_ids: Vec<String>,
) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if other == me.user_id {
        return refuse(state, peer_id, "nao da para conversar consigo mesmo");
    }
    if !account_exists(state, &other) {
        return refuse(state, peer_id, "essa conta nao existe");
    }
    if !state.db.can_direct(&me.user_id, &other).unwrap_or(false) {
        return denied(state, peer_id, other);
    }
    let text = clean_text(raw_text).unwrap_or_default();
    if text.is_empty() && attachment_ids.is_empty() {
        return;
    }

    let first_message = !state
        .db
        .direct_conversation_exists(&me.user_id, &other)
        .unwrap_or(false);
    let conversation = conversation_id(&me.user_id, &other);
    let msg_id = Uuid::new_v4().to_string();

    if !attachment_ids.is_empty() {
        if let Err(err) = state.db.bind_attachments(&msg_id, &attachment_ids) {
            tracing::error!(%err, "falha vinculando anexos em DM");
        }
    }

    let attachments = state
        .db
        .list_attachments(&msg_id, None)
        .unwrap_or_default();

    let msg = DirectMessage {
        id: msg_id.clone(),
        author_id: me.user_id.clone(),
        author_username: me.username.clone(),
        kind: DirectMessageKind::Text,
        text,
        ts: now_ms(),
        attachments,
        poll: None,
    };

    if let Err(err) = state.db.insert_direct(&conversation, &msg) {
        tracing::error!(%err, "falha gravando mensagem direta");
        return refuse(state, peer_id, "nao consegui guardar a mensagem");
    }

    // Quem escreveu ja leu o que escreveu.
    mark(state, &me.user_id, &conversation);

    let msg_id = msg.id.clone();
    let text_for_preview = msg.text.clone();
    deliver(state, &me.user_id, &other, msg).await;
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

fn summary(state: &AppState, me: &UserId, other: &UserId) -> Option<DirectSummary> {
    let account = state.db.account_by_id(other).ok()??;
    let conversation = conversation_id(me, other);
    Some(DirectSummary {
        user_id: account.id,
        username: account.username,
        last: state.db.direct_last(&conversation).ok().flatten(),
        unread: state
            .db
            .direct_unread(me, &conversation)
            .unwrap_or_default(),
    })
}

pub fn account_exists(state: &AppState, user_id: &UserId) -> bool {
    matches!(state.db.account_by_id(user_id), Ok(Some(_)))
}

fn mark(state: &AppState, reader: &UserId, conversation: &str) {
    if let Err(err) = state.db.mark_direct_read(reader, conversation, now_ms()) {
        tracing::error!(%err, "falha marcando conversa como lida");
    }
}

/// Marca como lida e avisa **todas** as sessoes de quem leu. Sem este aviso a
/// aba que ja estava com a conversa aberta continuaria mostrando o badge.
async fn mark_and_notify(state: &AppState, reader: &UserId, other: &UserId, conversation: &str) {
    mark(state, reader, conversation);
    for peer in state.sessions_of(reader).await {
        state.send_to(
            &peer,
            ServerMsg::DmRead {
                user_id: other.clone(),
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
