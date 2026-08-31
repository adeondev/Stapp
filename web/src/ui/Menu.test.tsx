// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MenuItem, PopupMenu } from './Menu'

describe('menu compartilhado', () => {
  it('corrige a posicao nas bordas, navega pelo teclado e fecha com Escape', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 260, bottom: 300,
      width: 260, height: 300, toJSON: () => ({}),
    })
    const close = vi.fn()
    render(
      <PopupMenu position={{ x: 790, y: 590 }} label="Opções" onClose={close}>
        <MenuItem onClick={vi.fn()}>Primeira</MenuItem>
        <MenuItem onClick={vi.fn()}>Segunda</MenuItem>
      </PopupMenu>,
    )

    const menu = screen.getByRole('menu', { name: 'Opções' })
    expect(menu.getAttribute('style')).toContain('left: 532px')
    expect(menu.getAttribute('style')).toContain('top: 292px')
    expect(screen.getByRole('menuitem', { name: 'Primeira' })).toBe(document.activeElement)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Segunda' })).toBe(document.activeElement)
    await userEvent.keyboard('{Escape}')
    expect(close).toHaveBeenCalled()
    bounds.mockRestore()
  })

  it('expoe checkmark como item de menu acessivel', () => {
    render(<PopupMenu position={{ x: 20, y: 20 }} label="Selecao" onClose={vi.fn()}>
      <MenuItem checked icon={<span aria-hidden="true">I</span>} onClick={vi.fn()}>Ativo</MenuItem>
    </PopupMenu>)
    const item = screen.getByRole('menuitemcheckbox', { name: 'Ativo' })
    expect(item.getAttribute('aria-checked')).toBe('true')
    expect(item.querySelector('.menu-item__check svg')).toBeTruthy()
  })
})
