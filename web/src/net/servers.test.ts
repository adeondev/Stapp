// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { hasPendingLogout, loadServers, normalizeServerUrl, saveServer, setPendingLogout } from './servers'

describe('servidores lembrados', () => {
  beforeEach(() => localStorage.clear())

  it('normaliza o endereço e persiste somente metadados não secretos', () => {
    const url = normalizeServerUrl('stapp.example')
    expect(url).toBe('ws://stapp.example/ws')
    saveServer({ url, serverId: 'srv-1', name: 'Casa', username: 'Deon', lastUsed: 10 })

    const raw = JSON.stringify(localStorage)
    expect(raw).not.toContain('password')
    expect(raw).not.toContain('access_token')
    expect(raw).not.toContain('refresh_token')
    expect(loadServers()[0]).toMatchObject({ url, serverId: 'srv-1', username: 'Deon' })
  })

  it('descarta campos secretos de metadados antigos ou adulterados', () => {
    localStorage.setItem('stapp.servers.v2', JSON.stringify([{
      url: 'wss://chat.example/ws', name: 'Casa', username: 'Deon', lastUsed: 1,
      password: 'não guardar', access_token: 'não guardar', refresh_token: 'não guardar',
    }]))
    expect(Object.keys(loadServers()[0]).sort()).not.toContain('password')
    expect(Object.keys(loadServers()[0]).sort()).not.toContain('access_token')
  })

  it('mantém uma revogação pendente separada após remover um servidor offline', () => {
    setPendingLogout('wss://chat.example/ws', true)
    expect(hasPendingLogout('wss://chat.example/ws')).toBe(true)
    setPendingLogout('wss://chat.example/ws', false)
    expect(hasPendingLogout('wss://chat.example/ws')).toBe(false)
  })
})
