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
})
