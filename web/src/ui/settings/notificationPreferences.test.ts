import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  notificationAllowed,
  saveNotificationPreferences,
} from './notificationPreferences'

/* As notificacoes nativas disparavam sempre — nao havia nenhum lugar para
   desligar uma delas. O que estes casos travam e o contrato do interruptor:
   tudo ligado no primeiro uso, a escolha atravessa o fechar-e-abrir, e uma
   preferencia corrompida no armazenamento nao pode deixar ninguem sem aviso. */

describe('preferências de notificação', () => {
  beforeEach(() => localStorage.clear())

  it('começa com tudo ligado', () => {
    expect(loadNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    expect(notificationAllowed('calls')).toBe(true)
    expect(notificationAllowed('directMessages')).toBe(true)
    expect(notificationAllowed('mentions')).toBe(true)
  })

  it('guarda e devolve a escolha', () => {
    saveNotificationPreferences({ calls: true, directMessages: false, mentions: true })
    expect(loadNotificationPreferences()).toEqual({
      calls: true, directMessages: false, mentions: true,
    })
    expect(notificationAllowed('directMessages')).toBe(false)
    expect(notificationAllowed('calls')).toBe(true)
  })

  it('lê a decisão na hora do disparo, e não uma cópia velha', () => {
    expect(notificationAllowed('mentions')).toBe(true)
    saveNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, mentions: false })
    expect(notificationAllowed('mentions')).toBe(false)
  })

  it('completa o que faltar em vez de esquecer o resto', () => {
    localStorage.setItem('stapp.notifications.v1', JSON.stringify({ calls: false }))
    expect(loadNotificationPreferences()).toEqual({
      calls: false, directMessages: true, mentions: true,
    })
  })

  it('armazenamento ilegível não deixa ninguém sem aviso', () => {
    localStorage.setItem('stapp.notifications.v1', 'isto nao e json')
    expect(loadNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
  })
})
