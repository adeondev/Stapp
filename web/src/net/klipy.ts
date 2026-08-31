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

const DEFAULT_API_KEY = (import.meta as any).env?.VITE_KLIPY_API_KEY || 'demo'

export function extractGifUrl(item: KlipyGifItem): string {
  if (item.url) return item.url
  if (item.files?.original?.url) return item.files.original.url
  if (item.files?.preview?.url) return item.files.preview.url
  if (item.media && item.media.length > 0) {
    const m = item.media[0]
    if (m.gif?.url) return m.gif.url
    if (m.mediumgif?.url) return m.mediumgif.url
    if (m.tinygif?.url) return m.tinygif.url
  }
  if (item.images?.original?.url) return item.images.original.url
  if (item.images?.fixed_height?.url) return item.images.fixed_height.url
  return ''
}

export function extractGifPreview(item: KlipyGifItem): string {
  if (item.files?.preview?.url) return item.files.preview.url
  if (item.media && item.media.length > 0) {
    const m = item.media[0]
    if (m.tinygif?.url) return m.tinygif.url
    if (m.mediumgif?.url) return m.mediumgif.url
    if (m.gif?.url) return m.gif.url
  }
  if (item.images?.fixed_height?.url) return item.images.fixed_height.url
  return extractGifUrl(item)
}

function parseKlipyItems(json: any): KlipyGifItem[] {
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
  apiKey: string = DEFAULT_API_KEY,
  page: number = 1,
  perPage: number = 20
): Promise<KlipyGifItem[]> {
  try {
    const url = `https://api.klipy.com/api/v1/${apiKey}/gifs/trending?page=${page}&per_page=${perPage}`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    return parseKlipyItems(json)
  } catch (err) {
    console.warn('Erro ao buscar GIFs em alta no Klipy:', err)
    return []
  }
}

export async function searchGifs(
  query: string,
  apiKey: string = DEFAULT_API_KEY,
  page: number = 1,
  perPage: number = 20
): Promise<KlipyGifItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return fetchTrendingGifs(apiKey, page, perPage)

  try {
    const url = `https://api.klipy.com/api/v1/${apiKey}/gifs/search?q=${encodeURIComponent(trimmed)}&page=${page}&per_page=${perPage}`
    const res = await fetch(url)
    if (!res.ok) return []
    const json = await res.json()
    return parseKlipyItems(json)
  } catch (err) {
    console.warn('Erro ao buscar GIFs no Klipy:', err)
    return []
  }
}