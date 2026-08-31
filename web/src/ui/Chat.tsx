import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEntry } from '../protocol'
import { IconAt, IconHash, IconPhone } from './Icons'
import { MarkdownRenderer } from './rich/MarkdownRenderer'
import { EmojiPicker } from './rich/EmojiPicker'
import { LinkPreviewCard } from './rich/LinkPreviewCard'
import { MessageAttachments } from './rich/MessageAttachments'
import { uploadMediaFile } from '../net/mediaUpload'
import './chat.css'
import './rich/mediaGallery.css'

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
  serverUrl?: string
  accessToken?: string | null
  onSend(text: string, attachmentIds?: string[]): void
  /** So existe em conversa direta: o botao de ligar. */
  onCall?: () => void
}

interface PendingUpload {
  id: string
  file: File
  previewUrl: string
  progress: number
  attachmentId?: string
  error?: string
}

export function Chat({
  title,
  kind,
  messages,
  canSend,
  disabledReason,
  serverUrl,
  accessToken,
  onSend,
  onCall,
}: Props) {
  const [draft, setDraft] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  async function handleFiles(files: FileList | File[]) {
    if (!serverUrl || !accessToken || !canSend) return
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    for (const file of fileArray) {
      const tempId = Math.random().toString(36).substring(2, 9)
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''

      const item: PendingUpload = {
        id: tempId,
        file,
        previewUrl,
        progress: 0,
      }

      setPendingUploads((prev) => [...prev, item])

      try {
        const attachmentId = await uploadMediaFile(
          serverUrl,
          accessToken,
          file,
          (progress) => {
            setPendingUploads((prev) =>
              prev.map((p) => (p.id === tempId ? { ...p, progress } : p))
            )
          }
        )

        setPendingUploads((prev) =>
          prev.map((p) => (p.id === tempId ? { ...p, attachmentId, progress: 100 } : p))
        )
      } catch (err) {
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.id === tempId
              ? { ...p, error: err instanceof Error ? err.message : 'Falha no envio' }
              : p
          )
        )
      }
    }
  }

  function removeUpload(id: string) {
    setPendingUploads((prev) => {
      const item = prev.find((p) => p.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  function submit() {
    const text = draft.trim()
    const readyAttachments = pendingUploads
      .map((p) => p.attachmentId)
      .filter((id): id is string => Boolean(id))

    if ((!text && readyAttachments.length === 0) || !canSend) return

    onSend(text, readyAttachments.length > 0 ? readyAttachments : undefined)
    setDraft('')
    setPendingUploads([])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault()
      void handleFiles(e.clipboardData.files)
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (canSend) setIsDragging(true)
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (canSend && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <section
      className="chat relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="stapp-drag-overlay">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-sm font-semibold text-[var(--accent)]">Solte os arquivos para enviar</span>
        </div>
      )}
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
              {msg.attachments && <MessageAttachments attachments={msg.attachments} />}
            </article>
          )
        })}
      </div>

      <div className="chat__composer relative">
        {pendingUploads.length > 0 && (
          <div className="stapp-media-preview-bar">
            {pendingUploads.map((item) => (
              <div key={item.id} className="stapp-media-preview-item">
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="stapp-media-preview-thumb" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-dim)]">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                {item.progress < 100 && (
                  <div
                    className="stapp-media-preview-progress"
                    style={{ width: `${item.progress}%` }}
                  />
                )}
                <button
                  type="button"
                  className="stapp-media-preview-remove"
                  onClick={() => removeUpload(item.id)}
                  title="Remover anexo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <textarea
          ref={textareaRef}
          className="chat__input pr-20"
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
          onPaste={onPaste}
        />
        <div className="flex items-center gap-1.5 absolute right-4 bottom-3">
          <button
            type="button"
            className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
            disabled={!canSend}
            onClick={() => fileInputRef.current?.click()}
            title="Anexar arquivo ou imagem"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
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