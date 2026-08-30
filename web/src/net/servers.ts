export interface SavedServer {
  url: string
  serverId?: string
  name: string
  username: string
  lastUsed: number
  logoutPending?: boolean
}

const SERVERS_KEY = 'stapp.servers.v2'
const LAST_KEY = 'stapp.last-server.v2'
const PENDING_LOGOUT_KEY = 'stapp.pending-logouts.v2'

function cleanProfile(item: SavedServer): SavedServer {
  return {
    url: item.url,
    serverId: typeof item.serverId === 'string' ? item.serverId : undefined,
    name: item.name,
    username: typeof item.username === 'string' ? item.username : '',
    lastUsed: Number.isFinite(item.lastUsed) ? item.lastUsed : 0,
    logoutPending: item.logoutPending === true || hasPendingLogout(item.url) || undefined,
  }
}

export function normalizeServerUrl(raw: string): string {
  const value = raw.trim()
  const url = new URL(value.includes('://') ? value : `ws://${value}`)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('use um endereço ws:// ou wss://')
  }
  if (url.username || url.password) throw new Error('não inclua usuário ou senha no endereço')
  url.search = ''
  url.hash = ''
  if (url.pathname === '/' || !url.pathname) url.pathname = '/ws'
  return url.toString()
}

export function loadServers(): SavedServer[] {
  try {
    const value = JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]') as SavedServer[]
    if (!Array.isArray(value)) return []
    return value
      .filter((item) => typeof item?.url === 'string' && typeof item?.name === 'string')
      .map(cleanProfile)
      .sort((a, b) => b.lastUsed - a.lastUsed)
  } catch {
    return []
  }
}

export function saveServer(profile: SavedServer): SavedServer[] {
  profile = cleanProfile(profile)
  const servers = loadServers().filter((item) => item.url !== profile.url)
  const next = [profile, ...servers]
  localStorage.setItem(SERVERS_KEY, JSON.stringify(next))
  localStorage.setItem(LAST_KEY, profile.url)
  return next
}

export function removeServer(url: string): SavedServer[] {
  const next = loadServers().filter((item) => item.url !== url)
  localStorage.setItem(SERVERS_KEY, JSON.stringify(next))
  if (localStorage.getItem(LAST_KEY) === url) {
    if (next[0]) localStorage.setItem(LAST_KEY, next[0].url)
    else localStorage.removeItem(LAST_KEY)
  }
  return next
}

export function lastServer(servers = loadServers()): SavedServer | null {
  const url = localStorage.getItem(LAST_KEY)
  return servers.find((item) => item.url === url) ?? servers[0] ?? null
}

export function markLogoutPending(profile: SavedServer, pending: boolean): SavedServer {
  return { ...profile, logoutPending: pending || undefined, lastUsed: Date.now() }
}

export function hasPendingLogout(url: string): boolean {
  try {
    const entries = JSON.parse(localStorage.getItem(PENDING_LOGOUT_KEY) ?? '[]') as unknown
    return Array.isArray(entries) && entries.includes(url)
  } catch {
    return false
  }
}

export function setPendingLogout(url: string, pending: boolean) {
  let entries: string[] = []
  try {
    const stored = JSON.parse(localStorage.getItem(PENDING_LOGOUT_KEY) ?? '[]') as unknown
    if (Array.isArray(stored)) entries = stored.filter((item): item is string => typeof item === 'string')
  } catch { /* um valor local corrompido e substituído com segurança */ }
  const next = pending ? [...new Set([...entries, url])] : entries.filter((item) => item !== url)
  if (next.length > 0) localStorage.setItem(PENDING_LOGOUT_KEY, JSON.stringify(next))
  else localStorage.removeItem(PENDING_LOGOUT_KEY)
}
