// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from '../platform/updater'
import { Connection, defaultServerUrl } from './connection'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  bufferedAmount = 0
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
      client_version: APP_VERSION,
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

  it('mede RTT de alta precisao e calcula deltas temporais', () => {
    const onMessage = vi.fn()
    const connection = new Connection('wss://stapp.example/ws', { onMessage, onStatus: vi.fn() })
    const socket = FakeWebSocket.instances[0]
    const onTelemetry = vi.fn()

    const nonce = connection.measureRtt(onTelemetry)
    expect(socket.sent.length).toBe(1)
    const sentMsg = JSON.parse(socket.sent[0])
    expect(sentMsg).toMatchObject({
      t: 'telemetry.ping',
      nonce,
    })
    expect(typeof sentMsg.t0).toBe('number')

    const t0 = sentMsg.t0 - 30_000 // simulado como emitido 30ms atras
    const t1 = t0 + 15_000 // 15ms subida
    const t2 = t1 + 2_000 // 2ms processamento servidor

    socket.emit('message', JSON.stringify({
      t: 'telemetry.pong',
      nonce,
      t0,
      t1,
      t2,
    }))

    expect(onTelemetry).toHaveBeenCalledTimes(1)
    const metrics = onTelemetry.mock.calls[0][0]
    expect(metrics.nonce).toBe(nonce)
    expect(metrics.uplinkUs).toBe(15_000)
    expect(metrics.serverUs).toBe(2_000)
    expect(metrics.totalRttUs).toBe(metrics.t3 - t0)
    expect(metrics.downlinkUs).toBe(metrics.t3 - t2)
    expect(metrics.netRttUs).toBe(metrics.totalRttUs - metrics.serverUs)
    connection.close()
  })

  it('emite alerta de backpressure quando bufferedAmount excede limite', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const connection = new Connection('wss://stapp.example/ws', { onMessage: vi.fn(), onStatus: vi.fn() })
    const socket = FakeWebSocket.instances[0]

    socket.bufferedAmount = 70_000
    connection.send({ t: 'typing.set', scope_kind: 'channel', scope_id: 'geral', active: true })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Backpressure Alert]'))
    warnSpy.mockRestore()
    connection.close()
  })
})
