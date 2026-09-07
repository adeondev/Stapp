// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FriendsHome } from './FriendsHome'

const props = {
  members: [{
    user_id: 'user-2', username: 'daniyusk', relationship: 'none' as const,
    can_start_dm: true, has_conversation: false,
  }],
  onlineIds: new Set<string>(),
  onOpenDirect: vi.fn(),
  onAction: vi.fn(),
}

describe('FriendsHome', () => {
  beforeEach(() => vi.clearAllMocks())

  it('so mostra o formulario ao selecionar Adicionar amigo', async () => {
    const user = userEvent.setup()
    render(<FriendsHome {...props} />)

    const addTab = screen.getByRole('tab', { name: 'Adicionar amigo' })
    expect(screen.queryByLabelText('Username para adicionar')).toBeNull()

    await user.click(addTab)
    expect(screen.getByLabelText('Username para adicionar')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Todos' }))
    expect(screen.queryByLabelText('Username para adicionar')).toBeNull()
  })

  it('separa enviados e cancela com apenas o X final', async () => {
    const user = userEvent.setup()
    render(<FriendsHome {...props} members={[
      { user_id: 'sent-1', username: 'ana', relationship: 'outgoing', can_start_dm: false, has_conversation: false },
    ]} />)

    await user.click(screen.getByRole('tab', { name: 'Pendentes' }))
    expect(screen.getByRole('heading', { name: 'Enviados — 1' })).toBeTruthy()
    const cancel = screen.getByRole('button', { name: 'Cancelar pedido para ana' })
    expect(screen.queryByRole('button', { name: 'Bloquear' })).toBeNull()

    await user.click(cancel)
    expect(props.onAction).toHaveBeenCalledWith('cancel', 'sent-1')
  })

  it('agrupa amigos por servidor e permite expandir/recolher com persistencia no localStorage', async () => {
    localStorage.clear()
    const user = userEvent.setup()
    render(<FriendsHome {...props} onlineIds={new Set(['u1', 'u2'])} serverName="Servidor Alpha" members={[
      { user_id: 'u1', username: 'alice', relationship: 'friend', can_start_dm: true, has_conversation: true, server_name: 'Servidor Alpha' },
      { user_id: 'u2', username: 'bob', relationship: 'friend', can_start_dm: true, has_conversation: false, server_name: 'Servidor Beta' },
    ]} />)

    expect(screen.getByText('Servidor Alpha')).toBeTruthy()
    expect(screen.getByText('Servidor Beta')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()

    // Collapse Servidor Alpha
    const alphaButton = screen.getByRole('button', { name: /Servidor Alpha/ })
    await user.click(alphaButton)

    // Alice should be hidden because Servidor Alpha is collapsed
    expect(screen.queryByText('alice')).toBeNull()
    // Bob should still be visible
    expect(screen.getByText('bob')).toBeTruthy()

    // Verify localStorage
    expect(JSON.parse(localStorage.getItem('stapp.dms.accordions') || '{}')).toEqual({
      'Servidor Alpha': true,
    })

    // Expand again
    await user.click(alphaButton)
    expect(screen.getByText('alice')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('stapp.dms.accordions') || '{}')).toEqual({
      'Servidor Alpha': false,
    })
  })
})
