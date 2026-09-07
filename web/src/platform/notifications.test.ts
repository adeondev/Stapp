// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  focusAppWindow,
  isWindowUnfocusedOrHidden,
  notifyIncomingCall,
  notifyMention,
  notifyNewDm,
  showDesktopNotification,
} from './notifications'

describe('platform/notifications', () => {
  const originalHasFocus = document.hasFocus

  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
    document.hasFocus = () => true
  })

  afterEach(() => {
    document.hasFocus = originalHasFocus
  })

  it('detecta janela desfocada ou oculta corretamente', async () => {
    // Focada e visível -> false
    expect(await isWindowUnfocusedOrHidden()).toBe(false)

    // Oculta (hidden = true) -> true
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    expect(await isWindowUnfocusedOrHidden()).toBe(true)

    // Visível mas sem foco -> true
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.hasFocus = () => false
    expect(await isWindowUnfocusedOrHidden()).toBe(true)
  })

  it('não dispara notificação se a janela estiver visível e com foco', async () => {
    const notifySpy = vi.fn()
    window.Notification = class {
      constructor(title: string, options: any) {
        notifySpy(title, options)
      }
      static permission = 'granted'
      static requestPermission = vi.fn().mockResolvedValue('granted')
    } as any

    await showDesktopNotification({ title: 'Teste', body: 'Mensagem' })
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('dispara notificação com fallback web quando desfocada', async () => {
    document.hasFocus = () => false
    const notifySpy = vi.fn()
    window.Notification = class {
      constructor(title: string, options: any) {
        notifySpy(title, options)
      }
      static permission = 'granted'
      static requestPermission = vi.fn().mockResolvedValue('granted')
    } as any

    await showDesktopNotification({ title: 'Nova Notificação', body: 'Conteúdo' })
    expect(notifySpy).toHaveBeenCalledWith('Nova Notificação', { body: 'Conteúdo' })
  })

  it('helpers disparam notificações com formatações corretas', async () => {
    document.hasFocus = () => false
    const calls: Array<{ title: string; options: any }> = []
    window.Notification = class {
      constructor(title: string, options: any) {
        calls.push({ title, options })
      }
      static permission = 'granted'
      static requestPermission = vi.fn().mockResolvedValue('granted')
    } as any

    await notifyIncomingCall('Alice')
    expect(calls[0].title).toBe('Chamada de áudio recebida')
    expect(calls[0].options.body).toContain('Alice')

    await notifyNewDm('Bob', 'Oi Daniel!')
    expect(calls[1].title).toBe('Mensagem direta de Bob')
    expect(calls[1].options.body).toBe('Oi Daniel!')

    await notifyMention('Charlie', 'geral', 'E aí @daniel?')
    expect(calls[2].title).toBe('Charlie mencionou você em #geral')
    expect(calls[2].options.body).toBe('E aí @daniel?')
  })

  it('focusAppWindow chama window.focus no ambiente web', async () => {
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {})
    await focusAppWindow()
    expect(focusSpy).toHaveBeenCalled()
  })
})
