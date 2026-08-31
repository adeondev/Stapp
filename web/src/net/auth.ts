import type { ApiError, AuthMode, AuthSession } from '../protocol'

const CLIENT_HEADER = 'stapp-web-v2'
const refreshes = new Map<string, Promise<AuthSession | null>>()

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid_credentials',
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

export class AuthApi {
  readonly baseUrl: string

  constructor(readonly serverUrl: string) {
    this.baseUrl = httpBaseFromWs(serverUrl)
  }

  authenticate(mode: AuthMode, username: string, password: string, remember: boolean) {
    return this.request<AuthSession>(mode === 'login' ? 'login' : 'register', {
      username,
      password,
      remember,
    })
  }

  refresh(): Promise<AuthSession | null> {
    const current = refreshes.get(this.baseUrl)
    if (current) return current
    const request = this.request<AuthSession>('refresh')
      .catch((error) => {
        if (error instanceof AuthApiError && error.code === 'invalid_credentials') return null
        throw error
      })
      .finally(() => refreshes.delete(this.baseUrl))
    refreshes.set(this.baseUrl, request)
    return request
  }

  async logout(): Promise<boolean> {
    try {
      await this.request<void>('logout')
      return true
    } catch {
      return false
    }
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      response = await fetch(`${this.baseUrl}/auth/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Stapp-Client': CLIENT_HEADER,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch {
      throw new AuthApiError('não foi possível alcançar o servidor', 'network_error')
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const error = await response.json().catch(() => null) as ApiError | null
      throw new AuthApiError(
        error?.message ?? 'não foi possível autenticar',
        error?.code ?? 'invalid_credentials',
        error?.retry_after_ms,
      )
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
}

export function httpBaseFromWs(raw: string): string {
  const url = new URL(raw)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  else if (url.protocol === 'ws:') url.protocol = 'http:'
  else throw new Error('use um endereço ws:// ou wss://')
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.origin
}

/**
 * Base HTTP do servidor a partir do endereco guardado no perfil.
 *
 * O perfil guarda o endereco como WebSocket (`ws://host:8787`), mas anexo e
 * avatar sobem por HTTP. Sem esta conversao o `fetch` ia para
 * `ws://host:8787/attachments/presign` e falhava calado — o anexo nunca ficava
 * pronto e a mensagem saia so com texto. Aceita tambem `http(s)://` porque os
 * testes e o modo de mesma origem passam a URL ja em HTTP.
 */
export function httpBaseFrom(raw: string): string {
  const url = new URL(raw)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  else if (url.protocol === 'ws:') url.protocol = 'http:'
  else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('endereco de servidor invalido')
  }
  return url.origin
}

export function canPersistSession(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'wss:') return true
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
  } catch {
    return false
  }
}
