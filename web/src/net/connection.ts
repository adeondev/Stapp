import type { ClientMsg, ServerMsg } from '../protocol'

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

interface Handlers {
  onMessage(msg: ServerMsg): void
  onStatus(status: ConnectionStatus, detail?: string): void
}

/**
 * Um WebSocket com reconexao. O `hello` e reenviado sozinho a cada reconexao —
 * quem usa esta classe nao precisa saber que a conexao caiu.
 */
export class Connection {
  private ws: WebSocket | null = null
  private closedByUs = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly url: string,
    private readonly nick: string,
    private readonly handlers: Handlers,
  ) {
    this.open()
  }

  private open() {
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
      this.send({ t: 'hello', nick: this.nick })
      this.handlers.onStatus('online')
    })

    ws.addEventListener('message', (event) => {
      try {
        this.handlers.onMessage(JSON.parse(event.data as string) as ServerMsg)
      } catch {
        // Frame que nao e do protocolo: ignora em vez de derrubar a sessao.
      }
    })

    ws.addEventListener('close', () => {
      if (this.closedByUs) return
      this.retry()
    })

    // O 'error' sempre vem seguido de 'close', entao a reconexao e tratada la.
    ws.addEventListener('error', () => {})
  }

  private retry() {
    this.attempt++
    // 0,5s, 1s, 2s, 4s... ate 10s.
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
