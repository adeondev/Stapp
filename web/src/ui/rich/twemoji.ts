// Parser utilitário de Twemoji para renderização homogênea de emojis em SVG

const TWEMOJI_BASE_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/'

// Regex moderno utilizando Unicode property escapes para cobertura precisa de emojis
const EMOJI_REGEX = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu

/**
 * Converte uma sequência de caracteres de emoji em sua representação hex code point para o Twemoji.
 */
export function toCodePoint(unicodeSurrogates: string): string {
  const points: string[] = []
  let charCode = 0
  let previous = 0

  for (let i = 0; i < unicodeSurrogates.length; i++) {
    charCode = unicodeSurrogates.charCodeAt(i)
    if (previous) {
      points.push((0x10000 + ((previous - 0xd800) << 10) + (charCode - 0xdc00)).toString(16))
      previous = 0
    } else if (charCode >= 0xd800 && charCode <= 0xdbff) {
      previous = charCode
    } else {
      points.push(charCode.toString(16))
    }
  }

  // Filtrar variation selector fe0f para padrões onde o SVG do Twemoji não o inclui no nome do arquivo
  return points.filter((p) => p !== 'fe0f' && p !== 'fe0e').join('-')
}

/**
 * Retorna a URL completa do SVG Twemoji para um dado emoji.
 */
export function getTwemojiUrl(emoji: string): string {
  const codePoint = toCodePoint(emoji)
  return `${TWEMOJI_BASE_URL}${codePoint}.svg`
}

/**
 * Identifica se uma mensagem é composta exclusivamente por 1 a 3 emojis (estilo jumboji).
 */
export function isOnlyEmojis(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const matches = trimmed.match(EMOJI_REGEX)
  if (!matches) return false
  const stripped = trimmed.replace(EMOJI_REGEX, '').replace(/\s+/g, '')
  return stripped.length === 0 && matches.length >= 1 && matches.length <= 3
}

export { EMOJI_REGEX }