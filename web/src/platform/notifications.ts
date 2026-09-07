/**
 * Camada de plataforma para notificações nativas do sistema operacional (Desktop / Web).
 *
 * Dispara notificações via `@tauri-apps/plugin-notification` no Tauri
 * ou via Web Notification API como fallback.
 *
 * As notificações são disparadas quando a janela está oculta ou desfocada.
 * O clique na notificação nativa traz a janela do Stapp para o primeiro plano.
 */

import { isTauriRuntime } from './externalLink'
import { notificationAllowed } from '../ui/settings/notificationPreferences'

export interface NativeNotificationOptions {
  title: string
  body: string
  extra?: Record<string, unknown>
}

let actionListenerInitialized = false

/** Verifica se a janela do aplicativo está atualmente oculta ou desfocada */
export async function isWindowUnfocusedOrHidden(): Promise<boolean> {
  if (typeof document !== 'undefined') {
    if (document.hidden) return true
    if (!document.hasFocus()) return true
  }

  if (isTauriRuntime()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const [isFocused, isVisible] = await Promise.all([win.isFocused(), win.isVisible()])
      return !isFocused || !isVisible
    } catch {
      // Ignora falha de consulta e segue com document.hidden
    }
  }

  return false
}

/** Traz a janela do aplicativo para o primeiro plano com foco */
export async function focusAppWindow(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.show()
      await win.unminimize()
      await win.setFocus()
      return
    } catch (err) {
      console.warn('[notifications] Falha ao focar janela via Tauri:', err)
    }
  }

  if (typeof window !== 'undefined') {
    window.focus()
  }
}

/** Registra listener para focar o app quando o usuário interagir com a notificação nativa */
export async function initNotificationActionListener(): Promise<void> {
  if (actionListenerInitialized || !isTauriRuntime()) return
  try {
    const { onAction } = await import('@tauri-apps/plugin-notification')
    await onAction(() => {
      void focusAppWindow()
    })
    actionListenerInitialized = true
  } catch (err) {
    console.warn('[notifications] Falha ao registrar onAction:', err)
  }
}

/** Dispara notificação nativa se a janela estiver desfocada ou minimizada */
export async function showDesktopNotification(options: NativeNotificationOptions): Promise<void> {
  const shouldNotify = await isWindowUnfocusedOrHidden()
  if (!shouldNotify) return

  if (isTauriRuntime()) {
    try {
      await initNotificationActionListener()
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        '@tauri-apps/plugin-notification'
      )
      let granted = await isPermissionGranted()
      if (!granted) {
        const permission = await requestPermission()
        granted = permission === 'granted'
      }
      if (granted) {
        sendNotification({
          title: options.title,
          body: options.body,
          extra: options.extra,
        })
      }
      return
    } catch (err) {
      console.warn('[notifications] Falha ao enviar notificação nativa:', err)
    }
  }

  // Fallback para Web Notification API
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        const notif = new Notification(options.title, { body: options.body })
        notif.onclick = () => {
          void focusAppWindow()
          notif.close()
        }
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission()
        if (perm === 'granted') {
          const notif = new Notification(options.title, { body: options.body })
          notif.onclick = () => {
            void focusAppWindow()
            notif.close()
          }
        }
      }
    } catch (err) {
      console.warn('[notifications] Falha ao enviar Web Notification:', err)
    }
  }
}

/**
 * Dispara notificação nativa para chamada de áudio recebida.
 *
 * O interruptor é lido aqui, e não em quem chama, para que nenhuma tela nova
 * possa esquecer de consultá-lo — a decisão mora junto do disparo.
 */
export function notifyIncomingCall(callerName: string): Promise<void> {
  if (!notificationAllowed('calls')) return Promise.resolve()
  return showDesktopNotification({
    title: 'Chamada de áudio recebida',
    body: `${callerName} está te ligando...`,
    extra: { type: 'call' },
  })
}

/** Dispara notificação nativa para nova mensagem direta (DM) */
export function notifyNewDm(senderName: string, previewText?: string): Promise<void> {
  if (!notificationAllowed('directMessages')) return Promise.resolve()
  return showDesktopNotification({
    title: `Mensagem direta de ${senderName}`,
    body: previewText || 'Nova mensagem direta',
    extra: { type: 'dm' },
  })
}

/** Dispara notificação nativa para menção direta (@) em canal */
export function notifyMention(authorName: string, channelOrContext: string, messageText?: string): Promise<void> {
  if (!notificationAllowed('mentions')) return Promise.resolve()
  return showDesktopNotification({
    title: `${authorName} mencionou você em #${channelOrContext}`,
    body: messageText || 'Você foi mencionado em uma mensagem',
    extra: { type: 'mention' },
  })
}
