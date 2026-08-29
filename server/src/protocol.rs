//! Fonte da verdade do protocolo.
//!
//! `web/src/protocol.ts` e o espelho manual deste arquivo. Mexeu aqui, mexe la —
//! na mesma alteracao. Nao existe geracao automatica de proposito.

use serde::{Deserialize, Serialize};

use crate::config::Channel;

pub type PeerId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: PeerId,
    pub nick: String,
}

/// Alguem dentro de uma call. Carrega o estado de mute para a UI nao precisar
/// perguntar depois.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoicePeer {
    pub id: PeerId,
    pub nick: String,
    pub channel: String,
    pub muted: bool,
    pub deafened: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel: String,
    pub nick: String,
    pub text: String,
    /// Milissegundos desde o epoch.
    pub ts: i64,
}

/// O que o cliente precisa saber para falar audio. O campo `backend` e o que
/// permite trocar mesh -> SFU sem tocar na UI: o cliente le isso em runtime e
/// escolhe o transporte.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "backend", rename_all = "lowercase")]
pub enum VoiceConfig {
    Mesh { ice_servers: Vec<String>, max_peers: usize },
    // Livekit { url: String, token: String },  <- proximo passo
}

// ---------------------------------------------------------------- cliente -> servidor

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    /// Sempre a primeira mensagem. Ate ela chegar a conexao nao existe para ninguem.
    #[serde(rename = "hello")]
    Hello { nick: String },

    #[serde(rename = "chat.send")]
    ChatSend { channel: String, text: String },

    #[serde(rename = "voice.join")]
    VoiceJoin { channel: String },

    #[serde(rename = "voice.leave")]
    VoiceLeave,

    #[serde(rename = "voice.state")]
    VoiceState { muted: bool, deafened: bool },

    /// Offer, answer ou candidato ICE. O servidor nao le o conteudo, so entrega.
    #[serde(rename = "rtc.signal")]
    RtcSignal { to: PeerId, payload: serde_json::Value },
}

// ---------------------------------------------------------------- servidor -> cliente

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ServerMsg {
    #[serde(rename = "welcome")]
    Welcome {
        self_id: PeerId,
        server_name: String,
        channels: Vec<Channel>,
        users: Vec<User>,
        voice: VoiceConfig,
        /// Quem ja esta em call, de todos os canais de voz.
        voice_peers: Vec<VoicePeer>,
    },

    /// Mandado uma vez por canal de texto logo depois do welcome.
    #[serde(rename = "chat.history")]
    ChatHistory { channel: String, msgs: Vec<Message> },

    #[serde(rename = "chat.new")]
    ChatNew { channel: String, msg: Message },

    #[serde(rename = "user.joined")]
    UserJoined { user: User },

    #[serde(rename = "user.left")]
    UserLeft { user_id: PeerId },

    /// Quem ja estava na call, entregue so a quem acabou de entrar.
    /// E este lado que cria as offers — ver a regra anti-glare no CLAUDE.md.
    #[serde(rename = "voice.roster")]
    VoiceRoster { channel: String, peers: Vec<VoicePeer> },

    #[serde(rename = "voice.joined")]
    VoiceJoined { peer: VoicePeer },

    #[serde(rename = "voice.left")]
    VoiceLeft { peer_id: PeerId },

    #[serde(rename = "voice.state")]
    VoiceStateChanged { peer_id: PeerId, muted: bool, deafened: bool },

    #[serde(rename = "rtc.signal")]
    RtcSignal { from: PeerId, payload: serde_json::Value },

    #[serde(rename = "error")]
    Error { message: String },
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
