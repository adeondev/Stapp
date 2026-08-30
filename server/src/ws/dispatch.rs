//! Roteamento das mensagens de uma sessao ja autenticada.
//!
//! **E aqui que entra funcionalidade nova.** Cada braco do `match` chama um
//! servico e nada mais — se um deles comecar a ganhar logica propria, o lugar
//! dela e no servico, nao neste arquivo.

use std::sync::Arc;

use crate::protocol::{ClientMsg, PeerId};
use crate::services::call;
use crate::services::chat;
use crate::services::direct;
use crate::services::social;
use crate::services::voice;
use crate::session::AppState;

pub(super) async fn handle(state: &Arc<AppState>, peer_id: &PeerId, msg: ClientMsg) {
    match msg {
        // Ja autenticada: reautenticar no mesmo socket nao significa nada.
        // Trocar de conta e abrir outra conexao.
        ClientMsg::AuthAccess { .. } => {}

        ClientMsg::ChatSend { channel, text } => chat::send(state, peer_id, channel, &text).await,

        ClientMsg::DmOpen { user_id } => direct::open(state, peer_id, user_id).await,
        ClientMsg::DmSend { user_id, text } => direct::send(state, peer_id, user_id, &text).await,
        ClientMsg::DmRead { user_id } => direct::mark_read(state, peer_id, user_id).await,

        ClientMsg::FriendRequest { user_id } => social::request(state, peer_id, user_id).await,
        ClientMsg::FriendAccept { user_id } => social::accept(state, peer_id, user_id).await,
        ClientMsg::FriendDecline { user_id } => social::decline(state, peer_id, user_id).await,
        ClientMsg::FriendCancel { user_id } => social::cancel(state, peer_id, user_id).await,
        ClientMsg::FriendRemove { user_id } => social::remove(state, peer_id, user_id).await,
        ClientMsg::UserBlock { user_id } => social::block(state, peer_id, user_id).await,
        ClientMsg::UserUnblock { user_id } => social::unblock(state, peer_id, user_id).await,
        ClientMsg::PrivacyUpdate { allow_member_dms } => {
            social::update_privacy(state, peer_id, allow_member_dms).await
        }

        ClientMsg::CallStart { user_id } => call::start(state, peer_id, user_id).await,
        ClientMsg::CallAccept { user_id } => call::accept(state, peer_id, user_id).await,
        ClientMsg::CallDecline { user_id } => call::decline(state, peer_id, user_id).await,
        ClientMsg::CallCancel { user_id } => call::cancel(state, peer_id, user_id).await,

        ClientMsg::VoiceJoin { channel } => voice::join(state, peer_id, &channel).await,
        ClientMsg::VoiceLeave => voice::leave(state, peer_id).await,
        ClientMsg::VoiceState { muted, deafened } => {
            voice::set_state(state, peer_id, muted, deafened).await
        }
        ClientMsg::RtcSignal { to, payload } => voice::relay(state, peer_id, &to, payload).await,
    }
}
