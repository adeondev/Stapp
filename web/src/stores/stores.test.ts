import { beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchServerMessage,
  resetAllStores,
  useChatStore,
  usePresenceStore,
  useVoiceStore,
} from './index'

describe('Zustand Atomic Stores', () => {
  beforeEach(() => {
    resetAllStores()
  })

  it('gerencia estado de presenca de forma atomica', () => {
    dispatchServerMessage({
      t: 'welcome',
      self_peer_id: 'peer-1',
      self_user_id: 'user-1',
      server_name: 'Stapp Teste',
      channels: [{ id: 'c1', name: 'geral', kind: 'text' }],
      users: [{ user_id: 'user-1', username: 'Daniel' }],
      directory: [{ user_id: 'user-2', username: 'Alice' }],
      profiles: [],
      voice: { backend: 'livekit', max_peers: 10, camera: true, screen_share: true, screen_audio: true },
      voice_peers: [],
      limits: { max_upload_bytes: 1000, max_text_chars: 500 },
    })

    const presence = usePresenceStore.getState()
    expect(presence.selfPeerId).toBe('peer-1')
    expect(presence.selfUserId).toBe('user-1')
    expect(presence.serverName).toBe('Stapp Teste')
    expect(presence.channels).toHaveLength(1)
    expect(presence.users).toHaveLength(1)
    expect(presence.directory).toHaveLength(1)

    dispatchServerMessage({
      t: 'user.online',
      user: { user_id: 'user-3', username: 'Bob' },
    })

    expect(usePresenceStore.getState().users).toHaveLength(2)
    expect(usePresenceStore.getState().directory).toHaveLength(2)
  })

  it('gerencia voz e isola speakingPeers para evitar re-renders na arvore', () => {
    const voiceStore = useVoiceStore.getState()
    expect(voiceStore.speakingPeers.size).toBe(0)

    voiceStore.setSpeaking('peer-1', true)
    expect(useVoiceStore.getState().speakingPeers.has('peer-1')).toBe(true)

    voiceStore.setSpeaking('peer-2', true)
    expect(useVoiceStore.getState().speakingPeers.size).toBe(2)

    voiceStore.setSpeaking('peer-1', false)
    expect(useVoiceStore.getState().speakingPeers.has('peer-1')).toBe(false)
    expect(useVoiceStore.getState().speakingPeers.has('peer-2')).toBe(true)

    // Modificar speakingPeers nao altera presenca nem chat
    expect(usePresenceStore.getState().serverName).toBe('Stapp')
    expect(Object.keys(useChatStore.getState().messages)).toHaveLength(0)
  })

  it('gerencia chat e mensagens diretas no chatStore', () => {
    dispatchServerMessage({
      t: 'chat.history',
      channel: 'geral',
      msgs: [{ id: 'm1', channel: 'geral', author_id: 'u1', author_username: 'Daniel', text: 'ola', ts: 100 }],
    })

    expect(useChatStore.getState().messages['geral']).toHaveLength(1)

    dispatchServerMessage({
      t: 'chat.new',
      channel: 'geral',
      msg: { id: 'm2', channel: 'geral', author_id: 'u2', author_username: 'Alice', text: 'tudo bem?', ts: 101 },
    })

    expect(useChatStore.getState().messages['geral']).toHaveLength(2)

    dispatchServerMessage({
      t: 'chat.updated',
      channel: 'geral',
      msg: { id: 'm2', channel: 'geral', author_id: 'u2', author_username: 'Alice', text: 'tudo bem! (editado)', ts: 101 },
    })

    expect(useChatStore.getState().messages['geral'][1].text).toBe('tudo bem! (editado)')

    dispatchServerMessage({
      t: 'chat.deleted',
      channel: 'geral',
      message_id: 'm1',
    })

    expect(useChatStore.getState().messages['geral']).toHaveLength(1)
    expect(useChatStore.getState().messages['geral'][0].id).toBe('m2')
  })
})
