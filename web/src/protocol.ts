// Espelho manual de `server/src/protocol.rs`. Mexeu la, mexe aqui — na mesma
// alteracao. Os campos sao snake_case porque vem direto do serde; e proposital.

export type PeerId = string
export type UserId = string
export type ChannelKind = 'text' | 'voice'
export const PROTOCOL_VERSION = 3

export interface Channel {
  id: string
  name: string
  kind: ChannelKind
}

export interface OnlineUser {
  user_id: UserId
  username: string
}

export interface VoicePeer {
  peer_id: PeerId
  user_id: UserId
  username: string
  channel: string
  muted: boolean
  deafened: boolean
  camera_enabled: boolean
  screen_sharing: boolean
}

export interface Message {
  id: string
  channel: string
  author_id: UserId
  author_username: string
  text: string
  /** Milissegundos desde o epoch. */
  ts: number
}

export interface UrlPreview {
  url: string
  title?: string
  description?: string
  image?: string
  site_name?: string
}

/** O que Chat sabe renderizar. Message e DirectMessage servem os dois. */
export interface ChatEntry {
  id: string
  author_id: UserId
  author_username: string
  text: string
  ts: number
  /** Ausente numa mensagem de canal; 'call' e o rastro de uma chamada. */
  kind?: DirectMessageKind
  preview?: UrlPreview
}

export type DirectMessageKind = 'text' | 'call'

/** Nao carrega canal: a conversa e o par de contas. */
export interface DirectMessage {
  id: string
  author_id: UserId
  author_username: string
  kind: DirectMessageKind
  text: string
  ts: number
}

/** Uma conversa na lista lateral, ja do ponto de vista de quem recebe. */
export interface DirectSummary {
  /** A outra pessoa da conversa. */
  user_id: UserId
  username: string
  last: DirectMessage | null
  unread: number
}

/** Alguem com conta no servidor, online ou nao. */
export interface DirectoryEntry {
  user_id: UserId
  username: string
}

/**
 * O perfil publico de uma conta.
 *
 * **Nao vem copiado dentro dos outros payloads de proposito.** Eles levam so
 * `user_id`; o store guarda os perfis num mapa e a UI consulta por ali. Sem
 * isso, trocar de avatar deixaria toda mensagem ja recebida com a foto velha.
 */
export interface Profile {
  user_id: UserId
  /** O identificador de login. Nao muda. */
  username: string
  /** Ja resolvido: cai no username quando a pessoa nao escolheu nenhum. */
  display_name: string
  /** Nome da cor na paleta, nao o hex — quem manda no valor e o tema. */
  accent: AccentName
  bio: string
  has_avatar: boolean
  updated_at: number
}

/** Tem que bater com `ACCENTS` em `server/src/services/profile/mod.rs`. */
export const ACCENTS = ['blue', 'green', 'red', 'amber', 'purple', 'cyan'] as const
export type AccentName = (typeof ACCENTS)[number]

export type RelationshipState = 'none' | 'incoming' | 'outgoing' | 'friend' | 'blocked'

export interface SocialMember {
  user_id: UserId
  username: string
  relationship: RelationshipState
  can_start_dm: boolean
  has_conversation: boolean
}

export interface AuthSession {
  access_token: string
  access_expires_at: number
}

export interface ApiError {
  code: AuthErrorCode
  message: string
  retry_after_ms?: number
}

/** Por que uma chamada 1:1 terminou sem virar conversa. */
export type CallEndReason =
  | 'declined'
  | 'canceled'
  | 'missed'
  | 'busy'
  | 'offline'
  | 'unavailable'

export type VoiceConfig =
  | { backend: 'mesh'; ice_servers: string[]; max_peers: number }
  | {
      backend: 'livekit'
      max_peers: number
      camera: boolean
      screen_share: boolean
      screen_audio: boolean
    }

export type VoiceDeniedCode =
  | 'unavailable'
  | 'full'
  | 'forbidden'
  | 'media_failure'
  | 'already_connected'
  | 'grant_expired'

export type RtcPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export type AuthMode = 'login' | 'register'
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'registration_disabled'
  | 'username_unavailable'
  | 'invalid_username'
  | 'invalid_password'
  | 'rate_limited'
  | 'server_full'
  | 'too_many_sessions'
  | 'secure_transport_required'

export type ClientMsg =
  | { t: 'auth.access'; access_token: string }
  | { t: 'chat.send'; channel: string; text: string }
  | { t: 'dm.open'; user_id: UserId }
  | { t: 'dm.send'; user_id: UserId; text: string }
  | { t: 'dm.read'; user_id: UserId }
  | { t: 'friend.request'; user_id: UserId }
  | { t: 'friend.accept'; user_id: UserId }
  | { t: 'friend.decline'; user_id: UserId }
  | { t: 'friend.cancel'; user_id: UserId }
  | { t: 'friend.remove'; user_id: UserId }
  | { t: 'user.block'; user_id: UserId }
  | { t: 'user.unblock'; user_id: UserId }
  | { t: 'privacy.update'; allow_member_dms: boolean }
  | {
      /** Campo ausente = nao mexe; display_name vazio volta a usar o username. */
      t: 'profile.update'
      display_name?: string
      accent?: AccentName
      bio?: string
    }
  | { t: 'call.start'; user_id: UserId }
  | { t: 'call.accept'; user_id: UserId }
  | { t: 'call.decline'; user_id: UserId }
  | { t: 'call.cancel'; user_id: UserId }
  | { t: 'voice.join'; channel: string }
  | { t: 'voice.leave' }
  | { t: 'voice.connected'; channel: string }
  | {
      t: 'voice.state'
      muted: boolean
      deafened: boolean
      camera_enabled: boolean
      screen_sharing: boolean
    }
  | { t: 'rtc.signal'; to: PeerId; payload: RtcPayload }

export type ServerMsg =
  | {
      t: 'auth.required'
      server_id: string
      protocol_version: number
      server_name: string
      registration_enabled: boolean
      /** Se os endpoints HTTP de autenticacao podem receber senha sem TLS nesta rede. */
      plaintext_auth_allowed: boolean
    }
  | { t: 'auth.error'; code: AuthErrorCode; message: string; retry_after_ms?: number }
  | {
      t: 'welcome'
      self_peer_id: PeerId
      self_user_id: UserId
      server_name: string
      channels: Channel[]
      users: OnlineUser[]
      /** Todas as contas do servidor, online ou nao. */
      directory: DirectoryEntry[]
      /** Os perfis de todo mundo, inclusive o seu. */
      profiles: Profile[]
      voice: VoiceConfig
      voice_peers: VoicePeer[]
    }
  | { t: 'chat.history'; channel: string; msgs: Message[] }
  | { t: 'chat.new'; channel: string; msg: Message }
  | { t: 'chat.preview'; message_id: string; preview: UrlPreview }
  | { t: 'dm.list'; conversations: DirectSummary[] }
  | { t: 'dm.history'; user_id: UserId; msgs: DirectMessage[] }
  | {
      t: 'dm.new'
      /** Sempre a OUTRA pessoa da conversa, na visao de quem recebe. */
      user_id: UserId
      msg: DirectMessage
      unread: number
    }
  | {
      /** Esta conversa ficou sem nao-lidas. Vai para todas as suas sessoes. */
      t: 'dm.read'
      user_id: UserId
    }
  | { t: 'dm.denied'; user_id: UserId }
  | { t: 'social.snapshot'; allow_member_dms: boolean; members: SocialMember[] }
  | { t: 'user.profile'; profile: Profile }
  | { t: 'user.online'; user: OnlineUser }
  | { t: 'user.offline'; user_id: UserId }
  | { t: 'call.incoming'; user_id: UserId; username: string }
  | { t: 'call.ringing'; user_id: UserId }
  | { t: 'call.accepted'; user_id: UserId; channel: string }
  | { t: 'call.ended'; user_id: UserId; reason: CallEndReason }
  | { t: 'voice.roster'; channel: string; peers: VoicePeer[] }
  | { t: 'voice.grant'; channel: string; url: string; token: string; expires_at: number }
  | { t: 'voice.denied'; channel: string; code: VoiceDeniedCode; message: string }
  | { t: 'voice.joined'; peer: VoicePeer }
  | { t: 'voice.left'; peer_id: PeerId }
  | {
      t: 'voice.state'
      peer_id: PeerId
      muted: boolean
      deafened: boolean
      camera_enabled: boolean
      screen_sharing: boolean
    }
  | { t: 'rtc.signal'; from: PeerId; payload: RtcPayload }
  | { t: 'error'; message: string }
