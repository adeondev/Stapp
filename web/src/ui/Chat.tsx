import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEntry } from '../protocol'
import { IconAt, IconHash, IconPhone } from './Icons'
import './chat.css'

/** Mensagens seguidas da mesma pessoa dentro disso viram um bloco so. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

interface Props {
  /** Nome no cabecalho: o canal ou a pessoa da conversa. */
  title: string
  kind: 'channel' | 'direct'
  messages: ChatEntry[]
  canSend: boolean
  disabledReason?: string
  onSend(text: string): void
  /** So existe em conversa direta: o botao de ligar. */
  onCall?: () => void
}

export function Chat({ title, kind, messages, canSend, disabledReason, onSend, onCall }: Props) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // So acompanha o fim se o usuario ja estava no fim — se ele subiu para ler
  // algo antigo, mensagem nova nao arranca a tela dele.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, title])

  useEffect(() => {
    setDraft('')
    pinned.current = true
  }, [title])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  function submit() {
    const text = draft.trim()
    if (!text || !canSend) return
    onSend(text)
    setDraft('')
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section className="chat">
      <header className="chat__head">
        {kind === 'direct' ? <IconAt /> : <IconHash />}
        <span className="chat__title">{title}</span>
        {onCall && (
          <button className="chat__call" type="button" onClick={onCall} title={`ligar para ${title}`}>
            <IconPhone />
          </button>
        )}
      </header>

      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && (
          <p className="chat__empty">ninguem falou nada aqui ainda.</p>
        )}
        {messages.map((msg, i) => {
          // Rastro de chamada nao e conversa: vira uma linha discreta, sem autor.
          if (msg.kind === 'call') {
            return (
              <p key={msg.id} className="chat__event">
                {msg.text} · {time(msg.ts)}
              </p>
            )
          }

          const previous = messages[i - 1]
          const grouped =
            previous !== undefined &&
            previous.kind !== 'call' &&
            previous.author_id === msg.author_id &&
            msg.ts - previous.ts < GROUP_WINDOW_MS

          return (
            <article key={msg.id} className={`chat__msg ${grouped ? 'is-grouped' : ''}`}>
              {!grouped && (
                <div className="chat__meta">
                  <span className="chat__nick">{msg.author_username}</span>
                  <span className="chat__time">{time(msg.ts)}</span>
                </div>
              )}
              <p className="chat__text">{msg.text}</p>
            </article>
          )
        })}
      </div>

      <div className="chat__composer">
        <textarea
          className="chat__input"
          value={draft}
          rows={1}
          placeholder={
            canSend
              ? kind === 'direct'
                ? `falar com ${title}`
                : `falar em ${title}`
              : disabledReason ?? 'sem conexão com o servidor'
          }
          disabled={!canSend}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </section>
  )
}
