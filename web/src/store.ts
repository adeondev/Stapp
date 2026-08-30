import type {
  Channel,
  DirectMessage,
  DirectSummary,
  DirectoryEntry,
  Message,
  OnlineUser,
  PeerId,
  ServerMsg,
  SocialMember,
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
  /** Todo mundo com conta, online ou nao. Com quem da para abrir conversa. */
  directory: DirectoryEntry[]
  /** A lista lateral de conversas, com nao-lidas. Chave: o outro user_id. */
  conversations: Record<UserId, DirectSummary>
  /** Historico ja carregado de cada conversa. Chave: o outro user_id. */
  directMessages: Record<UserId, DirectMessage[]>
  allowMemberDms: boolean
  socialMembers: SocialMember[]
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
  directory: [],
  conversations: {},
  directMessages: {},
  allowMemberDms: true,
  socialMembers: [],
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
        directory: [...msg.directory].sort(byUsername),
      }

    case 'chat.history':
      return { ...state, messages: { ...state.messages, [msg.channel]: msg.msgs } }

    case 'chat.new': {
      const current = state.messages[msg.channel] ?? []
      if (current.some((message) => message.id === msg.msg.id)) return state
      return { ...state, messages: { ...state.messages, [msg.channel]: [...current, msg.msg] } }
    }

    case 'user.online': {
      // Quem criou a conta depois do nosso welcome nao esta no diretorio.
      // Este evento e a prova de que existe, entao aproveitamos para incluir.
      const directory = state.directory.some((entry) => entry.user_id === msg.user.user_id)
        ? state.directory
        : [...state.directory, msg.user].sort(byUsername)

      if (state.users.some((user) => user.user_id === msg.user.user_id)) {
        return { ...state, directory }
      }
      return { ...state, users: [...state.users, msg.user].sort(byUsername), directory }
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

    case 'dm.list':
      return {
        ...state,
        conversations: Object.fromEntries(
          msg.conversations.map((conversation) => [conversation.user_id, conversation]),
        ),
      }

    case 'dm.read':
      // Chega tambem quando outra aba sua leu a conversa.
      return state.conversations[msg.user_id]
        ? { ...state, conversations: mergeConversation(state, msg.user_id, { unread: 0 }) }
        : state

    case 'social.snapshot':
      return {
        ...state,
        allowMemberDms: msg.allow_member_dms,
        socialMembers: [...msg.members].sort(byUsername),
      }

    case 'dm.history':
      return {
        ...state,
        directMessages: { ...state.directMessages, [msg.user_id]: msg.msgs },
        conversations: mergeConversation(state, msg.user_id, { unread: 0 }),
      }

    case 'dm.new': {
      const current = state.directMessages[msg.user_id]
      // So acrescenta no historico ja carregado; conversa nunca aberta continua
      // sem lista, e o dm.open busca tudo de uma vez quando ela abrir.
      const directMessages =
        current === undefined || current.some((entry) => entry.id === msg.msg.id)
          ? state.directMessages
          : { ...state.directMessages, [msg.user_id]: [...current, msg.msg] }

      return {
        ...state,
        directMessages,
        conversations: mergeConversation(state, msg.user_id, {
          last: msg.msg,
          unread: msg.unread,
        }),
      }
    }

    // Sinalizacao, autenticacao e o telefone tocando nao mexem no estado da
    // sala — o toque e efemero e vive no App.
    case 'auth.required':
    case 'auth.error':
    case 'call.incoming':
    case 'call.ringing':
    case 'call.accepted':
    case 'call.ended':
    case 'rtc.signal':
    case 'error':
    case 'dm.denied':
      return state
  }
}

/**
 * Atualiza uma conversa da lista, criando a entrada se for a primeira mensagem.
 * O nome sai do diretorio, ja que `dm.new` nao repete o username do outro.
 */
function mergeConversation(
  state: StappState,
  userId: UserId,
  patch: Partial<DirectSummary>,
): Record<UserId, DirectSummary> {
  const existing = state.conversations[userId]
  const username =
    existing?.username ??
    state.directory.find((entry) => entry.user_id === userId)?.username ??
    state.users.find((user) => user.user_id === userId)?.username ??
    userId

  return {
    ...state.conversations,
    [userId]: {
      user_id: userId,
      username,
      last: existing?.last ?? null,
      unread: existing?.unread ?? 0,
      ...patch,
    },
  }
}

/** Conversas com mensagem, mais recente primeiro. */
export function conversationList(state: StappState): DirectSummary[] {
  return Object.values(state.conversations).sort(
    (a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0),
  )
}

/**
 * A lista de diretas contem somente conversas que realmente existem. Pessoas
 * do servidor ficam na home de amigos e no painel de membros.
 */
export function directList(state: StappState): DirectSummary[] {
  return conversationList(state)
}

export function totalUnread(state: StappState): number {
  return Object.values(state.conversations).reduce((sum, item) => sum + item.unread, 0)
}

/**
 * O nome de quem esta do outro lado de uma call de conversa (`dm:<a>:<b>`).
 * Sai do canal, nao da tela aberta — quem atendeu uma chamada pode nem ter a
 * conversa aberta.
 */
export function directChannelPartner(state: StappState, channel: string): string | null {
  const resto = channel.startsWith('dm:') ? channel.slice(3) : null
  if (!resto) return null

  const partes = resto.split(':')
  if (partes.length !== 2) return null

  const outro = partes.find((id) => id !== state.selfUserId)
  if (!outro) return null

  return (
    state.conversations[outro]?.username ??
    state.socialMembers.find((entry) => entry.user_id === outro)?.username ??
    state.directory.find((entry) => entry.user_id === outro)?.username ??
    state.users.find((user) => user.user_id === outro)?.username ??
    null
  )
}

export function peersInChannel(state: StappState, channelId: string): VoicePeer[] {
  return state.voicePeers.filter((peer) => peer.channel === channelId).sort(byUsername)
}
