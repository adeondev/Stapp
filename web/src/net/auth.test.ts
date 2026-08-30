import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApi, canPersistSession, httpBaseFromWs } from './auth'

describe('AuthApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('usa cookie protegido e retorna o access token sem armazená-lo', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-curto', access_expires_at: 123,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)

    const session = await new AuthApi('wss://chat.example/ws').authenticate('login', 'Deon', 'segredo', true)
    expect(session.access_token).toBe('access-curto')
    expect(fetch).toHaveBeenCalledWith('https://chat.example/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'include',
      headers: expect.objectContaining({ 'X-Stapp-Client': 'stapp-web-v2' }),
    }))
  })

  it('mapeia WebSocket para HTTP e só persiste sessão em transporte seguro ou local', () => {
    expect(httpBaseFromWs('wss://chat.example/ws')).toBe('https://chat.example')
    expect(canPersistSession('wss://chat.example/ws')).toBe(true)
    expect(canPersistSession('ws://localhost:8787/ws')).toBe(true)
    expect(canPersistSession('ws://192.168.1.2:8787/ws')).toBe(false)
  })
})
