// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowMock = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}),
  startDragging: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false), isFocused: vi.fn(async () => true),
  onResized: vi.fn(async () => () => {}), onFocusChanged: vi.fn(async () => () => {}),
}))

vi.mock('./desktopWindow', () => ({ currentDesktopWindow: async () => windowMock }))

import { DesktopFrame } from './DesktopFrame'

describe('DesktopFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('nao adiciona titlebar no navegador', () => {
    render(<DesktopFrame><div>conteudo</div></DesktopFrame>)
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.getByText('conteudo')).toBeTruthy()
  })

  it('controla a janela pela titlebar compacta no Tauri', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    render(<DesktopFrame><div>conteudo</div></DesktopFrame>)

    await waitFor(() => expect(windowMock.isMaximized).toHaveBeenCalledOnce())
    fireEvent.pointerDown(screen.getByRole('banner'), { button: 0, detail: 1 })
    expect(windowMock.startDragging).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => {
      expect(windowMock.minimize).toHaveBeenCalledOnce()
      expect(windowMock.toggleMaximize).toHaveBeenCalledOnce()
      expect(windowMock.close).toHaveBeenCalledOnce()
    })
  })
})
