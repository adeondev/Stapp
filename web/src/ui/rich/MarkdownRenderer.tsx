import React, { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
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
    <div className="relative my-2 rounded-[var(--radius)] bg-[var(--bg-canvas)] overflow-hidden group">
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--bg-raised)] text-[11px] text-[var(--text-dim)] select-none">
        <span>{className?.replace('language-', '') || 'código'}</span>
        <button
          type="button"
          onClick={copy}
          className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-input)] cursor-pointer"
        >
          {copied ? 'copiado!' : 'copiar'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto m-0 text-[13px] font-mono text-[var(--text)]">
        <code>{children}</code>
      </pre>
    </div>
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
    <div className={`stapp-markdown ${isJumbo ? 'stapp-markdown-jumbo' : ''} ${className}`}>
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
        }}
      >
        {parsedContent}
      </ReactMarkdown>
    </div>
  )
})