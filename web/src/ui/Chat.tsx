import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntry, DirectoryEntry, Limits, UserId } from '../protocol'
import { IconAt, IconEdit, IconHash, IconPhone, IconReaction, IconReply, IconTrash } from './Icons'
import { Avatar, ProfileName } from './Avatar'
import { MarkdownRenderer } from './rich/MarkdownRenderer'
import { EmojiPicker } from './rich/EmojiPicker'
import { LinkPreviewCard } from './rich/LinkPreviewCard'
import { MessageAttachments } from './rich/MessageAttachments'
import { deletePendingAttachment, updatePendingAttachment, uploadMediaFile } from '../net/mediaUpload'
import { AudioRecorder, type RecordedVoice } from './rich/AudioRecorder'
import { MessageComposer } from './MessageComposer'
import { GifPicker } from './rich/GifPicker'
import { PollCard } from './rich/PollCard'
import { PollCreatorModal } from './rich/PollCreatorModal'
import { MessageReactions } from './rich/MessageReactions'
import { ReplyQuote } from './rich/ReplyQuote'
import { MentionAutocomplete, consultaDeMencao } from './rich/MentionAutocomplete'
import { useUserMenu } from './UserMenu'
import './chat.css'
import './rich/mediaGallery.css'
import './rich/poll.css'

/**
 * Conta como o servidor conta.
 *
 * `String.length` conta unidades UTF-16, entao um emoji vale 2 e o contador da
 * tela discordaria do teto que o Rust aplica com `chars().count()`. Espalhar o
 * texto conta pontos de codigo, que e a mesma unidade.
 */
const contarCaracteres = (texto: string) => [...texto].length

/** So mostra o contador quando ja da para se preocupar. */
const LIMIAR_CONTADOR = 0.9

const formatarMB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`
const formatarTamanho = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** Mensagens seguidas da mesma pessoa dentro disso viram um bloco so. */
const GROUP_WINDOW_MS = 5 * 60 * 1000

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

interface Props {
  /** Nome no cabecalho: o canal ou a pessoa da conversa. */
  title: string
  kind: 'channel' | 'direct'
  scopeId: string
  messages: ChatEntry[]
  canSend: boolean
  disabledReason?: string
  serverUrl?: string
  accessToken?: string | null
  selfUserId?: UserId
  /** Tetos declarados pelo servidor no `welcome`. */
  limits: Limits
  /** Quem da para citar com `@`. Sai do `directory` do `welcome`. */
  mentionables: DirectoryEntry[]
  sendResults?: Record<string, { messageId?: string; error?: string }>
  typingUsers?: { userId: UserId; username: string; expiresAt: number }[]
  readReceiptId?: string
  channelReadReceipts?: Record<string, UserId[]>
  onSend(text: string, attachmentIds?: string[], replyTo?: string, clientNonce?: string): void
  onTyping?(active: boolean): void
  onRead?(messageId: string): void
  onEdit?(messageId: string, text: string): void
  onDelete?(messageId: string): void
  onReact?(messageId: string, emoji: string): void
  onVotePoll?(pollId: string, optionId: string): void
  onCreatePoll?(question: string, options: string[], allowMult: boolean): void
  onClosePoll?(pollId: string): void
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
  controller?: AbortController
  filename?: string
  description?: string
}

interface OptimisticSend {
  nonce: string
  text: string
  attachmentIds?: string[]
  replyTo?: string
  status: 'sending' | 'failed'
  error?: string
}

export function Chat({
  title,
  kind,
  scopeId,
  messages,
  canSend,
  disabledReason,
  serverUrl,
  accessToken,
  selfUserId,
  limits,
  mentionables,
  onSend,
  onEdit,
  onDelete,
  onReact,
  onVotePoll,
  onCreatePoll,
  onClosePoll,
  onCall,
  sendResults = {},
  typingUsers = [],
  readReceiptId,
  channelReadReceipts = {},
  onTyping,
  onRead,
}: Props) {
  const userMenu = useUserMenu()
  const [draft, setDraft] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showPollModal, setShowPollModal] = useState(false)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [voicePreview, setVoicePreview] = useState<RecordedVoice | null>(null)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const [voiceSending, setVoiceSending] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const handleRecordingComplete = useCallback((recording: RecordedVoice) => {
    setIsRecordingAudio(false)
    setVoicePreview(recording)
    setVoiceError(null)
  }, [])

  const handleCancelRecording = useCallback(() => {
    setIsRecordingAudio(false)
  }, [])
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [optimistic, setOptimistic] = useState<OptimisticSend[]>([])
  const [composerSend, setComposerSend] = useState<OptimisticSend | null>(null)
  const [voicePendingNonce, setVoicePendingNonce] = useState<string | null>(null)
  const [newWhileScrolled, setNewWhileScrolled] = useState(0)
  const [unreadAnchor, setUnreadAnchor] = useState<string | null>(null)
  const [readersOpen, setReadersOpen] = useState<string | null>(null)
  /** A mensagem que o rascunho esta respondendo. */
  const [respondendo, setRespondendo] = useState<ChatEntry | null>(null)
  /** Id da mensagem em edicao no lugar, e o texto que esta sendo editado. */
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null)
  /** Onde abrir o seletor de emoji de reacao. */
  const [reagindo, setReagindo] = useState<string | null>(null)
  /** O `@` que o cursor esta digitando agora. */
  const [consultaMencao, setConsultaMencao] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)
  /** Enter apertado com anexo ainda subindo: manda sozinho quando terminar. */
  const aguardandoUpload = useRef(false)
  const typingTimer = useRef<number>(0)
  const lastTypingSignal = useRef(0)
  const previousMessageCount = useRef(messages.length)
  const draftStorageKey = useMemo(() => `stapp.draft.v2.${kind}:${scopeId}`, [kind, scopeId])
  const outboxStorageKey = `${draftStorageKey}.outbox`

  // O servidor guarda `@daniel` como texto e diz em `mentions` quem foi citado.
  // A pilula e desenhada aqui, entao a tela precisa saber quais nomes existem.
  const nomesConhecidos = useMemo(
    () => new Set([...mentionables.map((m) => m.username.toLowerCase()), 'everyone']),
    [mentionables],
  )

  const caracteres = contarCaracteres(draft.trim())
  const passouDoTexto = caracteres > limits.max_text_chars
  const mostrarContador = caracteres >= limits.max_text_chars * LIMIAR_CONTADOR

  const subindoAnexo = pendingUploads.some((p) => !p.attachmentId && !p.error)
  const temConteudo =
    draft.trim().length > 0 || pendingUploads.some((p) => Boolean(p.attachmentId))

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

  /** Troca o `@parcial` sob o cursor pelo nome escolhido. */
  function inserirMencao(username: string) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? draft.length
    const antes = draft.slice(0, cursor)
    const arroba = antes.lastIndexOf('@')
    if (arroba === -1) return

    const novo = `${draft.slice(0, arroba)}@${username} ${draft.slice(cursor)}`
    setDraft(novo)
    setConsultaMencao(null)
    setTimeout(() => {
      el?.focus()
      const fim = arroba + username.length + 2
      el?.setSelectionRange(fim, fim)
    }, 0)
  }

  function aoMudarRascunho(evento: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(evento.target.value)
    setConsultaMencao(
      consultaDeMencao(evento.target.value, evento.target.selectionStart ?? 0),
    )
    const now = Date.now()
    if (evento.target.value.trim()) {
      if (now - lastTypingSignal.current >= 2_500) {
        onTyping?.(true)
        lastTypingSignal.current = now
      }
    } else {
      onTyping?.(false)
      lastTypingSignal.current = 0
    }
    window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => {
      onTyping?.(false)
      lastTypingSignal.current = 0
    }, 4_500)
  }

  function comecarEdicao(msg: ChatEntry) {
    setEditando({ id: msg.id, texto: msg.text })
    setRespondendo(null)
  }

  function salvarEdicao() {
    if (!editando) return
    const texto = editando.texto.trim()
    // Esvaziar o texto nao apaga: apagar e uma decisao explicita, e o servidor
    // recusa a edicao vazia de qualquer jeito.
    if (texto) onEdit?.(editando.id, texto)
    setEditando(null)
  }

  function aoTeclarNaEdicao(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      salvarEdicao()
    }
    if (evento.key === 'Escape') {
      evento.preventDefault()
      setEditando(null)
    }
  }

  /** Leva a conversa ate a mensagem citada e pisca nela. */
  function irPara(messageId: string) {
    const alvo = scroller.current?.querySelector(`[data-message-id="${messageId}"]`)
    if (!alvo) return
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' })
    alvo.classList.add('is-destacada')
    setTimeout(() => alvo.classList.remove('is-destacada'), 1200)
  }

  // Cresce junto com o texto, estilo Discord: sem isto a caixa ficava presa em
  // uma linha e a segunda linha sumia atras da barra. O `max-h` do CSS e quem
  // segura o crescimento; passando dele a propria caixa rola.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  // So acompanha o fim se o usuario ja estava no fim — se ele subiu para ler
  // algo antigo, mensagem nova nao arranca a tela dele.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, title])

  useEffect(() => {
    let savedDraft = ''
    let replyId: string | undefined
    let ready: { attachmentId: string; filename: string; contentType: string; description?: string }[] = []
    try {
      const raw = localStorage.getItem(draftStorageKey)
      if (raw) {
        const value = JSON.parse(raw) as { text?: string; replyId?: string; savedAt?: number; attachments?: typeof ready }
        if (Date.now() - (value.savedAt ?? 0) < 30 * 24 * 60 * 60 * 1000) {
          savedDraft = value.text ?? ''
          replyId = value.replyId
          ready = value.attachments ?? []
        } else localStorage.removeItem(draftStorageKey)
      }
      const rawOutbox = localStorage.getItem(outboxStorageKey)
      setOptimistic(rawOutbox ? JSON.parse(rawOutbox) as OptimisticSend[] : [])
    } catch {
      localStorage.removeItem(draftStorageKey)
      localStorage.removeItem(outboxStorageKey)
      setOptimistic([])
    }
    setComposerSend(null)
    setDraft(savedDraft)
    setPendingUploads(ready.map((item) => ({
      id: item.attachmentId,
      file: new File([], item.filename, { type: item.contentType }),
      previewUrl: '',
      progress: 100,
      attachmentId: item.attachmentId,
      filename: item.filename,
      description: item.description,
    })))
    setRespondendo(replyId ? messages.find((message) => message.id === replyId) ?? null : null)
    pinned.current = true
    aguardandoUpload.current = false
    setVoiceError(null)
    setEditando(null)
    setReagindo(null)
    setConsultaMencao(null)
    setNewWhileScrolled(0)
    setUnreadAnchor(null)
    previousMessageCount.current = messages.length
    return () => {
      window.clearTimeout(typingTimer.current)
      onTyping?.(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const attachments = pendingUploads
        .filter((item) => item.attachmentId)
        .map((item) => ({ attachmentId: item.attachmentId!, filename: item.filename ?? item.file.name, contentType: item.file.type, description: item.description }))
      if (!draft && !respondendo && attachments.length === 0) localStorage.removeItem(draftStorageKey)
      else localStorage.setItem(draftStorageKey, JSON.stringify({ text: draft, replyId: respondendo?.id, attachments, savedAt: Date.now() }))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft, draftStorageKey, pendingUploads, respondendo])

  useEffect(() => {
    if (optimistic.length) localStorage.setItem(outboxStorageKey, JSON.stringify(optimistic))
    else localStorage.removeItem(outboxStorageKey)
  }, [optimistic, outboxStorageKey])

  useEffect(() => {
    setOptimistic((current) => current.flatMap((item) => {
      const result = sendResults[item.nonce]
      if (!result) return [item]
      if (result.messageId) return []
      return [{ ...item, status: 'failed' as const, error: result.error ?? 'Falha no envio' }]
    }))
    if (voicePendingNonce && sendResults[voicePendingNonce]?.messageId) {
      setVoicePreview(null)
      setVoicePendingNonce(null)
    }
    if (composerSend) {
      const result = sendResults[composerSend.nonce]
      if (result?.messageId) {
        setDraft((current) => current.trim() === composerSend.text ? '' : current)
        setRespondendo((current) => current?.id === composerSend.replyTo ? null : current)
        setPendingUploads((current) => current.filter((item) => {
          const sent = Boolean(item.attachmentId && composerSend.attachmentIds?.includes(item.attachmentId))
          if (sent && item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          return !sent
        }))
        setComposerSend(null)
      } else if (result?.error) {
        setComposerSend(null)
      }
    }
  }, [composerSend, sendResults, voicePendingNonce])

  useEffect(() => {
    const next = voicePreview ? URL.createObjectURL(voicePreview.file) : null
    setVoicePreviewUrl(next)
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [voicePreview])

  useEffect(() => {
    if (messages.length > previousMessageCount.current && !pinned.current) {
      const added = messages.length - previousMessageCount.current
      setNewWhileScrolled((count) => count + added)
      setUnreadAnchor((current) => current ?? messages[previousMessageCount.current]?.id ?? null)
    }
    previousMessageCount.current = messages.length
  }, [messages])

  function markVisibleRead() {
    if (!pinned.current || document.visibilityState !== 'visible' || !document.hasFocus()) return
    const last = messages.at(-1)
    if (last) onRead?.(last.id)
  }

  useEffect(() => {
    markVisibleRead()
    const onVisible = () => markVisibleRead()
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, onRead])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (pinned.current) {
      setNewWhileScrolled(0)
      setUnreadAnchor(null)
      markVisibleRead()
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (!serverUrl || !accessToken || !canSend) return
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    const available = Math.max(0, (limits.max_attachments_per_message ?? 10) - pendingUploads.length)
    const queue = fileArray.slice(0, available)

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift()!
        const tempId = Math.random().toString(36).substring(2, 9)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
        const controller = new AbortController()
        const item: PendingUpload = { id: tempId, file, previewUrl, progress: 0, controller, filename: file.name, description: '' }

        if (file.size > limits.max_upload_bytes) {
          setPendingUploads((prev) => [...prev, { ...item, error: `passa do limite de ${formatarMB(limits.max_upload_bytes)}` }])
          continue
        }
        setPendingUploads((prev) => [...prev, item])
        try {
          const attachmentId = await uploadMediaFile(
            serverUrl,
            accessToken,
            file,
            { kind, id: scopeId },
            (progress) => setPendingUploads((prev) => prev.map((entry) => entry.id === tempId ? { ...entry, progress } : entry)),
            controller.signal,
          )
          setPendingUploads((prev) => prev.map((entry) => entry.id === tempId ? { ...entry, attachmentId, progress: 100, error: undefined } : entry))
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') continue
          setPendingUploads((prev) => prev.map((entry) => entry.id === tempId ? { ...entry, error: error instanceof Error ? error.message : 'Falha no envio' } : entry))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()))
  }

  function removeUpload(id: string) {
    setPendingUploads((prev) => {
      const item = prev.find((p) => p.id === id)
      item?.controller?.abort()
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      if (item?.attachmentId && serverUrl && accessToken) void deletePendingAttachment(serverUrl, accessToken, item.attachmentId)
      return prev.filter((p) => p.id !== id)
    })
  }

  async function retryUpload(id: string) {
    const item = pendingUploads.find((entry) => entry.id === id)
    if (!item || !serverUrl || !accessToken || item.file.size === 0) return
    const controller = new AbortController()
    setPendingUploads((prev) => prev.map((entry) => entry.id === id ? { ...entry, error: undefined, progress: 0, controller } : entry))
    try {
      const attachmentId = await uploadMediaFile(serverUrl, accessToken, item.file, { kind, id: scopeId }, (progress) => {
        setPendingUploads((prev) => prev.map((entry) => entry.id === id ? { ...entry, progress } : entry))
      }, controller.signal)
      setPendingUploads((prev) => prev.map((entry) => entry.id === id ? { ...entry, attachmentId, progress: 100 } : entry))
    } catch (error) {
      setPendingUploads((prev) => prev.map((entry) => entry.id === id ? { ...entry, error: error instanceof Error ? error.message : 'Falha no envio' } : entry))
    }
  }

  function moveUpload(id: string, direction: -1 | 1) {
    setPendingUploads((current) => {
      const index = current.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function saveUploadMetadata(id: string) {
    const item = pendingUploads.find((entry) => entry.id === id)
    if (!item?.attachmentId || !serverUrl || !accessToken) return
    try {
      await updatePendingAttachment(serverUrl, accessToken, item.attachmentId, {
        filename: item.filename?.trim() || item.file.name,
        description: item.description?.trim() ?? '',
      })
    } catch (error) {
      setPendingUploads((current) => current.map((entry) => entry.id === id ? {
        ...entry,
        error: error instanceof Error ? error.message : 'Falha ao salvar detalhes',
      } : entry))
    }
  }

  /** Manda o que ja esta pronto. Texto vazio com anexo pronto e envio valido. */
  function despachar() {
    const text = draft.trim()
    const readyAttachments = pendingUploads
      .map((p) => p.attachmentId)
      .filter((id): id is string => Boolean(id))

    if ((!text && readyAttachments.length === 0) || !canSend || composerSend) return
    if (contarCaracteres(text) > limits.max_text_chars) return

    const nonce = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    const pending: OptimisticSend = {
      nonce,
      text,
      attachmentIds: readyAttachments.length > 0 ? readyAttachments : undefined,
      replyTo: respondendo?.id,
      status: 'sending',
    }
    setOptimistic((current) => [...current, pending])
    setComposerSend(pending)
    onSend(
      text,
      readyAttachments.length > 0 ? readyAttachments : undefined,
      respondendo?.id,
      nonce,
    )
  }

  function submit() {
    if (!canSend || passouDoTexto || composerSend) return
    // Anexo ainda subindo: antes disso o id nao existia na hora do envio e o
    // anexo era descartado calado — a mensagem saia so com texto, ou nem saia
    // quando nao havia texto. Agora a intencao fica guardada.
    if (subindoAnexo) {
      aguardandoUpload.current = true
      return
    }
    despachar()
  }

  // Todos os uploads terminaram (com sucesso ou erro) e o envio estava esperando.
  useEffect(() => {
    if (!aguardandoUpload.current || subindoAnexo) return
    aguardandoUpload.current = false
    despachar()
    // despachar() e recriada a cada render; depender do estado que ela le basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subindoAnexo, pendingUploads, draft])

  /**
   * Nota de voz vai sozinha, estilo WhatsApp: sobe e ja e mensagem propria.
   * Nao entra em `pendingUploads` de proposito — gravacao nao e anexo que a
   * pessoa escolhe acompanhar de um texto.
   */
  async function enviarNotaDeVoz() {
    const recording = voicePreview
    if (!recording) return
    if (!serverUrl || !accessToken || !canSend) return
    setVoiceSending(true)
    setVoiceError(null)
    try {
      const attachmentId = await uploadMediaFile(
        serverUrl,
        accessToken,
        recording.file,
        { kind, id: scopeId },
      )
      await updatePendingAttachment(serverUrl, accessToken, attachmentId, {
        duration_ms: recording.durationMs,
        waveform: recording.waveform,
      })
      const nonce = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      setVoicePendingNonce(nonce)
      setOptimistic((current) => [...current, { nonce, text: '', attachmentIds: [attachmentId], status: 'sending' }])
      setVoicePreview(null)
      onSend('', [attachmentId], undefined, nonce)
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Falha ao enviar o áudio')
    } finally {
      setVoiceSending(false)
    }
  }

  function retrySend(item: OptimisticSend) {
    setOptimistic((current) => current.map((entry) => entry.nonce === item.nonce ? { ...entry, status: 'sending', error: undefined } : entry))
    setComposerSend({ ...item, status: 'sending', error: undefined })
    onSend(item.text, item.attachmentIds, item.replyTo, item.nonce)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      setRespondendo(null)
      setShowEmojiPicker(false)
      setShowGifPicker(false)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
          <p className="chat__empty">
            {kind === 'direct'
              ? 'início da conversa direta.'
              : 'nenhuma mensagem ainda. envie a primeira.'}
          </p>
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

          const souEu = selfUserId !== undefined && msg.author_id === selfUserId
          const emEdicao = editando?.id === msg.id
          const mencionaVoce =
            (selfUserId !== undefined && msg.mentions?.includes(selfUserId)) ||
            Boolean(msg.mentions_everyone)
          const previousDay = previous ? new Date(previous.ts).toDateString() : null
          const currentDay = new Date(msg.ts).toDateString()
          const readers = channelReadReceipts[msg.id] ?? []

          return (
            <Fragment key={msg.id}>
            {previousDay !== currentDay && (
              <div className="chat__date-separator"><span>{new Date(msg.ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
            )}
            {unreadAnchor === msg.id && <div className="chat__unread-divider"><span>Novas mensagens</span></div>}
            <article
              data-message-id={msg.id}
              className={`chat__msg ${grouped ? 'is-grouped' : ''} ${
                mencionaVoce ? 'is-mencao' : ''
              }`}
              onContextMenu={(event) => userMenu.open(event, {
                userId: msg.author_id,
                name: msg.author_username,
              })}
            >
              {/* A calha guarda o avatar da primeira mensagem do bloco. Nas
                  seguidas ela fica vazia e so revela a hora no hover, para o
                  texto de todas continuar alinhado na mesma coluna. */}
              <div className="chat__gutter">
                {grouped ? (
                  <span className="chat__hovertime">{time(msg.ts)}</span>
                ) : (
                  <Avatar
                    userId={msg.author_id}
                    className="chat__avatar"
                    fallbackName={msg.author_username}
                  />
                )}
              </div>

              <div className="chat__body">
                {msg.reply_to && <ReplyQuote reply={msg.reply_to} onGoTo={irPara} />}

                {!grouped && (
                  <div className="chat__meta">
                    {/* `author_username` e registro historico de quem escreveu;
                        o que aparece na tela sai do perfil vivo. */}
                    <span className="chat__nick">
                      <ProfileName userId={msg.author_id} fallbackName={msg.author_username} />
                    </span>
                    <span className="chat__time">{time(msg.ts)}</span>
                  </div>
                )}

                {emEdicao ? (
                  <div className="chat__editor">
                    <textarea
                      className="chat__editor-input"
                      value={editando.texto}
                      autoFocus
                      onChange={(e) => setEditando({ id: msg.id, texto: e.target.value })}
                      onKeyDown={aoTeclarNaEdicao}
                    />
                    <span className="chat__editor-dica">
                      enter salva · esc cancela
                    </span>
                  </div>
                ) : (
                  <>
                    <MarkdownRenderer
                      content={msg.text}
                      className="chat__text"
                      mentionNames={nomesConhecidos}
                    />
                    {msg.edited_at && <span className="chat__editada">(editado)</span>}
                  </>
                )}

                {msg.preview && <LinkPreviewCard preview={msg.preview} />}
                {msg.attachments && (
                  <MessageAttachments attachments={msg.attachments} serverUrl={serverUrl} accessToken={accessToken} />
                )}
                {msg.poll && (
                  <PollCard
                    poll={msg.poll}
                    selfUserId={selfUserId}
                    onVote={(pollId, optionId) => onVotePoll?.(pollId, optionId)}
                    onClosePoll={(pollId) => onClosePoll?.(pollId)}
                  />
                )}
                {msg.reactions && (
                  <MessageReactions
                    reactions={msg.reactions}
                    selfUserId={selfUserId}
                    onToggle={(emoji) => onReact?.(msg.id, emoji)}
                  />
                )}
                {kind === 'direct' && souEu && readReceiptId === msg.id && <span className="chat__seen">Visto</span>}
                {kind === 'channel' && readers.length > 0 && (
                  <button
                    type="button"
                    className="chat__readers"
                    title={`Lido por ${readers.length}`}
                    aria-expanded={readersOpen === msg.id}
                    onClick={() => setReadersOpen((current) => current === msg.id ? null : msg.id)}
                  >
                    {readers.slice(0, 3).map((userId) => <Avatar key={userId} userId={userId} className="chat__reader-avatar" fallbackName="" />)}
                    {readers.length > 3 && <span>+{readers.length - 3}</span>}
                    {readersOpen === msg.id && (
                      <span className="chat__reader-list" role="status">
                        <strong>Lido por</strong>
                        {readers.map((userId) => <span key={userId}><Avatar userId={userId} fallbackName="" /><ProfileName userId={userId} fallbackName="Usuario" /></span>)}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {canSend && !emEdicao && (
                <div className="chat__acoes">
                  <button
                    type="button"
                    className="chat__acao"
                    title="Reagir"
                    onClick={() => setReagindo(msg.id)}
                  >
                    <IconReaction size={15} />
                  </button>
                  <button
                    type="button"
                    className="chat__acao"
                    title="Responder"
                    onClick={() => setRespondendo(msg)}
                  >
                    <IconReply size={15} />
                  </button>
                  {souEu && (
                    <>
                      <button
                        type="button"
                        className="chat__acao"
                        title="Editar"
                        onClick={() => comecarEdicao(msg)}
                      >
                        <IconEdit size={15} />
                      </button>
                      <button
                        type="button"
                        className="chat__acao chat__acao--perigo"
                        title="Excluir"
                        onClick={() => onDelete?.(msg.id)}
                      >
                        <IconTrash size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}

              <EmojiPicker
                isOpen={reagindo === msg.id}
                onClose={() => setReagindo(null)}
                onSelectEmoji={(emoji) => {
                  setReagindo(null)
                  onReact?.(msg.id, emoji)
                }}
              />
            </article>
            </Fragment>
          )
        })}
        {optimistic.map((item) => (
          <article key={item.nonce} className={`chat__msg chat__msg--optimistic ${item.status === 'failed' ? 'is-failed' : ''}`}>
            <div className="chat__gutter"><Avatar userId={selfUserId ?? ''} className="chat__avatar" fallbackName="Voce" /></div>
            <div className="chat__body">
              {item.text && <div className="chat__text">{item.text}</div>}
              <div className="chat__delivery" role={item.status === 'failed' ? 'alert' : 'status'}>
                {item.status === 'failed' ? item.error ?? 'Falha no envio' : 'Enviando...'}
                {item.status === 'failed' && <button type="button" onClick={() => retrySend(item)}>Tentar novamente</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {newWhileScrolled > 0 && (
        <button type="button" className="chat__jump-present" onClick={() => {
          const element = scroller.current
          if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
          pinned.current = true
          setNewWhileScrolled(0)
          setUnreadAnchor(null)
        }}>Voltar ao presente · {newWhileScrolled}</button>
      )}

      <div className="chat__composer">
        {isRecordingAudio && (
          <AudioRecorder
            onRecordingComplete={handleRecordingComplete}
            onCancel={handleCancelRecording}
          />
        )}
        {voicePreview && voicePreviewUrl && (
          <div className="chat__voice-preview">
            <audio src={voicePreviewUrl} controls preload="metadata" />
            <div className="chat__voice-waveform" aria-hidden="true">
              {voicePreview.waveform.map((value, index) => <i key={index} style={{ height: `${Math.max(5, value)}%` }} />)}
            </div>
            <div className="chat__voice-preview-actions">
              <button type="button" onClick={() => { setVoicePreview(null); setVoiceError(null) }}>Apagar</button>
              <button type="button" onClick={() => { setVoicePreview(null); setIsRecordingAudio(true) }}>Regravar</button>
              <button type="button" className="is-primary" disabled={voiceSending} onClick={() => void enviarNotaDeVoz()}>{voiceSending ? 'Enviando...' : 'Enviar'}</button>
            </div>
            {voiceError && <span className="chat__voice-error" role="alert">{voiceError}</span>}
          </div>
        )}
        {respondendo && (
          <div className="chat__respondendo">
            <IconReply size={13} />
            <span className="chat__respondendo-alvo">
              respondendo a{' '}
              <strong>
                <ProfileName
                  userId={respondendo.author_id}
                  fallbackName={respondendo.author_username}
                />
              </strong>
            </span>
            <button
              type="button"
              className="chat__respondendo-fechar"
              onClick={() => setRespondendo(null)}
              title="Cancelar resposta"
            >
              ✕
            </button>
          </div>
        )}
        {(voiceSending && !voicePreview) && (
          <div className="stapp-voice-status" role="status">
            <span className={voiceError ? 'stapp-voice-status__erro' : ''}>
              {voiceError ?? 'Enviando mensagem de voz...'}
            </span>
            {voiceError && (
              <button
                type="button"
                className="stapp-voice-status__fechar"
                onClick={() => setVoiceError(null)}
                title="Fechar aviso"
              >
                ✕
              </button>
            )}
          </div>
        )}
        {pendingUploads.length > 0 && (
          <div className="stapp-media-preview-bar">
            {pendingUploads.map((item) => (
              <div
                key={item.id}
                className={`stapp-media-preview-item ${item.error ? 'is-erro' : ''}`}
                title={item.error ?? item.file.name}
              >
                <div className="stapp-media-preview-visual">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="stapp-media-preview-thumb" />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-dim)]">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>
                <div className="stapp-media-preview-details">
                  <input
                    aria-label="Nome do anexo"
                    value={item.filename ?? item.file.name}
                    maxLength={255}
                    onChange={(event) => setPendingUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, filename: event.target.value } : entry))}
                    onBlur={() => void saveUploadMetadata(item.id)}
                  />
                  <span>{item.error ?? `${formatarTamanho(item.file.size)} · ${item.attachmentId ? 'Pronto' : `${item.progress}%`}`}</span>
                  {item.file.type.startsWith('image/') && (
                    <input
                      aria-label="Texto alternativo"
                      placeholder="Texto alternativo"
                      value={item.description ?? ''}
                      maxLength={1024}
                      onChange={(event) => setPendingUploads((current) => current.map((entry) => entry.id === item.id ? { ...entry, description: event.target.value } : entry))}
                      onBlur={() => void saveUploadMetadata(item.id)}
                    />
                  )}
                </div>
                <div className="stapp-media-preview-order" aria-label="Reordenar anexo">
                  <button type="button" onClick={() => moveUpload(item.id, -1)} aria-label="Mover anexo para esquerda">‹</button>
                  <button type="button" onClick={() => moveUpload(item.id, 1)} aria-label="Mover anexo para direita">›</button>
                </div>
                {item.error ? (
                  <button type="button" className="stapp-media-preview-erro" onClick={() => void retryUpload(item.id)} title="Tentar novamente">!</button>
                ) : (
                  item.progress < 100 && (
                    <div
                      className="stapp-media-preview-progress"
                      style={{ width: `${item.progress}%` }}
                    />
                  )
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
        <MessageComposer
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          value={draft}
          placeholder={canSend ? (kind === 'direct' ? `falar com ${title}` : `falar em ${title}`) : disabledReason ?? 'sem conexao com o servidor'}
          disabled={!canSend}
          hasContent={temConteudo}
          uploading={subindoAnexo}
          overLimit={passouDoTexto}
          counter={mostrarContador ? `${caracteres}/${limits.max_text_chars}` : undefined}
          recording={isRecordingAudio}
          sending={Boolean(composerSend)}
          canPoll={kind === 'channel'}
          onChange={aoMudarRascunho}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFiles={(files) => void handleFiles(files)}
          onSubmit={submit}
          onRecord={() => setIsRecordingAudio(true)}
          onEmoji={() => setShowEmojiPicker((open) => !open)}
          onGif={() => setShowGifPicker((open) => !open)}
          onPoll={() => setShowPollModal(true)}
          overlay={<MentionAutocomplete consulta={consultaMencao} candidatos={mentionables} onEscolher={inserirMencao} onFechar={() => setConsultaMencao(null)} />}
        />
        <EmojiPicker isOpen={showEmojiPicker} onClose={() => setShowEmojiPicker(false)} onSelectEmoji={insertEmoji} />
        <GifPicker isOpen={showGifPicker} onClose={() => setShowGifPicker(false)} onSelectGif={(gifUrl) => {
          setShowGifPicker(false)
          const replyTo = respondendo?.id
          setRespondendo(null)
          onSend(`![GIF](${gifUrl})`, undefined, replyTo)
        }} />
        <PollCreatorModal isOpen={showPollModal} onClose={() => setShowPollModal(false)} onCreatePoll={(question, options, allowMult) => onCreatePoll?.(question, options, allowMult)} />
        {typingUsers.filter((entry) => entry.expiresAt > Date.now()).length > 0 && (
          <div className="chat__typing" role="status"><span>•••</span> {typingUsers.filter((entry) => entry.expiresAt > Date.now()).map((entry) => entry.username).join(', ')} esta digitando</div>
        )}
      </div>
    </section>
  )
}
