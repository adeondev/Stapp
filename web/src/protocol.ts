// Espelho manual de `server/src/protocol.rs`. Mexeu la, mexe aqui — na mesma
// alteracao. Os campos sao snake_case porque vem direto do serde; e proposital.

export type PeerId = string

export type ChannelKind = 'text' | 'voice'

export interface Channel {
  id: string
  name: string
  kind: ChannelKind
}

export interface User {
  id: PeerId
  nick: string
}

export interface VoicePeer {
  id: PeerId
  nick: string
  channel: string
  muted: boolean
  deafened: boolean
}

export interface Message {
  id: string
  channel: string
  nick: string
  text: string
  /** Milissegundos desde o epoch. */
  ts: number
}

/**
 * Como o audio funciona neste servidor. O `backend` e lido em runtime para
 * escolher o transporte — e o que permite migrar para SFU sem tocar na UI.
 */
export type VoiceConfig =
  | { backend: 'mesh'; ice_servers: string[]; max_peers: number }
  // | { backend: 'livekit'; url: string; token: string }   <- proximo passo

/** Conteudo do rtc.signal. O servidor nao le isto, so entrega. */
export type RtcPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export type ClientMsg =
  | { t: 'hello'; nick: string }
  | { t: 'chat.send'; channel: string; text: string }
  | { t: 'voice.join'; channel: string }
  | { t: 'voice.leave' }
  | { t: 'voice.state'; muted: boolean; deafened: boolean }
  | { t: 'rtc.signal'; to: PeerId; payload: RtcPayload }

export type ServerMsg =
  | {
      t: 'welcome'
      self_id: PeerId
      server_name: string
      channels: Channel[]
      users: User[]
      voice: VoiceConfig
      voice_peers: VoicePeer[]
    }
  | { t: 'chat.history'; channel: string; msgs: Message[] }
  | { t: 'chat.new'; channel: string; msg: Message }
  | { t: 'user.joined'; user: User }
  | { t: 'user.left'; user_id: PeerId }
  | { t: 'voice.roster'; channel: string; peers: VoicePeer[] }
  | { t: 'voice.joined'; peer: VoicePeer }
  | { t: 'voice.left'; peer_id: PeerId }
  | { t: 'voice.state'; peer_id: PeerId; muted: boolean; deafened: boolean }
  | { t: 'rtc.signal'; from: PeerId; payload: RtcPayload }
  | { t: 'error'; message: string }
