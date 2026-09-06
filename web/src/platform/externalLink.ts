/**
 * Camada de isolamento para abertura de links externos.
 *
 * No Tauri desktop, <a target="_blank"> falha silenciosamente na WebView2 ou
 * tenta navegar a janela interna. Usamos o plugin opener para delegar ao
 * navegador padrao do sistema operacional.
 *
 * No runtime Web (navegador), usamos window.open com noopener,noreferrer.
 */

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

export async function openExternalLink(url: string): Promise<void> {
  if (!url) return

  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (err) {
      console.error('[externalLink] Falha ao abrir link externo via opener:', err)
    }
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export const openExternal = openExternalLink
export const openExternalUrl = openExternalLink
