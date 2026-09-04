import { create } from 'zustand'
import type {
  DirectMessage,
  DirectSummary,
  Message,
  ServerMsg,
  UserId,
} from '../protocol'
import { usePresenceStore } from './presenceStore'

export interface ChatState {
  messages: Record<string, Message[]>
  conversations: Record<UserId, DirectSummary>
  directMessages: Record<UserId, DirectMessage[]>
  sendResults: Record<string, { messageId?: string; error?: string }>
  typing: Record<string, { userId: UserId; username: string; expiresAt: number }[]>
  dmReadReceipts: Record<UserId, string | undefined>
  channelReads: Record<string, Record<string, UserId[]>>

  handleChatMessage: (msg: ServerMsg) => void
  patchMessage: (messageId: string, patch: Partial<Message> & Partial<DirectMessage>) => void
  resetChat: () => void
}

function trocarNaLista<T extends { id: string }>(lista: T[] | undefined, nova: T): T[] {
  const atual = lista ?? []
  return atual.map((item) => (item.id === nova.id ? nova : item))
}

function tirarDaLista<T extends { id: string }>(lista: T[] | undefined, id: string): T[] {
  return (lista ?? []).filter((item) => item.id !== id)
}

function mergeConversationMap(
  conversations: Record<UserId, DirectSummary>,
  userId: UserId,
  patch: Partial<DirectSummary>,
): Record<UserId, DirectSummary> {
  const existing = conversations[userId]
  const presence = usePresenceStore.getState()
  const username =
    existing?.username ??
    presence.directory.find((entry) => entry.user_id === userId)?.username ??
    presence.users.find((user) => user.user_id === userId)?.username ??
    userId

  return {
    ...conversations,
    [userId]: {
      user_id: userId,
      username,
      last: existing?.last ?? null,
      unread: existing?.unread ?? 0,
      ...patch,
    },
  }
}

function patchMessageStore(
  messages: Record<string, Message[]>,
  directMessages: Record<UserId, DirectMessage[]>,
  messageId: string,
  patch: Partial<Message> & Partial<DirectMessage>,
): { messages: Record<string, Message[]>; directMessages: Record<UserId, DirectMessage[]> } | null {
  for (const [channel, msgs] of Object.entries(messages)) {
    if (!msgs.some((m) => m.id === messageId)) continue
    return {
      messages: {
        ...messages,
        [channel]: msgs.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
      directMessages,
    }
  }

  for (const [userId, msgs] of Object.entries(directMessages)) {
    if (!msgs.some((m) => m.id === messageId)) continue
    return {
      messages,
      directMessages: {
        ...directMessages,
        [userId]: msgs.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      },
    }
  }

  return null
}

const initialChatState = {
  messages: {},
  conversations: {},
  directMessages: {},
  sendResults: {},
  typing: {},
  dmReadReceipts: {},
  channelReads: {},
}

export const useChatStore = create<ChatState>((set) => ({
  ...initialChatState,

  handleChatMessage: (msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        set(initialChatState)
        break

      case 'chat.history':
        set((state) => ({ messages: { ...state.messages, [msg.channel]: msg.msgs } }))
        break

      case 'chat.new':
        set((state) => {
          const current = state.messages[msg.channel] ?? []
          if (current.some((m) => m.id === msg.msg.id)) return state
          return { messages: { ...state.messages, [msg.channel]: [...current, msg.msg] } }
        })
        break

      case 'message.accepted':
        set((state) => ({
          sendResults: {
            ...state.sendResults,
            [msg.client_nonce]: { messageId: msg.message_id },
          },
        }))
        break

      case 'message.failed':
        set((state) => ({
          sendResults: {
            ...state.sendResults,
            [msg.client_nonce]: { error: msg.message },
          },
        }))
        break

      case 'typing': {
        const presence = usePresenceStore.getState()
        if (msg.user_id === presence.selfUserId) return
        const key = `${msg.scope_kind}:${msg.scope_id}`
        set((state) => {
          const current = (state.typing[key] ?? []).filter(
            (entry) => entry.userId !== msg.user_id && entry.expiresAt > Date.now(),
          )
          return {
            typing: {
              ...state.typing,
              [key]: msg.active
                ? [...current, { userId: msg.user_id, username: msg.username, expiresAt: msg.expires_at }]
                : current,
            },
          }
        })
        break
      }

      case 'chat.reads':
        set((state) => ({
          channelReads: {
            ...state.channelReads,
            [msg.channel]: {
              ...(state.channelReads[msg.channel] ?? {}),
              [msg.message_id]: msg.readers,
            },
          },
        }))
        break

      case 'chat.preview':
        set((state) => {
          const patched = patchMessageStore(state.messages, state.directMessages, msg.message_id, {
            preview: msg.preview,
          })
          return patched ?? state
        })
        break

      case 'chat.poll_update':
        set((state) => {
          const channelMsgs = state.messages[msg.channel]
          if (!channelMsgs) return state
          const newChannelMsgs = channelMsgs.map((m) =>
            m.id === msg.poll.message_id ? { ...m, poll: msg.poll } : m,
          )
          return { messages: { ...state.messages, [msg.channel]: newChannelMsgs } }
        })
        break

      case 'dm.list':
        set({
          conversations: Object.fromEntries(
            msg.conversations.map((conversation) => [conversation.user_id, conversation]),
          ),
        })
        break

      case 'dm.read':
        set((state) => ({
          conversations: state.conversations[msg.user_id]
            ? mergeConversationMap(state.conversations, msg.user_id, { unread: 0 })
            : state.conversations,
          dmReadReceipts: msg.message_id
            ? { ...state.dmReadReceipts, [msg.user_id]: msg.message_id }
            : state.dmReadReceipts,
        }))
        break

      case 'dm.history':
        set((state) => ({
          directMessages: { ...state.directMessages, [msg.user_id]: msg.msgs },
          conversations: mergeConversationMap(state.conversations, msg.user_id, { unread: 0 }),
        }))
        break

      case 'dm.new':
        set((state) => {
          const current = state.directMessages[msg.user_id]
          const directMessages =
            current === undefined || current.some((entry) => entry.id === msg.msg.id)
              ? state.directMessages
              : { ...state.directMessages, [msg.user_id]: [...current, msg.msg] }

          return {
            directMessages,
            conversations: mergeConversationMap(state.conversations, msg.user_id, {
              last: msg.msg,
              unread: msg.unread,
            }),
          }
        })
        break

      case 'chat.updated':
        set((state) => ({
          messages: {
            ...state.messages,
            [msg.channel]: trocarNaLista(state.messages[msg.channel], msg.msg),
          },
        }))
        break

      case 'chat.deleted':
        set((state) => ({
          messages: {
            ...state.messages,
            [msg.channel]: tirarDaLista(state.messages[msg.channel], msg.message_id),
          },
        }))
        break

      case 'dm.updated':
        set((state) => ({
          directMessages: {
            ...state.directMessages,
            [msg.user_id]: trocarNaLista(state.directMessages[msg.user_id], msg.msg),
          },
        }))
        break

      case 'dm.deleted':
        set((state) => {
          const directMessages = {
            ...state.directMessages,
            [msg.user_id]: tirarDaLista(state.directMessages[msg.user_id], msg.message_id),
          }
          return {
            directMessages,
            conversations: mergeConversationMap(state.conversations, msg.user_id, {
              unread: msg.unread,
            }),
          }
        })
        break

      default:
        break
    }
  },

  patchMessage: (messageId, patch) => {
    set((state) => {
      const patched = patchMessageStore(state.messages, state.directMessages, messageId, patch)
      return patched ?? state
    })
  },

  resetChat: () => set(initialChatState),
}))
