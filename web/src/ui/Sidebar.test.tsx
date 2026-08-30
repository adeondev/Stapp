// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { initialState } from '../store'
import { Sidebar, sidebarModeFor, type View } from './Sidebar'

const state = {
  ...initialState,
  serverName: 'Stapp dos guri',
  channels: [
    { id: 'geral', name: 'geral', kind: 'text' as const },
    { id: 'sala', name: 'Sala de voz', kind: 'voice' as const },
  ],
  users: [{ user_id: 'user-2', username: 'daniyusk' }],
  conversations: {
    'user-2': { user_id: 'user-2', username: 'daniyusk', last: null, unread: 0 },
  },
}

const callbacks = {
  onSelectHome: vi.fn(),
  onSelectChannel: vi.fn(),
  onSelectDirect: vi.fn(),
  onJoinCall: vi.fn(),
}

function renderSidebar(view: View, mode: 'home' | 'server') {
  render(<Sidebar state={state} status="online" view={view} mode={mode}
    callChannel={null} speaking={new Set()} footer={<div>conta</div>} {...callbacks} />)
}

describe('Sidebar', () => {
  it('mostra somente amigos e conversas quando Home esta aberto', () => {
    renderSidebar({ kind: 'home' }, 'home')

    expect(screen.getByRole('button', { name: 'Amigos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'daniyusk' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'geral' })).toBeNull()
    expect(screen.queryByText('Stapp dos guri')).toBeNull()
  })

  it('mostra somente canais quando o servidor esta aberto', () => {
    renderSidebar({ kind: 'channel', id: 'geral' }, 'server')

    expect(screen.getByText('Stapp dos guri')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'geral' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sala de voz' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amigos' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'daniyusk' })).toBeNull()
  })

  it('mantem uma conversa direta dentro do Home, nao dentro do servidor', () => {
    expect(sidebarModeFor({ kind: 'direct', userId: 'user-2' })).toBe('home')
    expect(sidebarModeFor({ kind: 'channel', id: 'geral' })).toBe('server')
  })
})
