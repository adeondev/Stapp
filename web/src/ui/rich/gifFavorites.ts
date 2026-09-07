export const GIF_FAVORITES_STORAGE_KEY = 'stapp_gif_favorites'
export const GIF_FAVORITES_EVENT = 'stapp:gif_favorites_updated'

/** Retorna a lista de URLs de GIFs favoritos persistidos no localStorage. */
export function getStoredFavoriteGifs(): string[] {
  try {
    const raw = localStorage.getItem(GIF_FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item : item?.url))
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    }
  } catch {
    // Falha silenciosa em caso de JSON malformatado
  }
  return []
}

/** Verifica se a URL informada já consta nos favoritos. */
export function isFavoriteGif(url: string): boolean {
  if (!url) return false
  return getStoredFavoriteGifs().includes(url)
}

/** Adiciona uma URL aos favoritos, disparando evento de sincronização. */
export function addFavoriteGif(url: string): void {
  if (!url) return
  const list = getStoredFavoriteGifs()
  if (list.includes(url)) return
  const updated = [url, ...list]
  localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, JSON.stringify(updated))
  window.dispatchEvent(new CustomEvent(GIF_FAVORITES_EVENT))
}

/** Remove uma URL dos favoritos, disparando evento de sincronização. */
export function removeFavoriteGif(url: string): void {
  if (!url) return
  const list = getStoredFavoriteGifs()
  const updated = list.filter((item) => item !== url)
  localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, JSON.stringify(updated))
  window.dispatchEvent(new CustomEvent(GIF_FAVORITES_EVENT))
}

/** Alterna o estado de favorito de um GIF, retornando true se foi favoritado ou false se foi desfavoritado. */
export function toggleFavoriteGif(url: string): boolean {
  if (!url) return false
  const list = getStoredFavoriteGifs()
  const exists = list.includes(url)
  let updated: string[]
  if (exists) {
    updated = list.filter((item) => item !== url)
  } else {
    updated = [url, ...list]
  }
  localStorage.setItem(GIF_FAVORITES_STORAGE_KEY, JSON.stringify(updated))
  window.dispatchEvent(new CustomEvent(GIF_FAVORITES_EVENT))
  return !exists
}

/** Identifica se o recurso ou anexo é um GIF animado por URL, extensão, alt ou tipo mime. */
export function isGifMedia(url?: string, alt?: string, contentType?: string): boolean {
  if (contentType === 'image/gif') return true
  if (!url) return false
  if (alt && alt.toLowerCase().includes('gif')) return true
  if (/\.gif(\?.*)?$/i.test(url)) return true
  if (url.includes('klipy.com') || url.includes('giphy.com') || url.includes('tenor.com')) return true
  return false
}
