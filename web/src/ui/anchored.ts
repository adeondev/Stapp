import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Onde uma superficie flutuante cabe.
 *
 * O `PopupMenu` sabia posicionar por PONTO (onde o mouse clicou) e so grampeava
 * o resultado dentro da janela. Isso basta para menu de contexto, mas nao para
 * um cartao ancorado num avatar: grampear faz o cartao deslizar para cima do
 * proprio avatar em vez de virar para o outro lado.
 *
 * Aqui a superficie e posicionada em relacao a um RETANGULO, com tres regras:
 *
 * 1. tenta o lado pedido;
 * 2. se nao couber, **vira para o lado oposto** — nao encolhe nem sobrepoe;
 * 3. se nao couber em nenhum dos dois, fica no lado com mais espaco e so entao
 *    e grampeada na margem.
 *
 * O eixo transversal (o alinhamento) e sempre grampeado, porque virar ali nao
 * resolveria nada: um cartao alinhado pelo topo que nao cabe embaixo so precisa
 * subir alguns pixels.
 */

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export type Placement = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'

export interface PlaceOptions {
  anchor: AnchorRect
  surface: { width: number; height: number }
  viewport: { width: number; height: number }
  placement?: Placement
  align?: Align
  /** Distancia entre a ancora e a superficie. */
  gap?: number
  /** Respiro minimo ate a borda da janela. */
  margin?: number
}

export interface Placed {
  left: number
  top: number
  /** O lado que sobrou depois do flip. Util para desenhar seta/animar. */
  placement: Placement
}

const oposto: Record<Placement, Placement> = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
}

/** Puro de proposito: da para testar sem montar nada. */
export function placeSurface({
  anchor, surface, viewport, placement = 'bottom', align = 'center', gap = 8, margin = 8,
}: PlaceOptions): Placed {
  const espaco: Record<Placement, number> = {
    top: anchor.top,
    bottom: viewport.height - (anchor.top + anchor.height),
    left: anchor.left,
    right: viewport.width - (anchor.left + anchor.width),
  }
  const precisa = placement === 'top' || placement === 'bottom' ? surface.height : surface.width

  let escolhido = placement
  if (espaco[placement] < precisa + gap + margin) {
    const outro = oposto[placement]
    // So vira se o outro lado realmente resolve. Virar para um lado igualmente
    // apertado troca um problema por outro, e ainda faz o cartao pular de lugar.
    if (espaco[outro] >= precisa + gap + margin || espaco[outro] > espaco[placement]) {
      escolhido = outro
    }
  }

  const grampo = (valor: number, tamanho: number, limite: number) =>
    Math.max(margin, Math.min(valor, limite - tamanho - margin))

  if (escolhido === 'top' || escolhido === 'bottom') {
    const top = escolhido === 'top'
      ? anchor.top - surface.height - gap
      : anchor.top + anchor.height + gap
    const bruto = align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - surface.width
        : anchor.left + anchor.width / 2 - surface.width / 2
    return {
      left: grampo(bruto, surface.width, viewport.width),
      top: grampo(top, surface.height, viewport.height),
      placement: escolhido,
    }
  }

  const left = escolhido === 'left'
    ? anchor.left - surface.width - gap
    : anchor.left + anchor.width + gap
  const bruto = align === 'start'
    ? anchor.top
    : align === 'end'
      ? anchor.top + anchor.height - surface.height
      : anchor.top + anchor.height / 2 - surface.height / 2
  return {
    left: grampo(left, surface.width, viewport.width),
    top: grampo(bruto, surface.height, viewport.height),
    placement: escolhido,
  }
}

export interface UseAnchoredOptions {
  anchor: AnchorRect | null
  placement?: Placement
  align?: Align
  gap?: number
  margin?: number
}

/**
 * Mede a superficie depois de montada e devolve o `style` fixo para ela.
 *
 * A primeira renderizacao sai invisivel (`visibility: hidden`) em vez de sair no
 * lugar errado: medir exige estar no DOM, e sem isso o cartao aparece um quadro
 * no canto e pula para o lugar certo no seguinte.
 */
export function useAnchoredSurface<T extends HTMLElement>({
  anchor, placement = 'bottom', align = 'center', gap = 8, margin = 8,
}: UseAnchoredOptions) {
  const ref = useRef<T>(null)
  const [posicao, setPosicao] = useState<Placed | null>(null)

  useLayoutEffect(() => {
    const elemento = ref.current
    if (!elemento || !anchor) {
      setPosicao(null)
      return
    }
    const medir = () => {
      const caixa = elemento.getBoundingClientRect()
      setPosicao(placeSurface({
        anchor,
        surface: { width: caixa.width, height: caixa.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement, align, gap, margin,
      }))
    }
    medir()
    // Redimensionar muda o que cabe; o zoom do sistema entra por aqui tambem.
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [anchor, placement, align, gap, margin])

  const style: React.CSSProperties = posicao
    ? { position: 'fixed', left: posicao.left, top: posicao.top }
    : { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }

  return { ref, style, placement: posicao?.placement ?? placement }
}

/** O retangulo de um elemento, no formato que o posicionador espera. */
export function anchorFrom(element: Element): AnchorRect {
  const caixa = element.getBoundingClientRect()
  return { top: caixa.top, left: caixa.left, width: caixa.width, height: caixa.height }
}
