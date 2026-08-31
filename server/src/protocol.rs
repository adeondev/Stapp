//! Fonte da verdade do protocolo.
//!
//! `web/src/protocol.ts` e o espelho manual deste arquivo. Mexeu aqui, mexe la —
//! na mesma alteracao. Nao existe geracao automatica de proposito.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::config::Channel;

pub type PeerId = String;
pub type UserId = String;
pub const PROTOCOL_VERSION: u32 = 5;

/// String secreta serializada normalmente, mas sempre redigida em logs/debug.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

/// Corpo dos endpoints HTTP de login e registro. Nao derive `Debug`: carrega
/// senha em texto apenas durante a verificacao.
#[derive(Deserialize)]
pub struct AuthRequest {
    pub username: String,
    pub password: String,
    pub remember: bool,
}

#[derive(Serialize)]
pub struct AuthSession {
    pub access_token: String,
    pub access_expires_at: i64,
}

#[derive(Serialize)]
pub struct ApiError {
    pub code: AuthErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

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
    pub camera_enabled: bool,
    pub screen_sharing: bool,
}

/// Metadados de um link enriquecido via OpenGraph / tags HTML.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UrlPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

/// Metadados de um anexo privado. O conteúdo exige ticket temporário.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waveform: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollOption {
    pub id: String,
    pub text: String,
    pub votes: usize,
    /// Se o usuário da sessão atual votou nesta opção.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voted_by_me: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Poll {
    pub id: String,
    pub message_id: String,
    pub author_id: UserId,
    pub question: String,
    pub allow_mult: bool,
    pub closed: bool,
    pub total_votes: usize,
    pub options: Vec<PollOption>,
    pub created_at: i64,
}

/// A mensagem que esta sendo respondida, ja resolvida pelo servidor.
///
/// A linha guarda so o id; isto aqui e montado na leitura. Assim o trecho
/// acompanha uma edicao do alvo sozinho, sem copia para sincronizar.
///
/// **Campos internos ausentes = o alvo foi apagado.** Apagar e definitivo e nao
/// deixa lapide, entao o cliente desenha "mensagem apagada" a partir disso.
/// `author_username` e registro historico de quem escreveu, como em
/// `Message::author_username` — o nome que aparece na tela sai do perfil vivo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReplyRef {
    pub message_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<UserId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
}

/// Quanto do texto do alvo entra na previa de uma resposta.
pub const REPLY_EXCERPT_CHARS: usize = 120;

/// As reacoes de um emoji, agrupadas.
///
/// Guarda **`user_id`, nunca perfil** — quem resolve nome e cor e o mapa de
/// perfis do cliente. E de proposito que nao existe um `reacted_by_me`: o
/// payload precisa ser identico para todo mundo, senao o broadcast de
/// `chat.updated` estaria errado para todos menos um. Quem quer saber se ja
/// reagiu procura o proprio id em `users`, e a contagem e `users.len()`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reaction {
    pub emoji: String,
    /// Em ordem de chegada.
    pub users: Vec<UserId>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
    /// A mensagem respondida. `None` = mensagem solta.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<ReplyRef>,
    /// Quando foi editada pela ultima vez. `None` = nunca editada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<Reaction>,
    /// Contas citadas no texto, resolvidas pelo servidor no envio e na edicao.
    /// So `user_id`: o nome sai do perfil vivo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<UserId>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub mentions_everyone: bool,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
    /// A mensagem respondida. `None` = mensagem solta.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<ReplyRef>,
    /// Quando foi editada pela ultima vez. `None` = nunca editada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<Reaction>,
    /// Contas citadas no texto, resolvidas pelo servidor no envio e na edicao.
    /// So `user_id`: o nome sai do perfil vivo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<UserId>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub mentions_everyone: bool,
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

/// O perfil publico de uma conta.
///
/// **Isto nao e copiado para dentro dos outros payloads de proposito.** Eles
/// levam so `user_id`; o cliente guarda os perfis num mapa e consulta por ali.
/// Sem isso, trocar de avatar exigiria reescrever toda mensagem ja entregue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub user_id: UserId,
    /// O identificador de login. Nao muda.
    pub username: String,
    /// Ja resolvido: cai no `username` quando a pessoa nao escolheu nenhum.
    pub display_name: String,
    /// Nome da cor na paleta, nao o hex — quem manda no valor e o tema.
    pub accent: String,
    pub bio: String,
    /// FUTURE: vira `true` quando a pessoa subir uma imagem. Ate la o avatar e
    /// a inicial na cor escolhida.
    pub has_avatar: bool,
    /// Muda a cada edicao; serve de cache-buster da imagem.
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipState {
    None,
    Incoming,
    Outgoing,
    Friend,
    Blocked,
}

/// Visao personalizada de um membro para a conta autenticada. `can_start_dm`
/// e informativo; o servidor repete a autorizacao ao receber cada acao.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialMember {
    pub user_id: UserId,
    pub username: String,
    pub relationship: RelationshipState,
    pub can_start_dm: bool,
    pub has_conversation: bool,
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

/// Tetos do servidor que o cliente precisa conhecer para avisar antes de a
/// pessoa perder o que escreveu.
///
/// **E conveniencia de interface, nao autorizacao.** Quem decide continua sendo
/// o servidor: `/attachments/presign` confere o tamanho do arquivo e o
/// `clean_text` confere o do texto. O cliente obedece, nao repete a regra —
/// mesmo padrao de `plaintext_auth_allowed` no `auth.required`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Limits {
    pub max_upload_bytes: usize,
    /// Em caracteres, nao bytes.
    pub max_text_chars: usize,
    pub max_attachments_per_message: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "backend", rename_all = "lowercase")]
pub enum VoiceConfig {
    Mesh {
        ice_servers: Vec<String>,
        max_peers: usize,
    },
    Livekit {
        max_peers: usize,
        camera: bool,
        screen_share: bool,
        screen_audio: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceDeniedCode {
    Unavailable,
    Full,
    Forbidden,
    MediaFailure,
    AlreadyConnected,
    GrantExpired,
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

/// Nao derive `Debug`: `auth.access` carrega um token secreto na memoria.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    #[serde(rename = "auth.access")]
    AuthAccess { access_token: String },

    #[serde(rename = "chat.send")]
    ChatSend {
        channel: String,
        text: String,
        #[serde(default)]
        attachment_ids: Vec<String>,
        /// Id da mensagem respondida, se for uma resposta.
        #[serde(default)]
        reply_to: Option<String>,
        #[serde(default)]
        client_nonce: Option<String>,
    },

    /// Criação de enquete nativa em um canal de texto.
    #[serde(rename = "poll.create")]
    PollCreate {
        channel: String,
        question: String,
        options: Vec<String>,
        allow_mult: bool,
    },

    /// Votar em uma opção de enquete (ou desmarcar se já votou).
    #[serde(rename = "poll.vote")]
    PollVote { poll_id: String, option_id: String },

    /// Encerrar a votação da enquete (somente autor).
    #[serde(rename = "poll.close")]
    PollClose { poll_id: String },

    /// Edita a propria mensagem. Serve canal e conversa: o id e unico entre as
    /// duas tabelas, e quem descobre onde ela mora e o servidor.
    #[serde(rename = "message.edit")]
    MessageEdit { message_id: String, text: String },

    /// Apaga a propria mensagem, de vez.
    #[serde(rename = "message.delete")]
    MessageDelete { message_id: String },

    /// Alterna a propria reacao neste emoji.
    #[serde(rename = "message.react")]
    MessageReact { message_id: String, emoji: String },

    /// Abre uma conversa: pede o historico e marca tudo como lido.
    #[serde(rename = "dm.open")]
    DmOpen { user_id: UserId },

    #[serde(rename = "dm.send")]
    DmSend {
        user_id: UserId,
        text: String,
        #[serde(default)]
        attachment_ids: Vec<String>,
        #[serde(default)]
        reply_to: Option<String>,
        #[serde(default)]
        client_nonce: Option<String>,
    },

    /// Marca lida ate agora. Usado quando chega mensagem com a conversa aberta.
    #[serde(rename = "dm.read")]
    DmRead {
        user_id: UserId,
        #[serde(default)]
        message_id: Option<String>,
    },

    #[serde(rename = "chat.read")]
    ChatRead { channel: String, message_id: String },

    #[serde(rename = "typing.set")]
    TypingSet {
        scope_kind: String,
        scope_id: String,
        active: bool,
    },

    #[serde(rename = "friend.request")]
    FriendRequest { user_id: UserId },

    #[serde(rename = "friend.accept")]
    FriendAccept { user_id: UserId },

    #[serde(rename = "friend.decline")]
    FriendDecline { user_id: UserId },

    #[serde(rename = "friend.cancel")]
    FriendCancel { user_id: UserId },

    #[serde(rename = "friend.remove")]
    FriendRemove { user_id: UserId },

    #[serde(rename = "user.block")]
    UserBlock { user_id: UserId },

    #[serde(rename = "user.unblock")]
    UserUnblock { user_id: UserId },

    #[serde(rename = "privacy.update")]
    PrivacyUpdate { allow_member_dms: bool },

    /// Edita o proprio perfil. Campo ausente = nao mexe; `display_name: ""`
    /// limpa e volta a usar o username.
    #[serde(rename = "profile.update")]
    ProfileUpdate {
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default)]
        accent: Option<String>,
        #[serde(default)]
        bio: Option<String>,
    },

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

    /// Confirma que o cliente conseguiu conectar ao SFU com o grant recebido.
    #[serde(rename = "voice.connected")]
    VoiceConnected { channel: String },

    #[serde(rename = "voice.state")]
    VoiceState {
        muted: bool,
        deafened: bool,
        camera_enabled: bool,
        screen_sharing: bool,
    },

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
        server_id: String,
        protocol_version: u32,
        server_name: String,
        registration_enabled: bool,
        /// Se os endpoints HTTP de autenticacao podem receber senha sem TLS
        /// nesta rede. Quem decide e o servidor (`auth.trusted_networks`).
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
        /// Os perfis de todo mundo, inclusive o seu. O cliente indexa por
        /// `user_id` e resolve nome/cor/avatar a partir daqui.
        profiles: Vec<Profile>,
        voice: VoiceConfig,
        voice_peers: Vec<VoicePeer>,
        limits: Limits,
    },

    #[serde(rename = "chat.history")]
    ChatHistory { channel: String, msgs: Vec<Message> },

    #[serde(rename = "chat.new")]
    ChatNew { channel: String, msg: Message },

    #[serde(rename = "message.accepted")]
    MessageAccepted {
        client_nonce: String,
        message_id: String,
    },

    #[serde(rename = "message.failed")]
    MessageFailed {
        client_nonce: String,
        message: String,
    },

    #[serde(rename = "typing")]
    Typing {
        scope_kind: String,
        scope_id: String,
        user_id: UserId,
        username: String,
        active: bool,
        expires_at: i64,
    },

    /// Notificacao assincrona de que um link de uma mensagem teve metadados extraidos.
    #[serde(rename = "chat.preview")]
    LinkPreviewEnriched {
        message_id: String,
        preview: UrlPreview,
    },

    /// Notificação de atualização de uma enquete (novo voto ou encerramento).
    /// A mensagem mudou — texto editado, reacao, o que for. Vem **inteira**: o
    /// cliente troca por id em vez de aplicar um delta, entao um campo novo
    /// amanha nao precisa de evento novo.
    #[serde(rename = "chat.updated")]
    ChatUpdated { channel: String, msg: Message },

    /// A mensagem sumiu de vez. Nao existe lapide.
    #[serde(rename = "chat.deleted")]
    ChatDeleted { channel: String, message_id: String },

    /// Igual ao `dm.new`: `user_id` e sempre **a outra pessoa** na visao de quem
    /// recebe, entao cada lado leva um payload diferente. Nao carrega `unread`
    /// porque editar e reagir nao mexem em nao-lidas.
    #[serde(rename = "dm.updated")]
    DmUpdated { user_id: UserId, msg: DirectMessage },

    /// Apagar **muda** a contagem de nao-lidas — a linha sumiu do COUNT —, entao
    /// este evento leva o `unread` recalculado por destinatario. Sem isso o
    /// badge ficaria preso apontando para uma mensagem que nao existe mais.
    #[serde(rename = "dm.deleted")]
    DmDeleted {
        user_id: UserId,
        message_id: String,
        unread: usize,
    },

    #[serde(rename = "chat.poll_update")]
    ChatPollUpdate { channel: String, poll: Poll },

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
    DmRead {
        user_id: UserId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reader_id: Option<UserId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
    },

    #[serde(rename = "chat.reads")]
    ChatReads {
        channel: String,
        message_id: String,
        readers: Vec<UserId>,
    },

    #[serde(rename = "dm.denied")]
    DmDenied { user_id: UserId },

    #[serde(rename = "social.snapshot")]
    SocialSnapshot {
        allow_member_dms: bool,
        members: Vec<SocialMember>,
    },

    #[serde(rename = "user.online")]
    UserOnline { user: OnlineUser },

    /// Alguem editou o perfil. Vai por broadcast: perfil e publico dentro do
    /// servidor, e todo mundo precisa redesenhar o nome e o avatar na hora.
    #[serde(rename = "user.profile")]
    UserProfile { profile: Profile },

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

    /// Credencial efemera e restrita a uma unica sala LiveKit.
    #[serde(rename = "voice.grant")]
    VoiceGrant {
        channel: String,
        url: String,
        token: SecretString,
        expires_at: i64,
    },

    #[serde(rename = "voice.denied")]
    VoiceDenied {
        channel: String,
        code: VoiceDeniedCode,
        message: String,
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
        camera_enabled: bool,
        screen_sharing: bool,
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

#[cfg(test)]
mod secret_tests {
    use super::SecretString;

    #[test]
    fn segredo_serializa_para_o_cliente_mas_debug_e_redigido() {
        let secret = SecretString::new("token-super-secreto".into());
        assert_eq!(
            serde_json::to_string(&secret).unwrap(),
            "\"token-super-secreto\""
        );
        assert_eq!(format!("{secret:?}"), "[REDACTED]");
    }
}

/// Existe so para o `skip_serializing_if` de um bool.
fn is_false(value: &bool) -> bool {
    !*value
}
