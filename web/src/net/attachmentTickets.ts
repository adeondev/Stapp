import { useCallback, useEffect, useRef, useState } from 'react'
import { attachmentContentUrl } from './mediaUpload'
import { httpBaseFromWs } from './auth'

export const DEFAULT_TICKET_TTL_MS = 8 * 60 * 1000 // 8 minutes

export interface CachedTicket {
  url: string
  expiresAt: number
}

export interface GetAttachmentTicketOptions {
  forceRefresh?: boolean
  ttlMs?: number
  onRenewToken?: () => Promise<string | null>
}

// In-memory cache for valid tickets
const ticketCache = new Map<string, CachedTicket>()

// Deduplication map for in-flight requests
const inFlightRequests = new Map<string, Promise<string>>()

export function getTicketCacheKey(serverUrl: string, attachmentId: string): string {
  return `${serverUrl}::${attachmentId}`
}

export function clearAttachmentTicketCache(): void {
  ticketCache.clear()
  inFlightRequests.clear()
}

export function invalidateAttachmentTicket(serverUrl: string, attachmentId: string): void {
  const key = getTicketCacheKey(serverUrl, attachmentId)
  ticketCache.delete(key)
}

export function resolveAttachmentUrl(rawUrl: string, serverUrl?: string): string {
  if (!rawUrl || /^(https?:|blob:|data:)/.test(rawUrl)) return rawUrl
  if (!serverUrl) return rawUrl
  const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
  return `${httpBaseFromWs(serverUrl)}${path}`
}

export async function getAttachmentTicket(
  serverUrl: string,
  accessToken: string,
  attachmentId: string,
  options: GetAttachmentTicketOptions = {},
): Promise<string> {
  const key = getTicketCacheKey(serverUrl, attachmentId)
  const ttl = options.ttlMs ?? DEFAULT_TICKET_TTL_MS

  if (!options.forceRefresh) {
    const cached = ticketCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url
    }

    const inFlight = inFlightRequests.get(key)
    if (inFlight) {
      return inFlight
    }
  }

  if (options.forceRefresh) {
    ticketCache.delete(key)
  }

  const promise = (async () => {
    try {
      const url = await attachmentContentUrl(
        serverUrl,
        accessToken,
        attachmentId,
        options.onRenewToken,
      )
      ticketCache.set(key, {
        url,
        expiresAt: Date.now() + ttl,
      })
      return url
    } finally {
      inFlightRequests.delete(key)
    }
  })()

  inFlightRequests.set(key, promise)
  return promise
}

export interface UseAttachmentTicketParams {
  attachmentId: string
  serverUrl?: string
  accessToken?: string | null
  initialUrl?: string
  onRenewToken?: () => Promise<string | null>
}

export interface UseAttachmentTicketResult {
  url: string | null
  error: boolean
  retrying: boolean
  renewTicket: (forceRefresh?: boolean) => Promise<string | null>
  handleMediaError: () => void
}

export function useAttachmentTicket({
  attachmentId,
  serverUrl,
  accessToken,
  initialUrl,
  onRenewToken,
}: UseAttachmentTicketParams): UseAttachmentTicketResult {
  const [url, setUrl] = useState<string | null>(() => {
    if (initialUrl) return resolveAttachmentUrl(initialUrl, serverUrl)
    return null
  })
  const [error, setError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const retryCountRef = useRef(0)

  const renewTicket = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      if (initialUrl) {
        const directUrl = resolveAttachmentUrl(initialUrl, serverUrl)
        setUrl(directUrl)
        setError(false)
        return directUrl
      }
      if (!serverUrl || !accessToken) return null
      try {
        setRetrying(true)
        const next = await getAttachmentTicket(serverUrl, accessToken, attachmentId, {
          forceRefresh,
          onRenewToken,
        })
        setUrl(next)
        setError(false)
        retryCountRef.current = 0
        return next
      } catch {
        setError(true)
        return null
      } finally {
        setRetrying(false)
      }
    },
    [accessToken, attachmentId, initialUrl, onRenewToken, serverUrl],
  )

  useEffect(() => {
    if (initialUrl) {
      setUrl(resolveAttachmentUrl(initialUrl, serverUrl))
      return
    }
    if (!serverUrl || !accessToken) return

    let disposed = false
    let timer: any = 0

    const refresh = async () => {
      try {
        const next = await getAttachmentTicket(serverUrl, accessToken, attachmentId, {
          forceRefresh: false,
          onRenewToken,
        })
        if (!disposed) {
          setUrl(next)
          setError(false)
          retryCountRef.current = 0
          timer = window.setTimeout(refresh, DEFAULT_TICKET_TTL_MS)
        }
      } catch {
        if (!disposed) setError(true)
      }
    }

    void refresh()

    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [accessToken, attachmentId, initialUrl, onRenewToken, serverUrl])

  const handleMediaError = useCallback(() => {
    if (retryCountRef.current < 2) {
      retryCountRef.current += 1
      void renewTicket(true)
    } else {
      setError(true)
    }
  }, [renewTicket])

  return {
    url,
    error,
    retrying,
    renewTicket,
    handleMediaError,
  }
}