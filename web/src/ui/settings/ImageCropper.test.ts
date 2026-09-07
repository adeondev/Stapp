import { describe, expect, it } from 'vitest'
import { calcularRecorte, escalaBase, limitarDeslocamento, precisaDeEnquadramento } from './ImageCropper'

/* A geometria do enquadramento e a unica parte com aritmetica de verdade, e o
   que ela protege e concreto: o servidor corta pelo centro, entao um retrato de
   celular perdia o rosto. Aqui o cliente escolhe o retangulo — e ele nunca pode
   sair da imagem, senao o avatar salva uma faixa vazia. */

const MOLDURA_QUADRADA = { width: 320, height: 320 }
const RETRATO = { width: 1080, height: 1920 }
const PAISAGEM = { width: 1920, height: 1080 }

describe('escalaBase', () => {
  it('cobre a moldura inteira, sem sobrar vazio em nenhum eixo', () => {
    // No retrato quem manda e a largura: 320/1080.
    expect(escalaBase(RETRATO, MOLDURA_QUADRADA)).toBeCloseTo(320 / 1080)
    // Na paisagem quem manda e a altura.
    expect(escalaBase(PAISAGEM, MOLDURA_QUADRADA)).toBeCloseTo(320 / 1080)
  })

  it('não divide por zero enquanto a imagem ainda não carregou', () => {
    expect(escalaBase({ width: 0, height: 0 }, MOLDURA_QUADRADA)).toBe(1)
  })
})

describe('calcularRecorte', () => {
  it('centraliza o corte no zoom 1 sem deslocamento — o mesmo que o servidor faria', () => {
    const recorte = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 1, { x: 0, y: 0 })
    expect(recorte.sx).toBeCloseTo(0)
    expect(recorte.sw).toBeCloseTo(1080)
    expect(recorte.sh).toBeCloseTo(1080)
    // Num retrato 1080x1920 o quadrado central comeca em (1920-1080)/2.
    expect(recorte.sy).toBeCloseTo(420)
  })

  it('arrastar para baixo sobe o recorte — e o que traz o rosto para dentro', () => {
    const centro = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 1, { x: 0, y: 0 })
    const arrastado = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 1, { x: 0, y: 100 })
    expect(arrastado.sy).toBeLessThan(centro.sy)
    expect(arrastado.sw).toBeCloseTo(centro.sw)
  })

  it('aproximar encolhe a área capturada', () => {
    const um = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 1, { x: 0, y: 0 })
    const dois = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 2, { x: 0, y: 0 })
    expect(dois.sw).toBeCloseTo(um.sw / 2)
    expect(dois.sh).toBeCloseTo(um.sh / 2)
  })

  it('respeita a proporção pedida — 8:3 no banner', () => {
    const moldura = { width: 320, height: 120 }
    const recorte = calcularRecorte(PAISAGEM, moldura, 1, { x: 0, y: 0 })
    expect(recorte.sw / recorte.sh).toBeCloseTo(8 / 3)
  })
})

describe('limitarDeslocamento', () => {
  it('não deixa arrastar para fora: o recorte fica sempre dentro da imagem', () => {
    const preso = limitarDeslocamento(RETRATO, MOLDURA_QUADRADA, 1, { x: 0, y: 99_999 })
    const recorte = calcularRecorte(RETRATO, MOLDURA_QUADRADA, 1, preso)
    expect(recorte.sy).toBeGreaterThanOrEqual(-0.001)
    expect(recorte.sy + recorte.sh).toBeLessThanOrEqual(RETRATO.height + 0.001)
  })

  it('no eixo já justo o deslocamento é zero', () => {
    // No zoom 1 o retrato cobre a largura exatamente: nao ha para onde correr.
    expect(limitarDeslocamento(RETRATO, MOLDURA_QUADRADA, 1, { x: 500, y: 0 }).x).toBeCloseTo(0)
  })

  it('reduzir o zoom traz a imagem de volta para dentro', () => {
    const longe = limitarDeslocamento(RETRATO, MOLDURA_QUADRADA, 3, { x: 300, y: 0 })
    expect(longe.x).toBeGreaterThan(0)
    const devolta = limitarDeslocamento(RETRATO, MOLDURA_QUADRADA, 1, longe)
    expect(devolta.x).toBeCloseTo(0)
  })
})

describe('precisaDeEnquadramento', () => {
  it('deixa o GIF passar intacto — recortar mataria a animação', () => {
    expect(precisaDeEnquadramento(new File([], 'a.gif', { type: 'image/gif' }))).toBe(false)
  })

  it('enquadra o que é imagem parada', () => {
    expect(precisaDeEnquadramento(new File([], 'a.png', { type: 'image/png' }))).toBe(true)
    expect(precisaDeEnquadramento(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
  })
})
