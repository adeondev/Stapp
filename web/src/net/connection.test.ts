// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Connection, defaultServerUrl } from './connection'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  private listeners = new Map<string, Array<(event: { data?: string }) => void>>()

  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  send(value: string) { this.sent.push(value) }
  close() { this.emit('close') }
  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
}

describe('Connection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('envia somente o access token depois de auth.required', () => {
    const onMessage = vi.fn()
    const connection = new Connection('wss://stapp.example/ws', { onMessage, onStatus: vi.fn() })
    const socket = FakeWebSocket.instances[0]

    connection.authenticate('access-opaco')
    expect(socket.sent).toEqual([])
    socket.emit('message', JSON.stringify({
      t: 'auth.required', server_id: 'server-1', protocol_version: 2,
      server_name: 'Stapp', registration_enabled: true, plaintext_auth_allowed: true,
    }))

    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([{
      t: 'auth.access',
      access_token: 'access-opaco',
      client_version: '0.1.0',
    }])
    expect(socket.sent.join('')).not.toContain('password')
    expect(connection.hasAccess()).toBe(true)
    connection.close()
  })

  it('remove o access token da memória no encerramento explícito', () => {
    const connection = new Connection('wss://stapp.example/ws', { onMessage: vi.fn(), onStatus: vi.fn() })
    connection.authenticate('curto')
    connection.close()
    expect(connection.hasAccess()).toBe(false)
  })

  it('usa o servidor local como sugestao inicial no aplicativo Tauri', () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(defaultServerUrl()).toBe('ws://127.0.0.1:8787/ws')
  })
})
