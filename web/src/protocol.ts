// Espelho manual de `server/src/protocol.rs`. Mexeu la, mexe aqui — na mesma
// alteracao. Os campos sao snake_case porque vem direto do serde; e proposital.

export type PeerId = string
export type UserId = string
export type ChannelKind = 'text' | 'voice'

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

export type VoiceConfig =
  | { backend: 'mesh'; ice_servers: string[]; max_peers: number }
  // | { backend: 'livekit'; url: string; token: string }

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
  | { t: 'auth.login'; username: string; password: string }
  | { t: 'auth.register'; username: string; password: string }
  | { t: 'chat.send'; channel: string; text: string }
  | { t: 'voice.join'; channel: string }
  | { t: 'voice.leave' }
  | { t: 'voice.state'; muted: boolean; deafened: boolean }
  | { t: 'rtc.signal'; to: PeerId; payload: RtcPayload }

export type ServerMsg =
  | { t: 'auth.required'; server_name: string; registration_enabled: boolean }
  | { t: 'auth.error'; code: AuthErrorCode; message: string; retry_after_ms?: number }
  | {
      t: 'welcome'
      self_peer_id: PeerId
      self_user_id: UserId
      server_name: string
      channels: Channel[]
      users: OnlineUser[]
      voice: VoiceConfig
      voice_peers: VoicePeer[]
    }
  | { t: 'chat.history'; channel: string; msgs: Message[] }
  | { t: 'chat.new'; channel: string; msg: Message }
  | { t: 'user.online'; user: OnlineUser }
  | { t: 'user.offline'; user_id: UserId }
  | { t: 'voice.roster'; channel: string; peers: VoicePeer[] }
  | { t: 'voice.joined'; peer: VoicePeer }
  | { t: 'voice.left'; peer_id: PeerId }
  | { t: 'voice.state'; peer_id: PeerId; muted: boolean; deafened: boolean }
  | { t: 'rtc.signal'; from: PeerId; payload: RtcPayload }
  | { t: 'error'; message: string }
