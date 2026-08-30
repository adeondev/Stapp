import type {
  Channel,
  Message,
  OnlineUser,
  PeerId,
  ServerMsg,
  UserId,
  VoiceConfig,
  VoicePeer,
} from './protocol'

export interface StappState {
  selfPeerId: PeerId | null
  selfUserId: UserId | null
  serverName: string
  channels: Channel[]
  users: OnlineUser[]
  voiceConfig: VoiceConfig | null
  voicePeers: VoicePeer[]
  messages: Record<string, Message[]>
}

export const initialState: StappState = {
  selfPeerId: null,
  selfUserId: null,
  serverName: 'Stapp',
  channels: [],
  users: [],
  voiceConfig: null,
  voicePeers: [],
  messages: {},
}

const byUsername = (a: { username: string }, b: { username: string }) =>
  a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' })

export type StappAction = ServerMsg | { t: 'app.reset' }

export function reduce(state: StappState, msg: StappAction): StappState {
  switch (msg.t) {
    case 'app.reset':
      return initialState
    case 'welcome':
      return {
        ...initialState,
        selfPeerId: msg.self_peer_id,
        selfUserId: msg.self_user_id,
        serverName: msg.server_name,
        channels: msg.channels,
        users: [...msg.users].sort(byUsername),
        voiceConfig: msg.voice,
        voicePeers: msg.voice_peers,
      }

    case 'chat.history':
      return { ...state, messages: { ...state.messages, [msg.channel]: msg.msgs } }

    case 'chat.new': {
      const current = state.messages[msg.channel] ?? []
      if (current.some((message) => message.id === msg.msg.id)) return state
      return { ...state, messages: { ...state.messages, [msg.channel]: [...current, msg.msg] } }
    }

    case 'user.online': {
      if (state.users.some((user) => user.user_id === msg.user.user_id)) return state
      return { ...state, users: [...state.users, msg.user].sort(byUsername) }
    }

    case 'user.offline':
      return {
        ...state,
        users: state.users.filter((user) => user.user_id !== msg.user_id),
        voicePeers: state.voicePeers.filter((peer) => peer.user_id !== msg.user_id),
      }

    case 'voice.roster': {
      const me = state.users.find((user) => user.user_id === state.selfUserId)
      const self: VoicePeer[] =
        me && state.selfPeerId
          ? [
              {
                peer_id: state.selfPeerId,
                user_id: me.user_id,
                username: me.username,
                channel: msg.channel,
                muted: false,
                deafened: false,
              },
            ]
          : []
      const others = state.voicePeers.filter(
        (peer) => peer.channel !== msg.channel && peer.peer_id !== state.selfPeerId,
      )
      return { ...state, voicePeers: [...others, ...msg.peers, ...self] }
    }

    case 'voice.joined':
      return {
        ...state,
        voicePeers: [
          ...state.voicePeers.filter((peer) => peer.peer_id !== msg.peer.peer_id),
          msg.peer,
        ],
      }

    case 'voice.left':
      return {
        ...state,
        voicePeers: state.voicePeers.filter((peer) => peer.peer_id !== msg.peer_id),
      }

    case 'voice.state':
      return {
        ...state,
        voicePeers: state.voicePeers.map((peer) =>
          peer.peer_id === msg.peer_id
            ? { ...peer, muted: msg.muted, deafened: msg.deafened }
            : peer,
        ),
      }

    case 'auth.required':
    case 'auth.error':
    case 'rtc.signal':
    case 'error':
      return state
  }
}

export function peersInChannel(state: StappState, channelId: string): VoicePeer[] {
  return state.voicePeers.filter((peer) => peer.channel === channelId).sort(byUsername)
}
