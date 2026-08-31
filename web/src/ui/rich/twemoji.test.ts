import { describe, expect, it } from 'vitest'
import { getTwemojiUrl, isOnlyEmojis, parseShortcodesToUnicode, toCodePoint } from './twemoji'

describe('twemoji parser utility', () => {
  it('converte emojis comuns para code points hexadecimais', () => {
    expect(toCodePoint('😀')).toBe('1f600')
    expect(toCodePoint('🚀')).toBe('1f680')
  })

  it('gera url do svg twemoji na CDN confiável', () => {
    const url = getTwemojiUrl('😀')
    expect(url).toBe('https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/1f600.svg')
  })

  it('identifica jumboji para mensagens contendo apenas de 1 a 3 emojis', () => {
    expect(isOnlyEmojis('😀')).toBe(true)
    expect(isOnlyEmojis('😀 🚀')).toBe(true)
    expect(isOnlyEmojis('😀 🚀 🔥')).toBe(true)
    // Mais de 3 ou com texto junto não deve ser jumboji
    expect(isOnlyEmojis('😀 🚀 🔥 🎉')).toBe(false)
    expect(isOnlyEmojis('olá 😀')).toBe(false)
    expect(isOnlyEmojis('')).toBe(false)
  })

  it('converte shortcodes para emojis unicode', () => {
    expect(parseShortcodesToUnicode('chorando :sob: e sorrindo :smile:')).toBe('chorando 😭 e sorrindo 😄')
  })
})