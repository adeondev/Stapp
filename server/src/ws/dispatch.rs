//! Roteamento das mensagens de uma sessao ja autenticada.
//!
//! **E aqui que entra funcionalidade nova.** Cada braco do `match` chama um
//! servico e nada mais — se um deles comecar a ganhar logica propria, o lugar
//! dela e no servico, nao neste arquivo.

use std::sync::Arc;

use crate::services::chat;
use crate::protocol::{ClientMsg, PeerId};
use crate::session::AppState;
use crate::services::voice;

pub(super) async fn handle(state: &Arc<AppState>, peer_id: &PeerId, msg: ClientMsg) {
    match msg {
        // Ja autenticada: reautenticar no mesmo socket nao significa nada.
        // Trocar de conta e abrir outra conexao.
        ClientMsg::AuthLogin { .. } | ClientMsg::AuthRegister { .. } => {}

        ClientMsg::ChatSend { channel, text } => chat::send(state, peer_id, channel, &text).await,

        ClientMsg::VoiceJoin { channel } => voice::join(state, peer_id, &channel).await,
        ClientMsg::VoiceLeave => voice::leave(state, peer_id).await,
        ClientMsg::VoiceState { muted, deafened } => {
            voice::set_state(state, peer_id, muted, deafened).await
        }
        ClientMsg::RtcSignal { to, payload } => voice::relay(state, peer_id, &to, payload).await,
    }
}
