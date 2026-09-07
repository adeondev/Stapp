import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconGif, IconMic, IconPlus, IconReaction, IconSend } from './Icons'
import { IconButton } from './IconButton'
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

/* Todos os botoes daqui ja foram caractere de texto: `+`, `☺`, `➤`, `●`. Cada um
   caia numa fonte diferente conforme o sistema, nenhum alinhava com o outro, e
   o `➤` chegava a virar quadrado em maquina sem a fonte certa. Viraram SVG — e
   continuaram desalinhados, por outro motivo.

   ## O desalinhamento vertical, e por que ele nao se resolve com offset

   A linha e `align-items: flex-end`, entao o que se alinha e o RODAPE de cada
   filho. O `+` tinha 24px de altura dentro de um `<div>` com `padding-bottom: 6px`
   — centro optico a 18px do fundo. Os icones da direita tinham 32px de altura
   dentro de outro `<div>` com o mesmo `padding-bottom: 6px` — centro a 22px.
   Quatro pixels de diferenca, constantes em qualquer altura do campo; e por
   serem constantes davam vontade de resolver com `translateY(-4px)`.

   A correcao e estrutural: os dois lados sao `__slot`, ambos com a ALTURA de uma
   linha de texto (44px) e `align-items: center`. Como o rodape dos dois encosta
   no rodape da linha e os dois tem a mesma altura, o centro cai no mesmo lugar —
   que e exatamente a linha media do texto (`padding: 11px` + `line-height: 22px`
   / 2 = 22px). Nenhum numero magico, e continua valendo quando o campo cresce.

   A hitbox tambem passou a ser uma so (32x32, do `IconButton`); antes eram 24x24
   de um lado e 34x32 do outro, com glifos de 17, 18, 21 e 22. */
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
  const podeEnviar = props.hasContent || props.uploading

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
      {/* Sem `role="toolbar"` aqui: a linha contem o campo de texto, e uma
          toolbar com `<textarea>` dentro nao e uma toolbar para o leitor de tela. */}
      <div className="message-composer__input">
        <div className="message-composer__slot" ref={menuRef}>
          <IconButton
            className="message-composer__plus"
            label="Adicionar"
            icon={<IconPlus size={20} />}
            disabled={props.disabled}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          />
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

        <div className="message-composer__slot message-composer__slot--actions">
          <IconButton
            className="is-secondary"
            label="Escolher GIF"
            icon={<IconGif size={20} />}
            disabled={props.disabled}
            onClick={props.onGif}
          />
          <IconButton
            label="Escolher emoji"
            icon={<IconReaction size={20} />}
            disabled={props.disabled}
            onClick={props.onEmoji}
          />
          {podeEnviar ? (
            <IconButton
              tone="accent"
              label={props.sending
                ? 'Confirmando mensagem'
                : props.uploading ? 'Aguardar anexos e enviar' : 'Enviar mensagem'}
              icon={<IconSend size={20} />}
              disabled={props.disabled || props.sending || props.overLimit}
              onClick={props.onSubmit}
            />
          ) : (
            <IconButton
              label="Gravar mensagem de voz"
              icon={<IconMic size={20} />}
              disabled={props.disabled || props.recording}
              onClick={props.onRecord}
            />
          )}
        </div>

        {props.counter && <span className={`message-composer__counter ${props.overLimit ? 'is-over' : ''}`}>{props.counter}</span>}
        {props.overlay}
      </div>
    </div>
  )
}
