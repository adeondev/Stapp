//! Chamada 1:1 dentro de uma conversa direta.
//!
//! Este modulo cuida so do **toque**: ligar, tocar, atender, recusar, desistir,
//! expirar. Assim que a chamada e aceita ela deixa de existir aqui e vira um
//! canal de voz comum (`dm:<a>:<b>`), tratado pelo [`crate::services::voice`]
//! como qualquer sala — mesmo mesh, mesma sinalizacao.
//!
//! Regra combinada: **toca mesmo se a pessoa ja estiver numa sala de voz.**
//! Quem decide sair de la e ela, ao atender; o `voice::join` ja tira de uma call
//! antes de entrar em outra.

use std::sync::Arc;
use std::time::Duration;

use uuid::Uuid;

use crate::protocol::{CallEndReason, DirectMessage, DirectMessageKind, ServerMsg, UserId, now_ms};
use crate::services::{direct, voice};
use crate::session::{AppState, CallStartError, PendingCall};
use crate::storage::conversation_id;

/// Quanto tempo o telefone toca antes de virar chamada perdida.
const RING_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn start(state: &Arc<AppState>, peer_id: &str, to: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    if to == me.user_id {
        return ended_to_caller(state, &me.user_id, &to, CallEndReason::Unavailable).await;
    }
    if !direct::account_exists(state, &to) {
        return ended_to_caller(state, &me.user_id, &to, CallEndReason::Unavailable).await;
    }
    if !state.db.can_direct(&me.user_id, &to).unwrap_or(false) {
        return ended_to_caller(state, &me.user_id, &to, CallEndReason::Unavailable).await;
    }

    let destinos = state.sessions_of(&to).await;
    if destinos.is_empty() {
        return ended_to_caller(state, &me.user_id, &to, CallEndReason::Offline).await;
    }

    let call = match state.start_call(&me.user_id, &to).await {
        Ok(call) => call,
        Err(CallStartError::Busy) => {
            return ended_to_caller(state, &me.user_id, &to, CallEndReason::Busy).await;
        }
    };

    // Toca do outro lado...
    for destino in destinos {
        state.send_to(
            &destino,
            ServerMsg::CallIncoming {
                user_id: me.user_id.clone(),
                username: me.username.clone(),
            },
        );
    }
    // ...e quem ligou fica sabendo que esta tocando.
    notify(
        state,
        &me.user_id,
        ServerMsg::CallRinging {
            user_id: to.clone(),
        },
    )
    .await;

    arm_timeout(state, call);
}

/// Bloquear nao vira chamada perdida: encerra o toque de forma privada e
/// generica, sem acrescentar uma mensagem nova ao historico.
pub async fn block_pair(state: &AppState, first: &UserId, second: &UserId) {
    let Some(call) = state.take_call(first, second).await else {
        return;
    };
    for (owner, other) in [(&call.from, &call.to), (&call.to, &call.from)] {
        notify(
            state,
            owner,
            ServerMsg::CallEnded {
                user_id: other.clone(),
                reason: CallEndReason::Unavailable,
            },
        )
        .await;
    }
}

pub async fn accept(state: &Arc<AppState>, peer_id: &str, from: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    let Some(call) = state.take_call(&me.user_id, &from).await else {
        return;
    };
    // So quem recebeu a chamada pode atender.
    if call.to != me.user_id {
        return;
    }

    state.authorize_direct_call(&call.from, &call.to).await;
    let channel = voice::direct_channel(&call.from, &call.to);
    for lado in [&call.from, &call.to] {
        let outro = if lado == &call.from {
            &call.to
        } else {
            &call.from
        };
        notify(
            state,
            lado,
            ServerMsg::CallAccepted {
                user_id: outro.clone(),
                channel: channel.clone(),
            },
        )
        .await;
    }
}

pub async fn decline(state: &Arc<AppState>, peer_id: &str, from: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    let Some(call) = state.take_call(&me.user_id, &from).await else {
        return;
    };
    if call.to != me.user_id {
        return;
    }
    finish(state, &call, CallEndReason::Declined).await;
}

/// Quem ligou desistiu antes de ser atendido.
pub async fn cancel(state: &Arc<AppState>, peer_id: &str, to: UserId) {
    let Some(me) = state.identity_of(peer_id).await else {
        return;
    };
    let Some(call) = state.take_call(&me.user_id, &to).await else {
        return;
    };
    if call.from != me.user_id {
        return;
    }
    finish(state, &call, CallEndReason::Canceled).await;
}

/// Chamado quando uma conexao cai: nao da para deixar tocando para o outro lado.
pub async fn drop_for(state: &Arc<AppState>, user_id: &UserId) {
    for call in state.drop_calls_of(user_id).await {
        let reason = if &call.from == user_id {
            CallEndReason::Canceled
        } else {
            CallEndReason::Missed
        };
        finish(state, &call, reason).await;
    }
}

/// Avisa os dois lados e deixa o rastro na conversa.
async fn finish(state: &Arc<AppState>, call: &PendingCall, reason: CallEndReason) {
    notify(
        state,
        &call.from,
        ServerMsg::CallEnded {
            user_id: call.to.clone(),
            reason,
        },
    )
    .await;
    notify(
        state,
        &call.to,
        ServerMsg::CallEnded {
            user_id: call.from.clone(),
            reason,
        },
    )
    .await;

    record(state, call, reason).await;
}

/// Uma chamada que nao vingou vira uma linha na conversa — senao a pessoa nunca
/// fica sabendo que tentaram falar com ela enquanto estava fora.
async fn record(state: &Arc<AppState>, call: &PendingCall, reason: CallEndReason) {
    let texto = match reason {
        CallEndReason::Declined => "chamada recusada",
        CallEndReason::Canceled | CallEndReason::Missed => "chamada perdida",
        // Nao chegou a tocar: nao vale uma linha no historico.
        CallEndReason::Busy | CallEndReason::Offline | CallEndReason::Unavailable => return,
    };

    let Some(quem_ligou) = state.db.account_by_id(&call.from).ok().flatten() else {
        return;
    };
    let msg = DirectMessage {
        id: Uuid::new_v4().to_string(),
        author_id: quem_ligou.id,
        author_username: quem_ligou.username,
        kind: DirectMessageKind::Call,
        text: texto.to_string(),
        ts: now_ms(),
    };

    let conversation = conversation_id(&call.from, &call.to);
    if let Err(err) = state.db.insert_direct(&conversation, &msg) {
        tracing::error!(%err, "falha gravando o rastro da chamada");
        return;
    }
    direct::deliver(state, &call.from, &call.to, msg).await;
}

/// Depois de [`RING_TIMEOUT`] a chamada vira perdida sozinha. O id evita que um
/// timer velho derrube uma chamada nova entre as mesmas duas pessoas.
fn arm_timeout(state: &Arc<AppState>, call: PendingCall) {
    let state = Arc::clone(state);
    tokio::spawn(async move {
        tokio::time::sleep(RING_TIMEOUT).await;
        if let Some(expirada) = state.expire_call(&call.from, &call.to, &call.id).await {
            finish(&state, &expirada, CallEndReason::Missed).await;
        }
    });
}

async fn notify(state: &AppState, user_id: &UserId, msg: ServerMsg) {
    for peer in state.sessions_of(user_id).await {
        state.send_to(&peer, msg.clone());
    }
}

async fn ended_to_caller(state: &AppState, caller: &UserId, other: &UserId, reason: CallEndReason) {
    notify(
        state,
        caller,
        ServerMsg::CallEnded {
            user_id: other.clone(),
            reason,
        },
    )
    .await;
}

#[cfg(test)]
mod tests;
