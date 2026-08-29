import type { Channel, Message, PeerId, ServerMsg, User, VoiceConfig, VoicePeer } from './protocol'

export interface StappState {
  selfId: PeerId | null
  serverName: string
  channels: Channel[]
  users: User[]
  voiceConfig: VoiceConfig | null
  /** Quem esta em call, em qualquer canal. Vem do servidor — vale para qualquer backend. */
  voicePeers: VoicePeer[]
  messages: Record<string, Message[]>
}

export const initialState: StappState = {
  selfId: null,
  serverName: 'Stapp',
  channels: [],
  users: [],
  voiceConfig: null,
  voicePeers: [],
  messages: {},
}

const byNick = (a: { nick: string }, b: { nick: string }) =>
  a.nick.localeCompare(b.nick, 'pt-BR', { sensitivity: 'base' })

export function reduce(state: StappState, msg: ServerMsg): StappState {
  switch (msg.t) {
    // Chega uma vez por conexao — inclusive depois de reconectar, quando serve
    // para jogar fora o estado velho.
    case 'welcome':
      return {
        ...initialState,
        selfId: msg.self_id,
        serverName: msg.server_name,
        channels: msg.channels,
        users: [...msg.users].sort(byNick),
        voiceConfig: msg.voice,
        voicePeers: msg.voice_peers,
      }

    case 'chat.history':
      return { ...state, messages: { ...state.messages, [msg.channel]: msg.msgs } }

    case 'chat.new': {
      const current = state.messages[msg.channel] ?? []
      if (current.some((m) => m.id === msg.msg.id)) return state
      return { ...state, messages: { ...state.messages, [msg.channel]: [...current, msg.msg] } }
    }

    case 'user.joined': {
      if (state.users.some((u) => u.id === msg.user.id)) return state
      return { ...state, users: [...state.users, msg.user].sort(byNick) }
    }

    case 'user.left':
      return {
        ...state,
        users: state.users.filter((u) => u.id !== msg.user_id),
        voicePeers: state.voicePeers.filter((p) => p.id !== msg.user_id),
      }

    // Verdade completa sobre este canal de voz, e chega so para quem acabou de
    // entrar. Como o servidor omite quem pediu (o transporte precisa assim),
    // nos mesmos nos acrescentamos aqui.
    case 'voice.roster': {
      const me = state.users.find((u) => u.id === state.selfId)
      const self: VoicePeer[] = me
        ? [{ id: me.id, nick: me.nick, channel: msg.channel, muted: false, deafened: false }]
        : []
      const others = state.voicePeers.filter(
        (p) => p.channel !== msg.channel && p.id !== state.selfId,
      )
      return { ...state, voicePeers: [...others, ...msg.peers, ...self] }
    }

    case 'voice.joined':
      return {
        ...state,
        voicePeers: [...state.voicePeers.filter((p) => p.id !== msg.peer.id), msg.peer],
      }

    case 'voice.left':
      return { ...state, voicePeers: state.voicePeers.filter((p) => p.id !== msg.peer_id) }

    case 'voice.state':
      return {
        ...state,
        voicePeers: state.voicePeers.map((p) =>
          p.id === msg.peer_id ? { ...p, muted: msg.muted, deafened: msg.deafened } : p,
        ),
      }

    // Sinalizacao e erro nao mexem no estado da tela.
    case 'rtc.signal':
    case 'error':
      return state
  }
}

/** Quem esta na call deste canal, em ordem alfabetica. */
export function peersInChannel(state: StappState, channelId: string): VoicePeer[] {
  return state.voicePeers.filter((p) => p.channel === channelId).sort(byNick)
}
