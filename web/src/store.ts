import type {
  Channel,
  DirectMessage,
  DirectSummary,
  DirectoryEntry,
  Limits,
  Message,
  OnlineUser,
  PeerId,
  Profile,
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
  /**
   * Perfis por user_id. **Toda a UI resolve nome, cor e avatar por aqui** —
   * nenhum payload carrega isso junto, senao trocar de avatar deixaria o que ja
   * chegou com a foto velha.
   */
  profiles: Record<UserId, Profile>
  /**
   * Tetos que o servidor declarou no `welcome`. Antes deles chegarem, o
   * cliente usa o fallback abaixo — que so vale ate o primeiro `welcome`,
   * porque quem manda e o servidor.
   */
  limits: Limits
}

/** Os mesmos defaults do `stapp.toml`, para a tela ter numero antes de conectar. */
export const LIMITES_PADRAO: Limits = {
  max_upload_bytes: 15 * 1024 * 1024,
  max_text_chars: 4000,
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
  profiles: {},
  limits: LIMITES_PADRAO,
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
        profiles: Object.fromEntries(msg.profiles.map((profile) => [profile.user_id, profile])),
        limits: msg.limits,
      }

    case 'user.profile':
      return {
        ...state,
        profiles: { ...state.profiles, [msg.profile.user_id]: msg.profile },
      }

    case 'chat.history':
      return { ...state, messages: { ...state.messages, [msg.channel]: msg.msgs } }

    case 'chat.new': {
      const current = state.messages[msg.channel] ?? []
      if (current.some((message) => message.id === msg.msg.id)) return state
      return { ...state, messages: { ...state.messages, [msg.channel]: [...current, msg.msg] } }
    }

    case 'chat.preview':
      return patchMessage(state, msg.message_id, { preview: msg.preview })

    case 'chat.poll_update': {
      const channelMsgs = state.messages[msg.channel]
      if (!channelMsgs) return state

      const newChannelMsgs = channelMsgs.map((m) =>
        m.id === msg.poll.message_id ? { ...m, poll: msg.poll } : m
      )

      return {
        ...state,
        messages: { ...state.messages, [msg.channel]: newChannelMsgs },
      }
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
                camera_enabled: false,
                screen_sharing: false,
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

    // A mensagem vem inteira e o evento ja diz o escopo — nao ha delta para
    // aplicar errado, e um campo novo no servidor nao pede caso novo aqui.
    case 'chat.updated':
      return {
        ...state,
        messages: {
          ...state.messages,
          [msg.channel]: trocarNaLista(state.messages[msg.channel], msg.msg),
        },
      }

    case 'chat.deleted':
      return {
        ...state,
        messages: {
          ...state.messages,
          [msg.channel]: tirarDaLista(state.messages[msg.channel], msg.message_id),
        },
      }

    case 'dm.updated':
      return {
        ...state,
        directMessages: {
          ...state.directMessages,
          [msg.user_id]: trocarNaLista(state.directMessages[msg.user_id], msg.msg),
        },
      }

    case 'dm.deleted': {
      const semMensagem: StappState = {
        ...state,
        directMessages: {
          ...state.directMessages,
          [msg.user_id]: tirarDaLista(state.directMessages[msg.user_id], msg.message_id),
        },
      }
      // Apagar uma nao lida derruba a contagem; o servidor ja mandou o numero
      // certo para este lado, entao nao ha o que recalcular aqui.
      return {
        ...semMensagem,
        conversations: mergeConversation(semMensagem, msg.user_id, { unread: msg.unread }),
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
    case 'voice.grant':
    case 'voice.denied':
    case 'rtc.signal':
    case 'error':
    case 'dm.denied':
      return state
  }
}

/** Troca a mensagem de mesmo id, mantendo a ordem. Id ausente = lista intocada. */
function trocarNaLista<T extends { id: string }>(lista: T[] | undefined, nova: T): T[] {
  const atual = lista ?? []
  return atual.map((item) => (item.id === nova.id ? nova : item))
}

function tirarDaLista<T extends { id: string }>(lista: T[] | undefined, id: string): T[] {
  return (lista ?? []).filter((item) => item.id !== id)
}

/**
 * Aplica um retoque numa mensagem sem saber onde ela esta.
 *
 * So o preview de link precisa disto: ele chega depois, por scraping, e o
 * evento nao diz o escopo. Editar, apagar e reagir sabem o canal ou a conversa
 * pelo proprio evento, e por isso nao varrem nada. A varredura estava copiada
 * duas vezes dentro do proprio `chat.preview`; o custo e o mesmo de antes, o
 * que muda e ter um lugar so.
 *
 * Estado intocado quando o id nao aparece — assim o React nao re-renderiza por
 * uma mensagem que este cliente nem carregou.
 */
export function patchMessage(
  state: StappState,
  messageId: string,
  patch: Partial<Message> & Partial<DirectMessage>,
): StappState {
  for (const [channel, msgs] of Object.entries(state.messages)) {
    if (!msgs.some((m) => m.id === messageId)) continue
    return {
      ...state,
      messages: {
        ...state.messages,
        [channel]: msgs.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
    }
  }

  for (const [userId, msgs] of Object.entries(state.directMessages)) {
    if (!msgs.some((m) => m.id === messageId)) continue
    return {
      ...state,
      directMessages: {
        ...state.directMessages,
        [userId]: msgs.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
    }
  }

  return state
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

export function directChannelPartnerId(state: StappState, channel: string): UserId | null {
  const resto = channel.startsWith('dm:') ? channel.slice(3) : null
  if (!resto) return null

  const partes = resto.split(':')
  if (partes.length !== 2) return null

  return partes.find((id) => id !== state.selfUserId) ?? null
}

/**
 * O nome de quem esta do outro lado de uma call de conversa (`dm:<a>:<b>`).
 * Sai do canal, nao da tela aberta — quem atendeu uma chamada pode nem ter a
 * conversa aberta.
 */
export function directChannelPartner(state: StappState, channel: string): string | null {
  const outro = directChannelPartnerId(state, channel)
  if (!outro) return null

  return (
    state.conversations[outro]?.username ??
    state.socialMembers.find((entry) => entry.user_id === outro)?.username ??
    state.directory.find((entry) => entry.user_id === outro)?.username ??
    state.users.find((user) => user.user_id === outro)?.username ??
    null
  )
}

/**
 * O perfil de alguem. Devolve um provisorio quando ainda nao chegou — assim
 * nenhum componente precisa saber lidar com a ausencia, e a tela nunca fica
 * com um buraco esperando o servidor.
 */
export function resolveProfile(
  profiles: Record<UserId, Profile>,
  userId: UserId,
  fallbackName = '',
): Profile {
  const encontrado = profiles[userId]
  if (encontrado) return encontrado

  const nome = fallbackName || 'alguem'
  return {
    user_id: userId,
    username: nome,
    display_name: nome,
    accent: 'blue',
    bio: '',
    has_avatar: false,
    updated_at: 0,
  }
}

/** Versao para quem ja tem o estado inteiro: sabe procurar o nome no diretorio. */
export function profileOf(state: StappState, userId: UserId, fallbackName = ''): Profile {
  return resolveProfile(
    state.profiles,
    userId,
    fallbackName ||
      state.directory.find((entry) => entry.user_id === userId)?.username ||
      state.users.find((user) => user.user_id === userId)?.username ||
      '',
  )
}

/** O nome que deve aparecer na tela para esta conta. */
export function displayNameOf(state: StappState, userId: UserId, fallbackName = ''): string {
  return profileOf(state, userId, fallbackName).display_name
}

export function peersInChannel(state: StappState, channelId: string): VoicePeer[] {
  return state.voicePeers.filter((peer) => peer.channel === channelId).sort(byUsername)
}
