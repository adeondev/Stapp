import { describe, expect, it } from 'vitest'
import { initialState, reduce } from './store'

const welcome = {
  t: 'welcome' as const,
  self_peer_id: 'peer-1',
  self_user_id: 'user-1',
  server_name: 'Teste',
  channels: [],
  users: [{ user_id: 'user-1', username: 'Daniel' }],
  voice: { backend: 'mesh' as const, ice_servers: [], max_peers: 4 },
  voice_peers: [],
}

describe('store com identidade persistente', () => {
  it('agrega presenca pelo user_id', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, {
      t: 'user.online',
      user: { user_id: 'user-1', username: 'Daniel' },
    })
    expect(state.users).toHaveLength(1)
  })

  it('mantem user_id e peer_id distintos na voz', () => {
    let state = reduce(initialState, welcome)
    state = reduce(state, { t: 'voice.roster', channel: 'sala', peers: [] })
    expect(state.voicePeers[0]).toMatchObject({
      peer_id: 'peer-1',
      user_id: 'user-1',
      username: 'Daniel',
    })
  })
})
