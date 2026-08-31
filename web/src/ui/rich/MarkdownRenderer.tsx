import React, { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { EMOJI_REGEX, getTwemojiUrl, isOnlyEmojis } from './twemoji'
import './markdown.css'

interface Props {
  content: string
  className?: string
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

/**
 * Converte sequências de texto que contenham emojis em imagens Twemoji SVG.
 */
function renderWithTwemoji(text: string, jumbo: boolean): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  // Regex global com reset de lastIndex
  const regex = new RegExp(EMOJI_REGEX.source, 'gu')
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    const emoji = match[0]
    const url = getTwemojiUrl(emoji)
    parts.push(
      <img
        key={`${match.index}-${emoji}`}
        src={url}
        alt={emoji}
        draggable={false}
        className={jumbo ? 'stapp-emoji-jumbo inline-block' : 'stapp-emoji inline-block'}
      />
    )
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '' }: Props) {
  const isJumbo = isOnlyEmojis(content)

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
          p({ children }) {
            if (typeof children === 'string') {
              return <p>{renderWithTwemoji(children, isJumbo)}</p>
            }
            if (Array.isArray(children)) {
              return (
                <p>
                  {children.map((child, i) =>
                    typeof child === 'string' ? (
                      <React.Fragment key={i}>{renderWithTwemoji(child, isJumbo)}</React.Fragment>
                    ) : (
                      child
                    )
                  )}
                </p>
              )
            }
            return <p>{children}</p>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})