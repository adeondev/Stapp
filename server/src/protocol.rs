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

/// Uma mensagem direta. Nao carrega canal: a conversa e o par de contas, e quem
/// le ja sabe com quem esta falando.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectMessage {
    pub id: String,
    pub author_id: UserId,
    pub author_username: String,
    pub kind: DirectMessageKind,
    pub text: String,
    pub ts: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectMessageKind {
    Text,
    /// Rastro de uma chamada 1:1 na conversa ("chamada perdida", duracao).
    /// FUTURE: so passa a ser gravado quando a chamada direta existir.
    Call,
}

/// Uma conversa na lista lateral, do ponto de vista de quem recebe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectSummary {
    /// A outra pessoa da conversa.
    pub user_id: UserId,
    pub username: String,
    pub last: Option<DirectMessage>,
    pub unread: usize,
}

/// Alguem com conta neste servidor, online ou nao. E daqui que sai a lista de
/// quem da para chamar numa DM — sem isso so daria para falar com quem esta
/// conectado no momento.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub user_id: UserId,
    pub username: String,
}

/// Por que uma chamada 1:1 terminou sem virar conversa.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallEndReason {
    /// A pessoa recusou.
    Declined,
    /// Quem ligou desistiu antes de ser atendido.
    Canceled,
    /// Tocou ate o fim e ninguem atendeu.
    Missed,
    /// Uma das pontas ja estava com outra chamada tocando.
    Busy,
    /// A pessoa nao esta conectada.
    Offline,
    /// A conta nao existe, ou nao da para ligar para ela.
    Unavailable,
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

    /// Abre uma conversa: pede o historico e marca tudo como lido.
    #[serde(rename = "dm.open")]
    DmOpen { user_id: UserId },

    #[serde(rename = "dm.send")]
    DmSend { user_id: UserId, text: String },

    /// Marca lida ate agora. Usado quando chega mensagem com a conversa aberta.
    #[serde(rename = "dm.read")]
    DmRead { user_id: UserId },

    #[serde(rename = "call.start")]
    CallStart { user_id: UserId },

    #[serde(rename = "call.accept")]
    CallAccept { user_id: UserId },

    #[serde(rename = "call.decline")]
    CallDecline { user_id: UserId },

    /// Quem ligou desistiu antes de ser atendido.
    #[serde(rename = "call.cancel")]
    CallCancel { user_id: UserId },

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
        /// Todas as contas do servidor, online ou nao — e com quem da para
        /// abrir uma conversa.
        directory: Vec<DirectoryEntry>,
        voice: VoiceConfig,
        voice_peers: Vec<VoicePeer>,
    },

    #[serde(rename = "chat.history")]
    ChatHistory { channel: String, msgs: Vec<Message> },

    #[serde(rename = "chat.new")]
    ChatNew { channel: String, msg: Message },

    /// A lista lateral de conversas, com nao-lidas. Vai logo depois do welcome.
    #[serde(rename = "dm.list")]
    DmList { conversations: Vec<DirectSummary> },

    #[serde(rename = "dm.history")]
    DmHistory {
        user_id: UserId,
        msgs: Vec<DirectMessage>,
    },

    /// `user_id` e sempre **a outra pessoa** da conversa, na visao de quem
    /// recebe — por isso cada lado recebe um payload diferente.
    #[serde(rename = "dm.new")]
    DmNew {
        user_id: UserId,
        msg: DirectMessage,
        /// Nao-lidas desta conversa para quem esta recebendo (0 para o autor).
        unread: usize,
    },

    /// Esta conversa ficou sem nao-lidas. Vai para **todas** as sessoes da
    /// conta, entao ler no celular limpa o badge do PC.
    #[serde(rename = "dm.read")]
    DmRead { user_id: UserId },

    #[serde(rename = "user.online")]
    UserOnline { user: OnlineUser },

    #[serde(rename = "user.offline")]
    UserOffline { user_id: UserId },

    /// Esta tocando para voce.
    #[serde(rename = "call.incoming")]
    CallIncoming { user_id: UserId, username: String },

    /// Confirmacao para quem ligou: esta tocando do outro lado.
    #[serde(rename = "call.ringing")]
    CallRinging { user_id: UserId },

    /// Atendeu. Os dois lados entram neste canal de voz.
    #[serde(rename = "call.accepted")]
    CallAccepted { user_id: UserId, channel: String },

    /// Acabou sem virar conversa. Vale para os dois lados.
    #[serde(rename = "call.ended")]
    CallEnded {
        user_id: UserId,
        reason: CallEndReason,
    },

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
