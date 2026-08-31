export interface KlipyFileRendition {
  url: string
  width?: number
  height?: number
  size?: number
}

export interface KlipyGifItem {
  id: string
  title: string
  type: string
  url?: string
  files?: {
    original?: KlipyFileRendition
    preview?: KlipyFileRendition
    [key: string]: KlipyFileRendition | undefined
  }
  media?: Array<{
    gif?: KlipyFileRendition
    mediumgif?: KlipyFileRendition
    tinygif?: KlipyFileRendition
    [key: string]: KlipyFileRendition | undefined
  }>
  images?: {
    original?: { url: string }
    fixed_height?: { url: string }
    [key: string]: any
  }
}

export interface KlipyResponse {
  result?: boolean
  data?: any
}

// Chave pública padrão para catálogo de GIFs
const GIPHY_PUBLIC_KEY = 'sXpGFDGZs0Dv1mmNFvYaGUvYwKX0PWIh'
const KLIPY_API_KEY = (import.meta as any).env?.VITE_KLIPY_API_KEY || ''

/** Extensoes que identificam midia de verdade, e nao a pagina do GIF. */
const ARQUIVO_DE_MIDIA = /\.(gif|webp|mp4|webm)(\?|#|$)/i

/**
 * URL da midia animada, para ir dentro da mensagem.
 *
 * ARMADILHA: no Giphy o campo `url` do item e a PAGINA do GIF
 * (`https://giphy.com/gifs/algo-abc123`), nao o arquivo. Enviar aquilo dentro de
 * `![GIF](...)` gerava um `<img>` apontando para HTML — o grid do seletor
 * aparecia certo (ele usa `extractGifPreview`) e o chat ficava com a imagem
 * quebrada. Por isso as renditions vem primeiro e `item.url` so entra se
 * terminar em arquivo de midia.
 */
export function extractGifUrl(item: KlipyGifItem): string {
  const candidatos = [
    item.files?.original?.url,
    item.images?.original?.url,
    item.images?.fixed_height?.url,
    item.files?.preview?.url,
    item.media?.[0]?.gif?.url,
    item.media?.[0]?.mediumgif?.url,
    item.media?.[0]?.tinygif?.url,
  ]

  for (const candidato of candidatos) {
    if (candidato) return candidato
  }

  if (item.url && ARQUIVO_DE_MIDIA.test(item.url)) return item.url
  return ''
}

export function extractGifPreview(item: KlipyGifItem): string {
  if (item.images?.fixed_height?.url) return item.images.fixed_height.url
  if (item.files?.preview?.url) return item.files.preview.url
  if (item.media && item.media.length > 0) {
    const m = item.media[0]
    if (m.tinygif?.url) return m.tinygif.url
    if (m.mediumgif?.url) return m.mediumgif.url
    if (m.gif?.url) return m.gif.url
  }
  return extractGifUrl(item)
}

function parseItems(json: any): KlipyGifItem[] {
  const rawList: any[] = Array.isArray(json)
    ? json
    : Array.isArray(json.data?.data)
    ? json.data.data
    : Array.isArray(json.data)
    ? json.data
    : Array.isArray(json.results)
    ? json.results
    : []

  return rawList
    .filter((item) => item && item.type !== 'ad')
    .filter((item) => Boolean(extractGifUrl(item)))
}

export async function fetchTrendingGifs(
  apiKey: string = KLIPY_API_KEY,
  page: number = 1,
  perPage: number = 20
): Promise<KlipyGifItem[]> {
  // Se houver chave personalizada do Klipy configurada, tenta primeiro o Klipy
  if (apiKey) {
    try {
      const url = `https://api.klipy.com/api/v1/${apiKey}/gifs/trending?page=${page}&per_page=${perPage}`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        const items = parseItems(json)
        if (items.length > 0) return items
      }
    } catch {
      // Fallback para o provedor público abaixo
    }
  }

  // Provedor público de alta disponibilidade (Giphy CDN)
  try {
    const offset = (page - 1) * perPage
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_PUBLIC_KEY}&limit=${perPage}&offset=${offset}&rating=g`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    return parseItems(json)
  } catch (err) {
    console.warn('Erro ao buscar GIFs em alta:', err)
    return []
  }
}

export async function searchGifs(
  query: string,
  apiKey: string = KLIPY_API_KEY,
  page: number = 1,
  perPage: number = 20
): Promise<KlipyGifItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return fetchTrendingGifs(apiKey, page, perPage)

  if (apiKey) {
    try {
      const url = `https://api.klipy.com/api/v1/${apiKey}/gifs/search?q=${encodeURIComponent(trimmed)}&page=${page}&per_page=${perPage}`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        const items = parseItems(json)
        if (items.length > 0) return items
      }
    } catch {
      // Fallback para o provedor público abaixo
    }
  }

  try {
    const offset = (page - 1) * perPage
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_PUBLIC_KEY}&q=${encodeURIComponent(trimmed)}&limit=${perPage}&offset=${offset}&rating=g`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    return parseItems(json)
  } catch (err) {
    console.warn('Erro ao buscar GIFs:', err)
    return []
  }
}