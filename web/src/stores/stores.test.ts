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

  it('centraliza mudo e ensurdecer garantindo que ensurdecer forca mutar e preserva preferencias', () => {
    const store = useVoiceStore.getState()
    expect(store.muted).toBe(false)
    expect(store.deafened).toBe(false)

    // Alternar mudo
    store.toggleMute()
    expect(useVoiceStore.getState().muted).toBe(true)
    expect(useVoiceStore.getState().deafened).toBe(false)

    store.toggleMute()
    expect(useVoiceStore.getState().muted).toBe(false)
    expect(useVoiceStore.getState().deafened).toBe(false)

    // Ensurdecer forca mudo
    store.toggleDeafen()
    expect(useVoiceStore.getState().deafened).toBe(true)
    expect(useVoiceStore.getState().muted).toBe(true)

    // Desmutar desfaz o ensurdecimento
    store.toggleMute()
    expect(useVoiceStore.getState().muted).toBe(false)
    expect(useVoiceStore.getState().deafened).toBe(false)

    // Sincroniza com chamada ativa quando existente
    useVoiceStore.getState().setCall({ channel: 'c-voz', muted: false, deafened: false })
    expect(useVoiceStore.getState().call?.muted).toBe(false)

    useVoiceStore.getState().toggleMute()
    expect(useVoiceStore.getState().muted).toBe(true)
    expect(useVoiceStore.getState().call?.muted).toBe(true)

    // resetVoice limpa dados da chamada mas mantem preferencias de mudo
    useVoiceStore.getState().resetVoice()
    expect(useVoiceStore.getState().call).toBeNull()
    expect(useVoiceStore.getState().muted).toBe(true)
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

  it('reconcilia participantes unicamente por user_id eliminando sessoes zumbi', () => {
    // 1. Welcome inicial com Daniel e Alice
    dispatchServerMessage({
      t: 'welcome',
      self_peer_id: 'peer-daniel-1',
      self_user_id: 'user-daniel',
      server_name: 'Stapp Teste',
      channels: [{ id: 'voz-1', name: 'Voz 1', kind: 'voice' }, { id: 'voz-2', name: 'Voz 2', kind: 'voice' }],
      users: [
        { user_id: 'user-daniel', username: 'Daniel' },
        { user_id: 'user-alice', username: 'Alice' },
      ],
      directory: [],
      profiles: [],
      voice: { backend: 'livekit', max_peers: 10, camera: true, screen_share: true, screen_audio: true },
      voice_peers: [
        {
          peer_id: 'peer-alice-old',
          user_id: 'user-alice',
          username: 'Alice',
          channel: 'voz-1',
          muted: false,
          deafened: false,
          camera_enabled: false,
          screen_sharing: false,
        },
      ],
      limits: { max_upload_bytes: 1000, max_text_chars: 500 },
    })

    expect(useVoiceStore.getState().voicePeers).toHaveLength(1)
    expect(useVoiceStore.getState().voicePeers[0].peer_id).toBe('peer-alice-old')

    // 2. Alice reconecta com novo peer_id e entra no mesmo ou em outro canal (voice.joined)
    dispatchServerMessage({
      t: 'voice.joined',
      peer: {
        peer_id: 'peer-alice-new',
        user_id: 'user-alice',
        username: 'Alice',
        channel: 'voz-2',
        muted: true,
        deafened: false,
        camera_enabled: false,
        screen_sharing: false,
      },
    })

    // Deve ter substituído a sessão antiga pelo user_id
    const peersAfterJoined = useVoiceStore.getState().voicePeers
    expect(peersAfterJoined).toHaveLength(1)
    expect(peersAfterJoined[0].peer_id).toBe('peer-alice-new')
    expect(peersAfterJoined[0].channel).toBe('voz-2')

    // 3. Roster autoritativo chega para voz-1 contendo apenas Daniel
    dispatchServerMessage({
      t: 'voice.roster',
      channel: 'voz-1',
      peers: [
        {
          peer_id: 'peer-daniel-1',
          user_id: 'user-daniel',
          username: 'Daniel',
          channel: 'voz-1',
          muted: false,
          deafened: false,
          camera_enabled: false,
          screen_sharing: false,
        },
      ],
    })

    const peersAfterRoster = useVoiceStore.getState().voicePeers
    expect(peersAfterRoster).toHaveLength(2)
    const userIds = peersAfterRoster.map((p) => p.user_id).sort()
    expect(userIds).toEqual(['user-alice', 'user-daniel'])
    // Alice continua em voz-2 com peer-alice-new
    expect(peersAfterRoster.find((p) => p.user_id === 'user-alice')?.peer_id).toBe('peer-alice-new')

    // 4. Se o roster de voz-1 incluir Alice (mudou para voz-1), remove Alice de voz-2 e não duplica
    dispatchServerMessage({
      t: 'voice.roster',
      channel: 'voz-1',
      peers: [
        {
          peer_id: 'peer-daniel-1',
          user_id: 'user-daniel',
          username: 'Daniel',
          channel: 'voz-1',
          muted: false,
          deafened: false,
          camera_enabled: false,
          screen_sharing: false,
        },
        {
          peer_id: 'peer-alice-v1',
          user_id: 'user-alice',
          username: 'Alice',
          channel: 'voz-1',
          muted: false,
          deafened: false,
          camera_enabled: false,
          screen_sharing: false,
        },
      ],
    })

    const peersFinal = useVoiceStore.getState().voicePeers
    expect(peersFinal).toHaveLength(2)
    expect(peersFinal.filter((p) => p.user_id === 'user-alice')).toHaveLength(1)
    expect(peersFinal.find((p) => p.user_id === 'user-alice')?.channel).toBe('voz-1')
  })

  it('unifica maquina de estados do VoIP com transicoes atomicas (idle -> ringing/incoming -> connecting -> connected -> ended)', () => {
    // 1. Inicial: idle
    expect(useVoiceStore.getState().voip).toBeNull()

    // 2. Transicao para incoming via call.incoming
    dispatchServerMessage({
      t: 'call.incoming',
      user_id: 'user-bob',
      username: 'Bob',
    })
    expect(useVoiceStore.getState().voip).toEqual({
      status: 'incoming',
      userId: 'user-bob',
      username: 'Bob',
      direction: 'incoming',
    })

    // 3. Transicao para connecting via call.accepted
    dispatchServerMessage({
      t: 'call.accepted',
      user_id: 'user-bob',
      channel: 'dm:user-alice:user-bob',
    })
    expect(useVoiceStore.getState().voip).toEqual({
      status: 'connecting',
      userId: 'user-bob',
      username: 'Bob',
      direction: 'incoming',
      channel: 'dm:user-alice:user-bob',
    })

    // 4. Transicao para connected
    useVoiceStore.getState().setVoip((prev) => (prev ? { ...prev, status: 'connected' } : null))
    expect(useVoiceStore.getState().voip?.status).toBe('connected')

    // 5. Transicao para ended (retorna a null/idle) via call.ended
    dispatchServerMessage({
      t: 'call.ended',
      user_id: 'user-bob',
      reason: 'declined',
    })
    expect(useVoiceStore.getState().voip).toBeNull()

    // 6. Chamada sainte: transicao para ringing via call.ringing
    useVoiceStore.getState().setVoip({
      status: 'ringing',
      userId: 'user-bob',
      username: 'Bob',
      direction: 'outgoing',
      channel: 'dm:user-alice:user-bob',
    })
    expect(useVoiceStore.getState().voip?.status).toBe('ringing')

    dispatchServerMessage({
      t: 'call.ringing',
      user_id: 'user-bob',
    })
    expect(useVoiceStore.getState().voip?.status).toBe('ringing')

    // 7. Convite de voz simultaneo via voice.invite
    useVoiceStore.getState().setVoip(null)
    dispatchServerMessage({
      t: 'voice.invite',
      from_user_id: 'user-charlie',
      channel_id: 'dm:user-alice:user-charlie',
    })
    expect(useVoiceStore.getState().voip).toEqual({
      status: 'incoming',
      userId: 'user-charlie',
      username: 'user-charlie',
      direction: 'incoming',
      channel: 'dm:user-alice:user-charlie',
    })
  })
})
