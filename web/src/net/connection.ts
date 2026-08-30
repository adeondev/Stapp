import type { ClientMsg, ServerMsg } from '../protocol'

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

interface Handlers {
  onMessage(msg: ServerMsg): void
  onStatus(status: ConnectionStatus, detail?: string): void
}

/** WebSocket unico, com autenticacao explicita e reconexao automatica. */
export class Connection {
  private ws: WebSocket | null = null
  private closedByUs = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private authReady = false
  private authSent = false

  // Access token curto e somente em memoria. O refresh fica num cookie
  // HttpOnly e nunca e acessivel por esta classe.
  private accessToken: string | null = null

  constructor(
    private readonly url: string,
    private readonly handlers: Handlers,
  ) {
    this.open()
  }

  /** O token atual. O upload de avatar vai por HTTP e precisa dele; guardar uma
   *  copia no App daria duas fontes de verdade que sairiam de sincronia no
   *  refresh. */
  get token(): string | null {
    return this.accessToken
  }

  authenticate(accessToken: string) {
    this.accessToken = accessToken
    this.authSent = false
    this.sendAccess()
  }

  clearAccess() {
    this.accessToken = null
    this.authSent = false
  }

  hasAccess() {
    return this.accessToken !== null
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
          this.sendAccess()
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

  private sendAccess() {
    if (!this.authReady || this.authSent || !this.accessToken) return
    this.send({ t: 'auth.access', access_token: this.accessToken })
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
    this.clearAccess()
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.handlers.onStatus('offline')
  }
}

/** Em dev o servidor esta noutra porta; em producao ele mesmo serve o app. */
export function defaultServerUrl(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787/ws`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
}
