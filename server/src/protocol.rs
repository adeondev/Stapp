//! Fonte da verdade do protocolo.
//!
//! `web/src/protocol.ts` e o espelho manual deste arquivo. Mexeu aqui, mexe la —
//! na mesma alteracao. Nao existe geracao automatica de proposito.

use serde::{Deserialize, Serialize};

use crate::config::Channel;

pub type PeerId = String;
pub type UserId = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnlineUser {
    pub user_id: UserId,
    pub username: String,
}

/// Uma conexao dentro de uma call. `peer_id` e efemero; `user_id` e a conta.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoicePeer {
    pub peer_id: PeerId,
    pub user_id: UserId,
    pub username: String,
    pub channel: String,
    pub muted: bool,
    pub deafened: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel: String,
    pub author_id: UserId,
    pub author_username: String,
    pub text: String,
    /// Milissegundos desde o epoch.
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "backend", rename_all = "lowercase")]
pub enum VoiceConfig {
    Mesh {
        ice_servers: Vec<String>,
        max_peers: usize,
    },
    // Livekit { url: String, token: String },  <- proximo passo
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthErrorCode {
    InvalidCredentials,
    RegistrationDisabled,
    UsernameUnavailable,
    InvalidUsername,
    InvalidPassword,
    RateLimited,
    ServerFull,
    TooManySessions,
    SecureTransportRequired,
}

// ---------------------------------------------------------------- cliente -> servidor

/// Nao derive `Debug`: as variantes de autenticacao carregam senha em texto na memoria.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    #[serde(rename = "auth.login")]
    AuthLogin { username: String, password: String },

    #[serde(rename = "auth.register")]
    AuthRegister { username: String, password: String },

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
    RtcSignal {
        to: PeerId,
        payload: serde_json::Value,
    },
}

// ---------------------------------------------------------------- servidor -> cliente

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ServerMsg {
    /// Primeiro frame de toda conexao; ainda nao concede acesso a sala.
    #[serde(rename = "auth.required")]
    AuthRequired {
        server_name: String,
        registration_enabled: bool,
        /// Se ESTA conexao pode mandar senha sem TLS. Quem decide e o servidor
        /// (`auth.trusted_networks`), entao o cliente nao precisa repetir a
        /// regra — ele so obedece.
        plaintext_auth_allowed: bool,
    },

    #[serde(rename = "auth.error")]
    AuthError {
        code: AuthErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after_ms: Option<u64>,
    },

    #[serde(rename = "welcome")]
    Welcome {
        self_peer_id: PeerId,
        self_user_id: UserId,
        server_name: String,
        channels: Vec<Channel>,
        users: Vec<OnlineUser>,
        voice: VoiceConfig,
        voice_peers: Vec<VoicePeer>,
    },

    #[serde(rename = "chat.history")]
    ChatHistory { channel: String, msgs: Vec<Message> },

    #[serde(rename = "chat.new")]
    ChatNew { channel: String, msg: Message },

    #[serde(rename = "user.online")]
    UserOnline { user: OnlineUser },

    #[serde(rename = "user.offline")]
    UserOffline { user_id: UserId },

    #[serde(rename = "voice.roster")]
    VoiceRoster {
        channel: String,
        peers: Vec<VoicePeer>,
    },

    #[serde(rename = "voice.joined")]
    VoiceJoined { peer: VoicePeer },

    #[serde(rename = "voice.left")]
    VoiceLeft { peer_id: PeerId },

    #[serde(rename = "voice.state")]
    VoiceStateChanged {
        peer_id: PeerId,
        muted: bool,
        deafened: bool,
    },

    #[serde(rename = "rtc.signal")]
    RtcSignal {
        from: PeerId,
        payload: serde_json::Value,
    },

    #[serde(rename = "error")]
    Error { message: String },
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
