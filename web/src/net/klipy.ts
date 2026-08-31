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
  files: {
    original?: KlipyFileRendition
    preview?: KlipyFileRendition
    [key: string]: KlipyFileRendition | undefined
  }
}

export interface KlipyResponse {
  result: boolean
  data?: {
    data: KlipyGifItem[]
    current_page: number
    per_page: number
    has_next: boolean
  }
}

const DEFAULT_API_KEY = (import.meta as any).env?.VITE_KLIPY_API_KEY || 'demo'

export async function fetchTrendingGifs(
  apiKey: string = DEFAULT_API_KEY,
  page: number = 1,
  perPage: number = 20
): Promise<KlipyGifItem[]> {
  try {
    const url = `https://api.klipy.com/api/v1/${apiKey}/gifs/trending?page=${page}&per_page=${perPage}`
    const res = await fetch(url)
    if (!res.ok) return []
    const json: KlipyResponse = await res.json()
    return (json.data?.data || []).filter((item) => item.type !== 'ad' && (item.files.original?.url || item.files.preview?.url))
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
    const json: KlipyResponse = await res.json()
    return (json.data?.data || []).filter((item) => item.type !== 'ad' && (item.files.original?.url || item.files.preview?.url))
  } catch (err) {
    console.warn('Erro ao buscar GIFs no Klipy:', err)
    return []
  }
}