import { describe, expect, it } from 'vitest'
import { calculateCallGridLayout } from './callGridLayout'

describe('calculateCallGridLayout', () => {
  it('lida com contagem ou dimensões inválidas graciosamente', () => {
    expect(calculateCallGridLayout(0, 1000, 800)).toEqual({
      columns: 1,
      rows: 1,
      tileWidth: 0,
      tileHeight: 0,
    })
    expect(calculateCallGridLayout(5, 0, 800)).toEqual({
      columns: 1,
      rows: 1,
      tileWidth: 0,
      tileHeight: 0,
    })
    expect(calculateCallGridLayout(5, 1000, -10)).toEqual({
      columns: 1,
      rows: 1,
      tileWidth: 0,
      tileHeight: 0,
    })
  })

  it('calcula 1 participante preenchendo o espaço disponível sem exceder', () => {
    const layout = calculateCallGridLayout(1, 1280, 720)
    expect(layout.columns).toBe(1)
    expect(layout.rows).toBe(1)
    expect(layout.tileWidth).toBe(1280)
    expect(layout.tileHeight).toBe(720)
  })

  it('calcula 2 participantes em tela widescreen lado a lado ou empilhado maximizando área', () => {
    const layout = calculateCallGridLayout(2, 1920, 1080)
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(2)
    expect(layout.columns).toBe(2)
    expect(layout.rows).toBe(1)
    expect(layout.columns * layout.tileWidth + (layout.columns - 1) * 12).toBeLessThanOrEqual(1920)
    expect(layout.rows * layout.tileHeight + (layout.rows - 1) * 12).toBeLessThanOrEqual(1080)
  })

  it('calcula 3 participantes sem transbordo', () => {
    const layout = calculateCallGridLayout(3, 1200, 800)
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(3)
    expect(layout.columns * layout.tileWidth + (layout.columns - 1) * 12).toBeLessThanOrEqual(1200)
    expect(layout.rows * layout.tileHeight + (layout.rows - 1) * 12).toBeLessThanOrEqual(800)
  })

  it('calcula 5 participantes sem transbordo', () => {
    const layout = calculateCallGridLayout(5, 1200, 800)
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(5)
    expect(layout.columns * layout.tileWidth + (layout.columns - 1) * 12).toBeLessThanOrEqual(1200)
    expect(layout.rows * layout.tileHeight + (layout.rows - 1) * 12).toBeLessThanOrEqual(800)
  })

  it('calcula 7 participantes garantindo que todos caibam sem transbordo (evita o bug 3x2)', () => {
    // 1200x800 com 7 participantes: a grade antiga 3x2 comportava apenas 6 tiles!
    const layout = calculateCallGridLayout(7, 1200, 800)
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(7)
    // Para 1200x800, deve escolher 3x3 ou 4x2 se couber, nunca 3x2!
    expect(layout.columns * layout.rows).not.toBe(6)
    expect(layout.columns * layout.tileWidth + (layout.columns - 1) * 12).toBeLessThanOrEqual(1200)
    expect(layout.rows * layout.tileHeight + (layout.rows - 1) * 12).toBeLessThanOrEqual(800)
  })

  it('calcula 9 e 13 participantes suportando qualquer quantidade de pessoas', () => {
    const layout9 = calculateCallGridLayout(9, 1400, 900)
    expect(layout9.columns * layout9.rows).toBeGreaterThanOrEqual(9)
    expect(layout9.columns * layout9.tileWidth + (layout9.columns - 1) * 12).toBeLessThanOrEqual(1400)
    expect(layout9.rows * layout9.tileHeight + (layout9.rows - 1) * 12).toBeLessThanOrEqual(900)

    const layout13 = calculateCallGridLayout(13, 1600, 1000)
    expect(layout13.columns * layout13.rows).toBeGreaterThanOrEqual(13)
    expect(layout13.columns * layout13.tileWidth + (layout13.columns - 1) * 12).toBeLessThanOrEqual(1600)
    expect(layout13.rows * layout13.tileHeight + (layout13.rows - 1) * 12).toBeLessThanOrEqual(1000)
  })

  it('adapta-se perfeitamente para orientação retrato (ex: painel estreito ou smartphone)', () => {
    const layoutPortrait = calculateCallGridLayout(4, 400, 800)
    expect(layoutPortrait.columns * layoutPortrait.rows).toBeGreaterThanOrEqual(4)
    expect(layoutPortrait.rows).toBeGreaterThanOrEqual(layoutPortrait.columns)
    expect(layoutPortrait.columns * layoutPortrait.tileWidth + (layoutPortrait.columns - 1) * 12).toBeLessThanOrEqual(400)
    expect(layoutPortrait.rows * layoutPortrait.tileHeight + (layoutPortrait.rows - 1) * 12).toBeLessThanOrEqual(800)
  })
})
