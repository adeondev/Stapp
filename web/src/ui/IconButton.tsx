import { forwardRef } from 'react'
import { IconSpinner } from './Icons'
import './iconbutton.css'

/**
 * O botao que so tem icone dentro — barra da mensagem, dock da chamada, player,
 * visualizador de midia, cabecalho de dialogo.
 *
 * Ele existe por causa de um bug concreto: na barra de escrever, o `+` da
 * esquerda media 24x24 dentro de um `<div>` com `padding-bottom: 6px`, e os tres
 * icones da direita mediam 32 de altura dentro de outro `<div>` com o mesmo
 * `padding-bottom: 6px`. Como a linha e `align-items: flex-end`, o centro optico
 * de um ficava a 18px do fundo e o do outro a 22px — **4px de desalinhamento**,
 * constante em qualquer altura do campo de texto. A correcao nao e um
 * `translateY(-4px)`: e todo mundo usar a mesma caixa.
 *
 * Por isso a hitbox e do botao, nao do desenho. O glifo pode ter 16, 18 ou 20;
 * a area clicavel continua sendo a mesma em toda a barra, e todos os botoes de
 * uma barra se alinham porque tem a mesma altura.
 */

export type IconButtonSize = 'sm' | 'md' | 'lg'

/**
 * - `neutral` — o padrao: tinta discreta que clareia no hover.
 * - `accent` — a acao principal daquela barra (enviar).
 * - `active` — ligado/selecionado. Anda junto com o icone `filled`.
 * - `capturing` — **esta capturando agora** (camera, tela). Vermelho porque a
 *   acao e "parar", nao porque seja um erro. Ver `CallStage`.
 * - `danger` — destrutivo/encerrar. Fundo solido.
 */
export type IconButtonTone = 'neutral' | 'accent' | 'active' | 'capturing' | 'danger'

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  /** Obrigatorio: vira `aria-label` e `title`. Sem rotulo o botao e mudo. */
  label: string
  icon: React.ReactNode
  size?: IconButtonSize
  tone?: IconButtonTone
  /** Botao de alternancia: vira `aria-pressed`. */
  pressed?: boolean
  /** Troca o icone por um giro e bloqueia o clique, sem mudar o tamanho. */
  busy?: boolean
  /** `false` esconde o `title` nativo — para quem ja tem tooltip proprio. */
  showTitle?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', tone = 'neutral', pressed, busy = false,
    showTitle = true, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={`icon-button icon-button--${size} icon-button--${tone} ${busy ? 'is-busy' : ''} ${className}`}
      aria-label={label}
      title={showTitle ? label : undefined}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
    >
      {busy ? <IconSpinner size={16} className="icon-button__spinner" /> : icon}
    </button>
  )
})

/**
 * A fileira em que os botoes vivem. E ela que garante o alinhamento: uma linha
 * so, `align-items: center`, sem `padding` vertical assimetrico em ninguem.
 */
export function IconButtonRow({ children, className = '', label }: {
  children: React.ReactNode
  className?: string
  /** Quando a fileira e uma barra de ferramentas de verdade. */
  label?: string
}) {
  return (
    <div
      className={`icon-button-row ${className}`}
      role={label ? 'toolbar' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  )
}
