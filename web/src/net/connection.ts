import type { AuthMode, ClientMsg, ServerMsg } from '../protocol'

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

interface Handlers {
  onMessage(msg: ServerMsg): void
  onStatus(status: ConnectionStatus, detail?: string): void
}

interface Credentials {
  mode: AuthMode
  username: string
  password: string
}

/** WebSocket unico, com autenticacao explicita e reconexao automatica. */
export class Connection {
  private ws: WebSocket | null = null
  private closedByUs = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private authReady = false
  private authSent = false

  // PROTOTYPE: a senha fica somente nesta instancia para refazer login depois de
  // uma queda. FUTURE: trocar por token efemero sem persistir sessao em disco.
  private credentials: Credentials | null = null

  constructor(
    private readonly url: string,
    private readonly handlers: Handlers,
  ) {
    this.open()
  }

  authenticate(mode: AuthMode, username: string, password: string) {
    this.credentials = { mode, username, password }
    this.authSent = false
    this.sendCredentials()
  }

  clearCredentials() {
    this.credentials = null
    this.authSent = false
  }

  private open() {
    this.authReady = false
    this.authSent = false
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.handlers.onStatus('offline', 'endereco invalido')
      return
    }
    this.ws = ws

    ws.addEventListener('open', () => {
      this.attempt = 0
    })

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMsg
        if (msg.t === 'auth.required') {
          this.authReady = true
          this.sendCredentials()
        } else if (msg.t === 'auth.error') {
          this.authSent = false
        } else if (msg.t === 'welcome') {
          this.handlers.onStatus('online')
        }
        this.handlers.onMessage(msg)
      } catch {
        // Frame fora do protocolo nao derruba a sessao.
      }
    })

    ws.addEventListener('close', () => {
      if (this.closedByUs) return
      this.retry()
    })
    ws.addEventListener('error', () => {})
  }

  private sendCredentials() {
    if (!this.authReady || this.authSent || !this.credentials) return
    const { mode, username, password } = this.credentials
    this.send({ t: mode === 'login' ? 'auth.login' : 'auth.register', username, password })
    this.authSent = true
  }

  private retry() {
    this.attempt++
    const delay = Math.min(500 * 2 ** (this.attempt - 1), 10_000)
    this.handlers.onStatus('reconnecting', `tentando de novo em ${Math.round(delay / 1000)}s`)
    this.timer = setTimeout(() => this.open(), delay)
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  close() {
    this.closedByUs = true
    this.clearCredentials()
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.handlers.onStatus('offline')
  }
}

export function isSecureAuthUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'wss:') return true
    const hostname = url.hostname.toLowerCase()
    return (
      url.protocol === 'ws:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1')
    )
  } catch {
    return false
  }
}

/** Em dev o servidor esta noutra porta; em producao ele mesmo serve o app. */
export function defaultServerUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787/ws`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
}
