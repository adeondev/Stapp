// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauriRuntime, openExternalLink } from './externalLink'

describe('externalLink', () => {
  const originalOpen = window.open

  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI__
  })

  afterEach(() => {
    window.open = originalOpen
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI__
  })

  it('detecta ambiente web quando __TAURI_INTERNALS__ nao existe', () => {
    expect(isTauriRuntime()).toBe(false)
  })

  it('detecta ambiente desktop quando __TAURI_INTERNALS__ existe', () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isTauriRuntime()).toBe(true)
  })

  it('no ambiente web, abre URL via window.open com noopener,noreferrer', async () => {
    const openSpy = vi.fn()
    window.open = openSpy

    await openExternalLink('https://stapp.chat')

    expect(openSpy).toHaveBeenCalledWith('https://stapp.chat', '_blank', 'noopener,noreferrer')
  })

  it('ignora URLs vazias ou nulas', async () => {
    const openSpy = vi.fn()
    window.open = openSpy

    await openExternalLink('')

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('no ambiente desktop (Tauri), delega abertura ao plugin opener', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const openSpy = vi.fn()
    window.open = openSpy

    const mockOpenUrl = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@tauri-apps/plugin-opener', () => ({
      openUrl: mockOpenUrl,
    }))

    await openExternalLink('https://stapp.chat/invite')

    expect(mockOpenUrl).toHaveBeenCalledWith('https://stapp.chat/invite')
    expect(openSpy).not.toHaveBeenCalled()
  })
})
