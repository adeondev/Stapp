// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServerRail } from './ServerRail'

describe('barra de servidores', () => {
  it('mostra e limita o total de pendencias da Home', () => {
    const props = {
      servers: [], activeUrl: '', homeActive: false, onHome: vi.fn(), onSelect: vi.fn(), onAdd: vi.fn(),
    }
    const view = render(<ServerRail {...props} homeNotificationCount={105} />)
    expect(screen.getByText('99+')).toBeTruthy()
    expect(screen.getByRole('button', { name: /105 pendentes/ })).toBeTruthy()
    view.rerender(<ServerRail {...props} homeNotificationCount={0} />)
    expect(screen.queryByText('99+')).toBeNull()
  })

  it('abre menu de contexto ao clicar com botao direito no servidor e executa acoes', async () => {
    const { MenuHost } = await import('./Menu')
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    const onMarkAsRead = vi.fn()
    const onRemoveServer = vi.fn()
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    const testServer = {
      url: 'ws://localhost:9000',
      name: 'Alpha Server',
      username: 'tester',
      lastUsed: Date.now(),
    }

    render(
      <MenuHost>
        <ServerRail
          servers={[testServer]}
          activeUrl="ws://localhost:9000"
          homeActive={false}
          homeNotificationCount={0}
          onHome={vi.fn()}
          onSelect={vi.fn()}
          onAdd={vi.fn()}
          onMarkAsRead={onMarkAsRead}
          onRemoveServer={onRemoveServer}
        />
      </MenuHost>
    )

    const serverButton = screen.getByRole('button', { name: 'Alpha Server' })

    // Right click on server
    await user.pointer({ keys: '[MouseRight]', target: serverButton })

    expect(screen.getByRole('menuitem', { name: 'Marcar como lido' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copiar endereço do servidor' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Remover servidor da lista' })).toBeTruthy()

    // Test Mark as read
    await user.click(screen.getByRole('menuitem', { name: 'Marcar como lido' }))
    expect(onMarkAsRead).toHaveBeenCalledWith(testServer)

    // Open context menu again
    await user.pointer({ keys: '[MouseRight]', target: serverButton })

    // Test Copy address
    await user.click(screen.getByRole('menuitem', { name: 'Copiar endereço do servidor' }))
    expect(writeTextMock).toHaveBeenCalledWith('ws://localhost:9000')

    // Open context menu again
    await user.pointer({ keys: '[MouseRight]', target: serverButton })

    // Click Remove server from list -> opens modal
    await user.click(screen.getByRole('menuitem', { name: 'Remover servidor da lista' }))

    expect(screen.getByRole('dialog', { name: 'Remover servidor da lista' })).toBeTruthy()
    expect(screen.getByText(/Tem certeza que deseja remover/)).toBeTruthy()

    // Confirm removal in modal
    await user.click(screen.getByRole('button', { name: 'Remover servidor' }))
    expect(onRemoveServer).toHaveBeenCalledWith(testServer)
  })
})
