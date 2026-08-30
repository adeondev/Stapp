//! Chamadas 1:1 que ainda estao tocando.
//!
//! So o intervalo entre "liguei" e "atendeu/recusou/desistiu". Depois que
//! aceita, a chamada vira um canal de voz comum (`dm:<a>:<b>`) e some daqui —
//! quem cuida do resto e o [`crate::services::voice`].

use std::collections::HashMap;

use uuid::Uuid;

use super::AppState;
use crate::protocol::UserId;
use crate::storage::conversation_id;

#[derive(Debug, Clone)]
pub struct PendingCall {
    /// Identifica esta tentativa. O timer de expiracao carrega o mesmo id, para
    /// nao derrubar uma chamada nova que tenha comecado no lugar da antiga.
    pub id: String,
    pub from: UserId,
    pub to: UserId,
}

#[derive(Debug)]
pub enum CallStartError {
    /// Uma das duas pontas ja esta com o telefone na mao.
    Busy,
}

#[derive(Default)]
pub struct Calls {
    /// Chave: a conversa. So existe uma chamada tocando por par.
    pending: HashMap<String, PendingCall>,
}

impl AppState {
    /// Registra a tentativa e devolve o id dela.
    pub async fn start_call(
        &self,
        from: &UserId,
        to: &UserId,
    ) -> Result<PendingCall, CallStartError> {
        let mut calls = self.calls.write().await;
        if calls
            .pending
            .values()
            .any(|call| envolve(call, from) || envolve(call, to))
        {
            return Err(CallStartError::Busy);
        }

        let call = PendingCall {
            id: Uuid::new_v4().to_string(),
            from: from.clone(),
            to: to.clone(),
        };
        calls
            .pending
            .insert(conversation_id(from, to), call.clone());
        Ok(call)
    }

    /// Tira a chamada da mesa. `esperado` limita a quem tem direito de encerrar:
    /// so quem ligou pode desistir, so quem recebeu pode recusar.
    pub async fn take_call(&self, a: &UserId, b: &UserId) -> Option<PendingCall> {
        self.calls
            .write()
            .await
            .pending
            .remove(&conversation_id(a, b))
    }

    /// Usada pelo timer: so encerra se ainda for a mesma tentativa.
    pub async fn expire_call(&self, a: &UserId, b: &UserId, id: &str) -> Option<PendingCall> {
        let mut calls = self.calls.write().await;
        let chave = conversation_id(a, b);
        match calls.pending.get(&chave) {
            Some(call) if call.id == id => calls.pending.remove(&chave),
            _ => None,
        }
    }

    /// Encerra qualquer chamada tocando que envolva esta conta. Usada quando
    /// alguem cai — senao a chamada ficaria tocando para o outro lado.
    pub async fn drop_calls_of(&self, user_id: &UserId) -> Vec<PendingCall> {
        let mut calls = self.calls.write().await;
        let chaves: Vec<String> = calls
            .pending
            .iter()
            .filter(|(_, call)| envolve(call, user_id))
            .map(|(chave, _)| chave.clone())
            .collect();
        chaves
            .into_iter()
            .filter_map(|chave| calls.pending.remove(&chave))
            .collect()
    }
}

fn envolve(call: &PendingCall, user_id: &UserId) -> bool {
    &call.from == user_id || &call.to == user_id
}
