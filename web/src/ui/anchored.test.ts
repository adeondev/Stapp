import { describe, expect, it } from 'vitest'
import { placeSurface } from './anchored'

const janela = { width: 1280, height: 720 }
const cartao = { width: 320, height: 400 }

describe('placeSurface', () => {
  it('usa o lado pedido quando cabe', () => {
    const r = placeSurface({
      anchor: { top: 100, left: 400, width: 40, height: 40 },
      surface: cartao, viewport: janela, placement: 'bottom',
    })
    expect(r.placement).toBe('bottom')
    expect(r.top).toBe(148) // 100 + 40 + gap 8
    expect(r.left).toBe(260) // centralizado: 400 + 40/2 - 320/2
  })

  /* Este e o caso que o clamp do PopupMenu nao resolvia: perto do rodape ele
     empurrava o cartao para cima ATE COBRIR o proprio avatar. Virar de lado e o
     que mantem a ancora visivel. */
  it('vira para cima quando nao cabe embaixo', () => {
    const r = placeSurface({
      anchor: { top: 640, left: 400, width: 40, height: 40 },
      surface: cartao, viewport: janela, placement: 'bottom',
    })
    expect(r.placement).toBe('top')
    expect(r.top).toBe(232) // 640 - 400 - 8
  })

  it('vira para a esquerda quando nao cabe a direita', () => {
    const r = placeSurface({
      anchor: { top: 200, left: 1100, width: 40, height: 40 },
      surface: cartao, viewport: janela, placement: 'right',
    })
    expect(r.placement).toBe('left')
    expect(r.left).toBe(772) // 1100 - 320 - 8
  })

  it('em janela apertada fica no lado com mais espaco e so entao grampeia', () => {
    // 300px de altura nao cabe 400 em lugar nenhum. Sobra mais espaco embaixo.
    const r = placeSurface({
      anchor: { top: 40, left: 100, width: 40, height: 40 },
      surface: cartao, viewport: { width: 1280, height: 300 }, placement: 'top',
    })
    expect(r.placement).toBe('bottom')
    // Grampeado na margem, nunca fora da janela.
    expect(r.top).toBeGreaterThanOrEqual(8)
    expect(r.top + cartao.height).toBeGreaterThan(300)
  })

  it('nunca sai da viewport no eixo transversal', () => {
    const encostado = placeSurface({
      anchor: { top: 100, left: 4, width: 24, height: 24 },
      surface: cartao, viewport: janela, placement: 'bottom',
    })
    expect(encostado.left).toBe(8)

    const direita = placeSurface({
      anchor: { top: 100, left: 1270, width: 24, height: 24 },
      surface: cartao, viewport: janela, placement: 'bottom',
    })
    expect(direita.left).toBe(janela.width - cartao.width - 8)
  })

  it('respeita alinhamento por inicio e por fim', () => {
    const inicio = placeSurface({
      anchor: { top: 100, left: 500, width: 200, height: 40 },
      surface: cartao, viewport: janela, placement: 'bottom', align: 'start',
    })
    expect(inicio.left).toBe(500)

    const fim = placeSurface({
      anchor: { top: 100, left: 500, width: 200, height: 40 },
      surface: cartao, viewport: janela, placement: 'bottom', align: 'end',
    })
    expect(fim.left).toBe(380) // 500 + 200 - 320
  })

  /* 1366x768 e a resolucao pequena que o app precisa aguentar; um cartao alto
     ancorado no meio da lista de membros e o pior caso real. */
  it('cabe em 1366x768 com o cartao ancorado no meio da coluna de membros', () => {
    const r = placeSurface({
      anchor: { top: 420, left: 1300, width: 32, height: 32 },
      surface: { width: 340, height: 420 },
      viewport: { width: 1366, height: 768 },
      placement: 'left',
      align: 'center',
    })
    expect(r.left).toBeGreaterThanOrEqual(8)
    expect(r.left + 340).toBeLessThanOrEqual(1366 - 8)
    expect(r.top).toBeGreaterThanOrEqual(8)
    expect(r.top + 420).toBeLessThanOrEqual(768 - 8)
  })
})
