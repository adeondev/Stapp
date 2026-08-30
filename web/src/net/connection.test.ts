import { describe, expect, it } from 'vitest'
import { isSecureAuthUrl } from './connection'

describe('isSecureAuthUrl', () => {
  it('permite WSS e WebSocket local', () => {
    expect(isSecureAuthUrl('wss://stapp.exemplo.com/ws')).toBe(true)
    expect(isSecureAuthUrl('ws://localhost:8787/ws')).toBe(true)
    expect(isSecureAuthUrl('ws://127.0.0.1:8787/ws')).toBe(true)
  })

  it('recusa credenciais por WebSocket remoto sem TLS', () => {
    expect(isSecureAuthUrl('ws://192.168.0.10:8787/ws')).toBe(false)
    expect(isSecureAuthUrl('http://stapp.exemplo.com/ws')).toBe(false)
    expect(isSecureAuthUrl('nao e uma url')).toBe(false)
  })
})
