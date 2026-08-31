import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntry, DirectoryEntry, Limits, UserId } from '../protocol'
import { IconAt, IconEdit, IconHash, IconPhone, IconReaction, IconReply, IconTrash } from './Icons'
import { Avatar, ProfileName } from './Avatar'
import { MarkdownRenderer } from './rich/MarkdownRenderer'
import { EmojiPicker } from './rich/EmojiPicker'
import { LinkPreviewCard } from './rich/LinkPreviewCard'
import { MessageAttachments } from './rich/MessageAttachments'
import { uploadMediaFile } from '../net/mediaUpload'
import { AudioRecorder } from './rich/AudioRecorder'
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
  selfUserId?: UserId
  /** Tetos declarados pelo servidor no `welcome`. */
  limits: Limits
  /** Quem da para citar com `@`. Sai do `directory` do `welcome`. */
  mentionables: DirectoryEntry[]
  onSend(text: string, attachmentIds?: string[], replyTo?: string): void
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
}

export function Chat({
  title,
  kind,
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
}: Props) {
  const userMenu = useUserMenu()
  const [draft, setDraft] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showPollModal, setShowPollModal] = useState(false)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [isSendingVoice, setIsSendingVoice] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
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
    setDraft('')
    pinned.current = true
    aguardandoUpload.current = false
    setVoiceError(null)
    setRespondendo(null)
    setEditando(null)
    setReagindo(null)
    setConsultaMencao(null)
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

      // O servidor recusa no presign de qualquer jeito; barrar aqui poupa o
      // upload inteiro e diz o motivo na hora, em vez de depois da subida.
      if (file.size > limits.max_upload_bytes) {
        setPendingUploads((prev) => [
          ...prev,
          { ...item, error: `passa do limite de ${formatarMB(limits.max_upload_bytes)}` },
        ])
        continue
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

  /** Manda o que ja esta pronto. Texto vazio com anexo pronto e envio valido. */
  function despachar() {
    const text = draft.trim()
    const readyAttachments = pendingUploads
      .map((p) => p.attachmentId)
      .filter((id): id is string => Boolean(id))

    if ((!text && readyAttachments.length === 0) || !canSend) return
    if (contarCaracteres(text) > limits.max_text_chars) return

    onSend(
      text,
      readyAttachments.length > 0 ? readyAttachments : undefined,
      respondendo?.id,
    )
    setDraft('')
    setRespondendo(null)
    setPendingUploads((prev) => {
      prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
      return []
    })
  }

  function submit() {
    if (!canSend || passouDoTexto) return
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
  async function enviarNotaDeVoz(file: File) {
    if (!serverUrl || !accessToken || !canSend) return
    setIsSendingVoice(true)
    setVoiceError(null)
    try {
      const attachmentId = await uploadMediaFile(serverUrl, accessToken, file)
      onSend('', [attachmentId])
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Falha ao enviar o áudio')
    } finally {
      setIsSendingVoice(false)
    }
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

          return (
            <article
              key={msg.id}
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
                  <MessageAttachments attachments={msg.attachments} serverUrl={serverUrl} />
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
          )
        })}
      </div>

      <div className="chat__composer">
        {isRecordingAudio && (
          <AudioRecorder
            onRecordingComplete={(file) => {
              setIsRecordingAudio(false)
              void enviarNotaDeVoz(file)
            }}
            onCancel={() => setIsRecordingAudio(false)}
          />
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
        {(isSendingVoice || voiceError) && (
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
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="stapp-media-preview-thumb" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-dim)]">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                {item.error ? (
                  <span className="stapp-media-preview-erro">!</span>
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

        {/* Discord-style integrated input container */}
        <div className="relative flex items-end bg-[var(--bg-input)] rounded-lg px-3 py-2 gap-2">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent border-0 outline-none resize-none overflow-y-auto text-sm text-[var(--text)] placeholder-[var(--text-faint)] max-h-36 min-h-[24px] py-1 m-0 leading-relaxed"
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
            onChange={aoMudarRascunho}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="flex items-center gap-1 shrink-0 pb-0.5">
            <button
              type="button"
              className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1.5 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
              disabled={!canSend || isRecordingAudio}
              onClick={() => setIsRecordingAudio(true)}
              title="Gravar mensagem de voz"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
            <button
              type="button"
              className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1.5 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
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
              className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors px-1.5 py-1 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40 font-bold text-[11px] tracking-wide"
              disabled={!canSend}
              onClick={() => setShowGifPicker((prev) => !prev)}
              title="Escolher GIF (Klipy)"
            >
              GIF
            </button>
            <button
              type="button"
              className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1.5 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
              disabled={!canSend || kind !== 'channel'}
              onClick={() => setShowPollModal(true)}
              title="Criar enquete (somente em canais)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M7 16h3v-4H7v4z" />
                <path d="M12 16h3v-9h-3v9z" />
                <path d="M17 16h3v-6h-3v6z" />
              </svg>
            </button>
            <button
              type="button"
              className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-1.5 rounded-[var(--radius-sm)] flex items-center justify-center cursor-pointer disabled:opacity-40"
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
            <button
              type="button"
              className="stapp-composer-send"
              disabled={!canSend || passouDoTexto || (!temConteudo && !subindoAnexo)}
              onClick={submit}
              title={
                passouDoTexto
                  ? `passa do limite de ${limits.max_text_chars} caracteres`
                  : subindoAnexo
                    ? 'Enviando anexo...'
                    : 'Enviar mensagem'
              }
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <MentionAutocomplete
            consulta={consultaMencao}
            candidatos={mentionables}
            onEscolher={inserirMencao}
            onFechar={() => setConsultaMencao(null)}
          />
          {mostrarContador && (
            <span className={`chat__contador ${passouDoTexto ? 'is-estourado' : ''}`}>
              {caracteres}/{limits.max_text_chars}
            </span>
          )}
          <EmojiPicker
            isOpen={showEmojiPicker}
            onClose={() => setShowEmojiPicker(false)}
            onSelectEmoji={insertEmoji}
          />
          <GifPicker
            isOpen={showGifPicker}
            onClose={() => setShowGifPicker(false)}
            onSelectGif={(gifUrl) => {
              setShowGifPicker(false)
              onSend(`![GIF](${gifUrl})`)
            }}
          />
          <PollCreatorModal
            isOpen={showPollModal}
            onClose={() => setShowPollModal(false)}
            onCreatePoll={(question, options, allowMult) => {
              onCreatePoll?.(question, options, allowMult)
            }}
          />
        </div>
      </div>
    </section>
  )
}
