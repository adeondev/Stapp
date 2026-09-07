import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './Icons'
import './overlay.css'

/**
 * O dialogo do Stapp, em um lugar so.
 *
 * Antes existiam sete: `ProfileEditor`, `HelpModal`, `VoiceSettings`,
 * `ScreenSharePicker`, `PollCreatorModal`, `UpdateModal` e o lightbox de midia.
 * Cada um com o seu scrim (eram cinco valores diferentes), o seu z-index (de 20
 * a 2000, sem escala), e o mesmo `useEffect` de Escape copiado palavra por
 * palavra quatro vezes. Tres deles nem fechavam no Escape, um nao tinha ARIA
 * nenhuma, e **nenhum** prendia o foco.
 *
 * Tres coisas aqui nao sao detalhe:
 *
 * - **`aria-modal` fica no dialogo, nao no scrim.** Metade das copias colocava
 *   `role="dialog"` na `<div>` de fundo, que e justamente o pedaco que o leitor
 *   de tela nao deveria anunciar.
 * - **Fechar por clique de fundo escuta `mousedown`, nao `click`.** Com `click`,
 *   selecionar texto dentro do dialogo e soltar o botao do lado de fora fecha a
 *   janela e joga fora o que a pessoa escreveu — era o comportamento real do
 *   editor de perfil e do modal de ajuda.
 * - **O foco volta para quem abriu.** Sem isso, fechar com Escape jogava o foco
 *   no `<body>` e a navegacao por teclado recomecava do topo do app.
 *
 * Nao ha trava de rolagem porque o `body` do Stapp ja e `overflow: hidden`
 * (`theme.css`); quem rola sao os paineis internos, e nenhum deles fica atras
 * do scrim.
 */

/**
 * A pilha de dialogos abertos.
 *
 * Existe porque dialogo dentro de dialogo virou caso real (o enquadramento de
 * imagem abre por cima das configuracoes). Os dois escutam `keydown` na janela
 * em captura, e quem foi montado PRIMEIRO recebe o evento primeiro: Escape no
 * dialogo de cima fechava o de baixo, levando os dois junto, e o Tab ficava
 * preso na caixa errada. Aqui so o topo responde ao teclado.
 */
const abertos: symbol[] = []

/** Tudo que pode receber foco por teclado dentro do dialogo. */
const FOCAVEL = [
  'a[href]', 'button:not(:disabled)', 'input:not(:disabled)', 'select:not(:disabled)',
  'textarea:not(:disabled)', '[tabindex]:not([tabindex="-1"])', 'video[controls]',
].join(',')

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface ModalProps {
  open: boolean
  onClose(): void
  children: React.ReactNode
  /** Nome acessivel. Use `labelledBy` quando o titulo ja estiver na tela. */
  label?: string
  labelledBy?: string
  size?: ModalSize
  className?: string
  /** Classe extra no scrim, para quem precisa de outro alinhamento. */
  scrimClassName?: string
  /**
   * `false` trava o fechamento por Escape e por clique de fundo — o caso do
   * download obrigatorio de atualizacao, que nao pode ser dispensado no meio.
   */
  dismissible?: boolean
  /** O que recebe foco ao abrir. Sem isto, o primeiro elemento focavel. */
  initialFocus?: React.RefObject<HTMLElement | null>
}

export function Modal({
  open, onClose, children, label, labelledBy, size = 'md',
  className = '', scrimClassName = '', dismissible = true, initialFocus,
}: ModalProps) {
  const dialogo = useRef<HTMLDivElement>(null)
  const devolverFoco = useRef<HTMLElement | null>(null)
  const identidade = useRef(Symbol('overlay'))

  const fechar = useCallback(() => {
    if (dismissible) onClose()
  }, [dismissible, onClose])

  // Guarda quem tinha o foco ANTES de montar, e devolve na saida.
  useLayoutEffect(() => {
    if (!open) return
    devolverFoco.current = document.activeElement as HTMLElement | null
    const alvo = initialFocus?.current
      ?? dialogo.current?.querySelector<HTMLElement>(FOCAVEL)
      ?? dialogo.current
    alvo?.focus()
    return () => {
      // `isConnected` porque o gatilho pode ter saido da arvore junto (um item
      // de menu, por exemplo) — devolver foco para um no solto nao faz nada.
      const anterior = devolverFoco.current
      if (anterior?.isConnected) anterior.focus()
    }
  }, [open, initialFocus])

  useEffect(() => {
    if (!open) return
    const eu = identidade.current
    abertos.push(eu)
    const aoTeclar = (event: KeyboardEvent) => {
      // Nao sou o dialogo do topo: o teclado nao e meu.
      if (abertos[abertos.length - 1] !== eu) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        fechar()
        return
      }
      if (event.key !== 'Tab') return
      const caixa = dialogo.current
      if (!caixa) return
      const itens = [...caixa.querySelectorAll<HTMLElement>(FOCAVEL)]
        .filter((item) => item.offsetParent !== null || item === document.activeElement)
      if (itens.length === 0) {
        event.preventDefault()
        caixa.focus()
        return
      }
      const primeiro = itens[0]
      const ultimo = itens[itens.length - 1]
      const atual = document.activeElement
      if (event.shiftKey && (atual === primeiro || !caixa.contains(atual))) {
        event.preventDefault()
        ultimo.focus()
      } else if (!event.shiftKey && atual === ultimo) {
        event.preventDefault()
        primeiro.focus()
      }
    }
    window.addEventListener('keydown', aoTeclar, true)
    return () => {
      window.removeEventListener('keydown', aoTeclar, true)
      const posicao = abertos.indexOf(eu)
      if (posicao >= 0) abertos.splice(posicao, 1)
    }
  }, [open, fechar])

  if (!open) return null

  return createPortal(
    <div
      className={`overlay ${scrimClassName}`}
      // `mousedown` e nao `click`: ver o comentario no topo do arquivo.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) fechar()
      }}
    >
      <div
        ref={dialogo}
        className={`overlay__dialog overlay__dialog--${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Cabecalho padrao: sobretitulo opcional, titulo e o botao de fechar. Devolve o
 * `id` do titulo para quem monta o `Modal` passar em `labelledBy`.
 */
export function ModalHeader({ title, overline, onClose, titleId, actions }: {
  title: React.ReactNode
  overline?: React.ReactNode
  onClose?(): void
  titleId?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="overlay__head">
      <div className="overlay__head-copy">
        {overline && <span className="overlay__overline">{overline}</span>}
        <h2 className="overlay__title" id={titleId}>{title}</h2>
      </div>
      {actions}
      {onClose && (
        <button type="button" className="overlay__close" onClick={onClose} aria-label="Fechar">
          <IconX size={20} />
        </button>
      )}
    </header>
  )
}

export function ModalBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`overlay__body ${className}`}>{children}</div>
}

export function ModalFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <footer className={`overlay__foot ${className}`}>{children}</footer>
}

/** Gera um id estavel para amarrar `labelledBy` ao `<h2>` do cabecalho. */
export function useModalTitleId() {
  return useId()
}
