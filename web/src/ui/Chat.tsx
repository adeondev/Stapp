import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Channel, Message } from '../protocol'
import { IconHash } from './Icons'
import './chat.css'

/** Mensagens seguidas da mesma pessoa dentro disso viram um bloco so. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

interface Props {
  channel: Channel
  messages: Message[]
  canSend: boolean
  onSend(text: string): void
}

export function Chat({ channel, messages, canSend, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  // So acompanha o fim se o usuario ja estava no fim — se ele subiu para ler
  // algo antigo, mensagem nova nao arranca a tela dele.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, channel.id])

  useEffect(() => {
    setDraft('')
    pinned.current = true
  }, [channel.id])

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
    if (composer.current) composer.current.style.height = 'auto'
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
        <IconHash />
        <span>{channel.name}</span>
      </header>

      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && (
          <p className="chat__empty">ninguem falou nada aqui ainda.</p>
        )}
        {messages.map((msg, i) => {
          const previous = messages[i - 1]
          const grouped =
            previous !== undefined &&
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
          ref={composer}
          className="chat__input"
          value={draft}
          rows={1}
          placeholder={canSend ? `falar em ${channel.name}` : 'sem conexao com o servidor'}
          disabled={!canSend}
          onChange={(e) => {
            setDraft(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </section>
  )
}
