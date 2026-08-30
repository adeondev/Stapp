//! Amizades, privacidade e bloqueio. Todo snapshot e personalizado e enviado
//! somente para as sessoes da propria conta.

use crate::protocol::{RelationshipState, ServerMsg, SocialMember, UserId};
use crate::services::{call, voice};
use crate::session::AppState;
use crate::storage::Relationship;

pub async fn send_snapshot(state: &AppState, user_id: &UserId) {
    let allow_member_dms = state.db.allow_member_dms(user_id).unwrap_or(true);
    let members = match state.db.social_records(user_id) {
        Ok(records) => records
            .into_iter()
            .map(|record| SocialMember {
                user_id: record.user_id,
                username: record.username,
                relationship: match record.relationship {
                    Relationship::Incoming => RelationshipState::Incoming,
                    Relationship::Outgoing => RelationshipState::Outgoing,
                    Relationship::Friend => RelationshipState::Friend,
                    Relationship::Blocked => RelationshipState::Blocked,
                    // Nao revele que a outra pessoa bloqueou esta conta.
                    Relationship::BlockedBy | Relationship::None => RelationshipState::None,
                },
                can_start_dm: record.can_start_dm,
                has_conversation: record.has_conversation,
            })
            .collect(),
        Err(error) => {
            tracing::error!(%error, "falha montando snapshot social");
            Vec::new()
        }
    };
    for peer in state.sessions_of(user_id).await {
        state.send_to(
            &peer,
            ServerMsg::SocialSnapshot {
                allow_member_dms,
                members: members.clone(),
            },
        );
    }
}

pub async fn refresh_pair(state: &AppState, first: &UserId, second: &UserId) {
    send_snapshot(state, first).await;
    send_snapshot(state, second).await;
}

pub async fn refresh_all_online(state: &AppState) {
    let users = state.snapshot().await;
    for user in users {
        send_snapshot(state, &user.user_id).await;
    }
}

pub async fn request(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if !available(state, &me.user_id, &other) {
        return refuse(state, peer_id);
    }
    match state.db.request_friend(&me.user_id, &other) {
        Ok(true) => refresh_pair(state, &me.user_id, &other).await,
        Ok(false) => refuse(state, peer_id),
        Err(error) => internal(state, peer_id, error),
    }
}

pub async fn accept(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    mutate_pair(state, peer_id, &me.user_id, &other, |db| {
        db.accept_friend(&me.user_id, &other)
    })
    .await;
}

pub async fn decline(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    mutate_pair(state, peer_id, &me.user_id, &other, |db| {
        db.delete_friend_request(&other, &me.user_id)
    })
    .await;
}

pub async fn cancel(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    mutate_pair(state, peer_id, &me.user_id, &other, |db| {
        db.delete_friend_request(&me.user_id, &other)
    })
    .await;
}

pub async fn remove(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    mutate_pair(state, peer_id, &me.user_id, &other, |db| {
        db.remove_friend(&me.user_id, &other)
    })
    .await;
}

pub async fn block(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if !available(state, &me.user_id, &other) {
        return refuse(state, peer_id);
    }
    match state.db.block_user(&me.user_id, &other) {
        Ok(_) => {
            call::block_pair(state, &me.user_id, &other).await;
            voice::disconnect_direct(state, &me.user_id, &other).await;
            refresh_pair(state, &me.user_id, &other).await;
        }
        Err(error) => internal(state, peer_id, error),
    }
}

pub async fn unblock(state: &AppState, peer_id: &str, other: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    mutate_pair(state, peer_id, &me.user_id, &other, |db| {
        db.unblock_user(&me.user_id, &other)
    })
    .await;
}

pub async fn update_privacy(state: &AppState, peer_id: &str, allow: bool) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if let Err(error) = state.db.set_allow_member_dms(&me.user_id, allow) {
        return internal(state, peer_id, error);
    }
    // A permissao muda `can_start_dm` na visao de todos os membros.
    refresh_all_online(state).await;
}

async fn mutate_pair<F>(state: &AppState, peer_id: &str, me: &UserId, other: &UserId, operation: F)
where
    F: FnOnce(&crate::storage::Db) -> anyhow::Result<bool>,
{
    if !available(state, me, other) {
        return refuse(state, peer_id);
    }
    match operation(&state.db) {
        Ok(true) => refresh_pair(state, me, other).await,
        Ok(false) => refuse(state, peer_id),
        Err(error) => internal(state, peer_id, error),
    }
}

fn available(state: &AppState, me: &UserId, other: &UserId) -> bool {
    me != other
        && state
            .db
            .account_by_id(other)
            .ok()
            .flatten()
            .is_some_and(|account| account.disabled_at.is_none())
}

fn refuse(state: &AppState, peer_id: &str) {
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: "essa acao nao esta disponivel".into(),
        },
    );
}

fn internal(state: &AppState, peer_id: &str, error: anyhow::Error) {
    tracing::error!(%error, "falha numa acao social");
    state.send_to(
        peer_id,
        ServerMsg::Error {
            message: "nao foi possivel atualizar agora".into(),
        },
    );
}

#[cfg(test)]
mod tests;
