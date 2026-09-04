import { nowMicros, type ClientMsg, type ServerMsg } from '../protocol'
import { APP_VERSION } from '../platform/updater'

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface TelemetryMetrics {
  nonce: string
  t0: number
  t1: number
  t2: number
  t3: number
  uplinkUs: number
  serverUs: number
  downlinkUs: number
  totalRttUs: number
  netRttUs: number
  bufferedAmountBytes: number
}

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

  private readonly pendingTelemetry = new Map<string, (metrics: TelemetryMetrics) => void>()

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

  measureRtt(callback?: (metrics: TelemetryMetrics) => void): string {
    const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
    const t0 = nowMicros()
    if (callback) {
      this.pendingTelemetry.set(nonce, callback)
    }
    this.send({ t: 'telemetry.ping', nonce, t0 })
    return nonce
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
        } else if (msg.t === 'telemetry.pong') {
          const t3 = nowMicros()
          const metrics: TelemetryMetrics = {
            nonce: msg.nonce,
            t0: msg.t0,
            t1: msg.t1,
            t2: msg.t2,
            t3,
            uplinkUs: msg.t1 - msg.t0,
            serverUs: msg.t2 - msg.t1,
            downlinkUs: t3 - msg.t2,
            totalRttUs: t3 - msg.t0,
            netRttUs: (t3 - msg.t0) - (msg.t2 - msg.t1),
            bufferedAmountBytes: this.ws?.bufferedAmount ?? 0,
          }

          console.info('[RTT Profiling]', {
            nonce: metrics.nonce,
            uplinkMs: (metrics.uplinkUs / 1000).toFixed(2),
            serverMs: (metrics.serverUs / 1000).toFixed(2),
            downlinkMs: (metrics.downlinkUs / 1000).toFixed(2),
            totalRttMs: (metrics.totalRttUs / 1000).toFixed(2),
            netRttMs: (metrics.netRttUs / 1000).toFixed(2),
            bufferedKb: (metrics.bufferedAmountBytes / 1024).toFixed(1),
          })

          const callback = this.pendingTelemetry.get(msg.nonce)
          if (callback) {
            this.pendingTelemetry.delete(msg.nonce)
            callback(metrics)
          }
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
    this.send({ t: 'auth.access', access_token: this.accessToken, client_version: APP_VERSION })
    this.authSent = true
  }

  private retry() {
    this.attempt++
    const delay = Math.min(500 * 2 ** (this.attempt - 1), 10_000)
    this.handlers.onStatus('reconnecting', `tentando de novo em ${Math.round(delay / 1000)}s`)
    this.timer = setTimeout(() => this.open(), delay)
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 65_536) {
        console.warn(`[Backpressure Alert] bufferedAmount alto: ${this.ws.bufferedAmount} bytes`)
      }
      if (this.ws.bufferedAmount > 262_144 && (msg.t === 'typing.set' || msg.t === 'telemetry.ping')) {
        console.warn(`[Backpressure Dropped] Descartando mensagem efêmera '${msg.t}' devido a buffer elevado (${this.ws.bufferedAmount} bytes)`)
        return false
      }
      this.ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  close() {
    this.closedByUs = true
    this.pendingTelemetry.clear()
    this.clearAccess()
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.handlers.onStatus('offline')
  }
}

/** Em dev o servidor esta noutra porta; em producao ele mesmo serve o app. */
export function defaultServerUrl(): string {
  // A casca Tauri serve os assets em `tauri.localhost`; isso e a interface,
  // nao um servidor Stapp. No desktop do host, o primeiro uso aponta para o
  // servidor local sem salvar esse endereco ou qualquer segredo.
  if ('__TAURI_INTERNALS__' in window) return 'ws://127.0.0.1:8787/ws'
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787/ws`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
}
