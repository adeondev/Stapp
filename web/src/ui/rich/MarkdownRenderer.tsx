import React, { memo, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { openExternalLink } from '../../platform/externalLink'
import { IconStar } from '../Icons'
import { GIF_FAVORITES_EVENT, isFavoriteGif, isGifMedia, toggleFavoriteGif } from './gifFavorites'
import { isOnlyEmojis, parseShortcodesToUnicode } from './twemoji'
import './markdown.css'

interface Props {
  content: string
  className?: string
  /**
   * Usernames que devem virar pilula quando aparecem como `@nome` no texto.
   *
   * O servidor **nao reescreve** o texto: ele guarda `@daniel` e diz em
   * `mentions` quais contas aquilo alcancou. Entao quem desenha a pilula e o
   * cliente, e ele precisa saber quais nomes existem — senao qualquer `@coisa`
   * viraria destaque.
   */
  mentionNames?: ReadonlySet<string>
}

// Configuração segura do schema de sanitização
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'className', 'loading', 'draggable'],
    code: ['className'],
    th: ['align'],
    td: ['align'],
  },
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const codeString = String(children).replace(/\n$/, '')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeString)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Falha silenciosa se clipboard indisponível
    }
  }

  return (
    <div className="stapp-code">
      <div className="stapp-code__head">
        <span>{className?.replace('language-', '') || 'código'}</span>
        <button type="button" className="stapp-code__copy" onClick={copy}>
          {copied ? 'copiado!' : 'copiar'}
        </button>
      </div>
      <pre className="stapp-code__body">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function MarkdownImage({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [favorited, setFavorited] = useState(() => (src ? isFavoriteGif(src) : false))

  useEffect(() => {
    if (!src) return
    const onUpdate = () => setFavorited(isFavoriteGif(src))
    window.addEventListener(GIF_FAVORITES_EVENT, onUpdate)
    window.addEventListener('storage', onUpdate)
    return () => {
      window.removeEventListener(GIF_FAVORITES_EVENT, onUpdate)
      window.removeEventListener('storage', onUpdate)
    }
  }, [src])

  const isGif = src ? isGifMedia(src, alt) : false

  if (!isGif || !src) {
    return <img src={src} alt={alt} loading="lazy" {...props} />
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const novo = toggleFavoriteGif(src)
    setFavorited(novo)
  }

  return (
    <span className="stapp-chat-gif-wrapper">
      <img src={src} alt={alt} loading="lazy" {...props} />
      <button
        type="button"
        className={`stapp-chat-gif-fav-btn ${favorited ? 'is-favorited' : ''}`}
        onClick={handleToggle}
        title={favorited ? 'Remover dos favoritos' : 'Favoritar GIF'}
        aria-label={favorited ? 'Remover dos favoritos' : 'Favoritar GIF'}
      >
        <IconStar size={16} filled={favorited} />
      </button>
    </span>
  )
}

/** Divide um texto em pedacos, virando `@nome` conhecido numa pilula. */
function comMencoes(texto: string, nomes: ReadonlySet<string>): React.ReactNode {
  const partes: React.ReactNode[] = []
  const regex = /@([a-zA-Z0-9_.-]+)/g
  let ultimo = 0
  let achado: RegExpExecArray | null

  while ((achado = regex.exec(texto)) !== null) {
    const nome = achado[1].toLowerCase()
    if (!nomes.has(nome)) continue
    if (achado.index > ultimo) partes.push(texto.slice(ultimo, achado.index))
    partes.push(
      <span key={`${achado.index}-${nome}`} className="stapp-mencao">
        @{achado[1]}
      </span>,
    )
    ultimo = regex.lastIndex
  }

  if (partes.length === 0) return texto
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return partes
}

/**
 * Aplica o destaque nos filhos que sao texto puro, deixando o resto intacto.
 *
 * O `react-markdown` nao expoe um override de no de texto, entao a saida e
 * mapear os `children` de cada elemento que carrega texto. E a mesma tecnica
 * que ja existia aqui para o Twemoji, agora usada nos elementos que importam em
 * vez de so no paragrafo.
 */
function mapear(children: React.ReactNode, nomes: ReadonlySet<string>): React.ReactNode {
  if (typeof children === 'string') return comMencoes(children, nomes)
  if (!Array.isArray(children)) return children
  return children.map((filho, i) =>
    typeof filho === 'string' ? (
      <React.Fragment key={i}>{comMencoes(filho, nomes)}</React.Fragment>
    ) : (
      filho
    ),
  )
}

const VAZIO: ReadonlySet<string> = new Set()

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '', mentionNames }: Props) {
  const parsedContent = parseShortcodesToUnicode(content)
  const nomes = mentionNames ?? VAZIO
  const isJumbo = isOnlyEmojis(parsedContent)

  return (
    <div className={`stapp-markdown ${isJumbo ? 'stapp-markdown-jumbo chat__emoji--jumbo' : ''} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (href) {
                    event.preventDefault()
                    void openExternalLink(href)
                  }
                }}
                {...props}
              >
                {children}
              </a>
            )
          },
          code({ className, children, ...props }) {
            const isInline = !String(children).includes('\n') && !className
            if (isInline) {
              return (
                <code className="stapp-inline-code" {...props}>
                  {children}
                </code>
              )
            }
            return (
              <CodeBlock className={className}>
                {children}
              </CodeBlock>
            )
          },
          pre({ children }) {
            return <>{children}</>
          },
          // `code` fica de fora de proposito: `@alguem` dentro de bloco de
          // codigo e codigo, nao mencao.
          p: ({ children }) => <p>{mapear(children, nomes)}</p>,
          li: ({ children }) => <li>{mapear(children, nomes)}</li>,
          strong: ({ children }) => <strong>{mapear(children, nomes)}</strong>,
          em: ({ children }) => <em>{mapear(children, nomes)}</em>,
          td: ({ children }) => <td>{mapear(children, nomes)}</td>,
          blockquote: ({ children }) => <blockquote>{mapear(children, nomes)}</blockquote>,
          img: ({ src, alt, ...props }) => <MarkdownImage src={src} alt={alt} {...props} />,
        }}
      >
        {parsedContent}
      </ReactMarkdown>
    </div>
  )
})