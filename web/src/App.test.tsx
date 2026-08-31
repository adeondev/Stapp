// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from './protocol'
import App from './App'

const connectionMock = vi.hoisted(() => ({
  onMessage: null as ((message: ServerMsg) => void) | null,
}))

vi.mock('./net/connection', () => ({
  defaultServerUrl: () => 'ws://127.0.0.1:8787/ws',
  Connection: class {
    token: string | null = null

    constructor(_url: string, handlers: { onMessage(message: ServerMsg): void }) {
      connectionMock.onMessage = handlers.onMessage
    }

    authenticate(token: string) { this.token = token }
    clearAccess() { this.token = null }
    hasAccess() { return this.token !== null }
    send() {}
    close() {}
  },
}))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    connectionMock.onMessage = null
    const server = {
      url: 'ws://127.0.0.1:8787/ws',
      name: 'Stapp local',
      username: 'deon',
      lastUsed: 1,
    }
    localStorage.setItem('stapp.servers.v2', JSON.stringify([server]))
    localStorage.setItem('stapp.last-server.v2', server.url)
  })

  it('mantem a interface montada quando a sessao e restaurada', async () => {
    render(<App />)
    expect(connectionMock.onMessage).not.toBeNull()

    act(() => connectionMock.onMessage?.({
      t: 'welcome',
      self_peer_id: 'peer-deon',
      self_user_id: 'user-deon',
      server_name: 'Stapp local',
      channels: [],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon',
        username: 'deon',
        display_name: 'Deon',
        accent: 'blue',
        bio: '',
        has_avatar: false,
        updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 },
      voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    expect(await screen.findByText('Nada por aqui ainda.')).toBeTruthy()
  })
})
