// Shortcode e "jumboji" — o desenho do emoji em si e a fonte Twemoji que
// resolve, carregada em `ui/theme.css`.
//
// Antes este arquivo trocava cada emoji por um <img> do CDN da jsDelivr. Isso
// so funcionava dentro do override de <p> do markdown: emoji em apelido, lista,
// tabela, enquete e caixa de escrever continuava com a fonte do sistema, e cada
// aparelho desenhava o seu. Com a fonte, o desenho e o mesmo em toda a
// interface, sem JS e sem servico terceiro.

import emojiShortcodes from './emojiShortcodes.json'

// Regex moderno utilizando Unicode property escapes para cobertura precisa de emojis
const EMOJI_REGEX =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu

const SHORTCODE_MAP: Record<string, string> = emojiShortcodes as Record<string, string>
const SHORTCODE_REGEX = /:([a-zA-Z0-9_+]+):/g

/**
 * Converte shortcodes no formato :sob:, :smile:, :+1: para seus respectivos
 * caracteres Unicode.
 *
 * Continua no cliente porque o servidor guarda o que a pessoa escreveu, e
 * `:smile:` e texto valido — quem digitou pode ter querido as duas coisas.
 */
export function parseShortcodesToUnicode(text: string): string {
  if (!text.includes(':')) return text
  return text.replace(SHORTCODE_REGEX, (match, code) => {
    const lower = code.toLowerCase()
    return SHORTCODE_MAP[lower] ?? match
  })
}

/**
 * Identifica se uma mensagem e composta exclusivamente por 1 a 3 emojis
 * (estilo jumboji). Com a fonte no lugar do <img>, "aumentar o emoji" virou
 * so `font-size`.
 */
export function isOnlyEmojis(text: string): boolean {
  const parsed = parseShortcodesToUnicode(text).trim()
  if (!parsed) return false
  const matches = parsed.match(EMOJI_REGEX)
  if (!matches) return false
  const stripped = parsed.replace(EMOJI_REGEX, '').replace(/\s+/g, '')
  return stripped.length === 0 && matches.length >= 1 && matches.length <= 3
}

export { EMOJI_REGEX, SHORTCODE_REGEX, SHORTCODE_MAP }
