import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconGif, IconMic, IconPlus, IconReaction, IconSend } from './Icons'
import './messageComposer.css'

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  value: string
  placeholder: string
  disabled: boolean
  hasContent: boolean
  uploading: boolean
  overLimit: boolean
  counter?: string
  recording: boolean
  sending: boolean
  canPoll: boolean
  surface?: ReactNode
  overlay?: ReactNode
  onChange(event: React.ChangeEvent<HTMLTextAreaElement>): void
  onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void
  onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void
  onFiles(files: FileList): void
  onSubmit(): void
  onRecord(): void
  onEmoji(): void
  onGif(): void
  onPoll(): void
}

/* Todos os botoes daqui eram caractere de texto: `+`, `☺`, `➤`, `●`. Cada um
   caia numa fonte diferente conforme o sistema, nenhum alinhava com o outro, e
   o `➤` chegava a virar quadrado em maquina sem a fonte certa. Agora sao SVG
   como o resto do app — mesmo traco, mesmo tamanho, mesma cor. */
export function MessageComposer(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const chooseFiles = () => {
    setMenuOpen(false)
    props.fileInputRef.current?.click()
  }
  const focusBack = () => window.setTimeout(() => props.textareaRef.current?.focus(), 0)

  return (
    <div className="message-composer" onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) {
        event.stopPropagation()
        setMenuOpen(false)
        focusBack()
      }
    }}>
      {props.surface}
      <input
        ref={props.fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) props.onFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <div className="message-composer__input" role="toolbar" aria-label="Ferramentas da mensagem">
        <div className="message-composer__plus-wrap" ref={menuRef}>
          <button type="button" className="message-composer__button is-plus" disabled={props.disabled}
            aria-label="Adicionar" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <IconPlus size={18} />
          </button>
          {menuOpen && (
            <div className="message-composer__menu" role="menu">
              <button type="button" role="menuitem" onClick={chooseFiles}>Enviar arquivo</button>
              {props.canPoll && <button type="button" role="menuitem"
                onClick={() => { setMenuOpen(false); props.onPoll(); focusBack() }}>Criar enquete</button>}
              <button type="button" className="is-mobile-action" role="menuitem"
                onClick={() => { setMenuOpen(false); props.onGif(); focusBack() }}>Escolher GIF</button>
            </div>
          )}
        </div>
        <textarea
          ref={props.textareaRef}
          className="message-composer__textarea"
          value={props.value}
          rows={1}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          aria-label="Mensagem"
        />
        <div className="message-composer__actions">
          <button type="button" className="message-composer__button is-secondary" disabled={props.disabled}
            onClick={props.onGif} aria-label="Escolher GIF"><IconGif size={22} /></button>
          <button type="button" className="message-composer__button" disabled={props.disabled}
            onClick={props.onEmoji} aria-label="Escolher emoji"><IconReaction size={22} /></button>
          {props.hasContent || props.uploading ? (
            <button type="button" className="message-composer__button is-send"
              disabled={props.disabled || props.sending || props.overLimit || (!props.hasContent && !props.uploading)}
              onClick={props.onSubmit}
              aria-label={props.sending ? 'Confirmando mensagem' : props.uploading ? 'Aguardar anexos e enviar' : 'Enviar mensagem'}>
              <IconSend size={17} />
            </button>
          ) : (
            <button type="button" className="message-composer__button" disabled={props.disabled || props.recording}
              onClick={props.onRecord} aria-label="Gravar mensagem de voz"><IconMic size={21} /></button>
          )}
        </div>
        {props.counter && <span className={`message-composer__counter ${props.overLimit ? 'is-over' : ''}`}>{props.counter}</span>}
        {props.overlay}
      </div>
    </div>
  )
}
