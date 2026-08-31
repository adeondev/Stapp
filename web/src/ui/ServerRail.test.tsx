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
})
