import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEntry } from '../protocol'
import { IconAt, IconHash, IconPhone } from './Icons'
import { MarkdownRenderer } from './rich/MarkdownRenderer'
import { EmojiPicker } from './rich/EmojiPicker'
import { LinkPreviewCard } from './rich/LinkPreviewCard'
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    if (!el) {
      setDraft((prev) => prev + emoji)
      return
    }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const nextDraft = draft.slice(0, start) + emoji + draft.slice(end)
    setDraft(nextDraft)
    setShowEmojiPicker(false)
    setTimeout(() => {
      el.focus()
      const cursor = start + emoji.length
      el.setSelectionRange(cursor, cursor)
    }, 0)
  }

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
              <MarkdownRenderer content={msg.text} className="chat__text" />
              {msg.preview && <LinkPreviewCard preview={msg.preview} />}
            </article>
          )
        })}
      </div>

      <div className="chat__composer relative">
        <textarea
          ref={textareaRef}
          className="chat__input pr-12"
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
        <div className="flex items-center gap-1.5 absolute right-4 bottom-3">
          <button
            type="button"
            className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
            disabled={!canSend}
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            title="Escolher emoji"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
        </div>
        <EmojiPicker
          isOpen={showEmojiPicker}
          onClose={() => setShowEmojiPicker(false)}
          onSelectEmoji={insertEmoji}
        />
      </div>
    </section>
  )
}