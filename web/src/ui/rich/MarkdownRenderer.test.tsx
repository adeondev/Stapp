// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('renderiza formatacoes basicas (negrito, italico, tachado)', () => {
    render(<MarkdownRenderer content="**negrito** *italico* ~~tachado~~" />)
    expect(screen.getByText('negrito').tagName).toBe('STRONG')
    expect(screen.getByText('italico').tagName).toBe('EM')
    expect(screen.getByText('tachado').tagName).toBe('DEL')
  })

  it('configura links com target _blank e rel noopener noreferrer', () => {
    render(<MarkdownRenderer content="[Stapp](https://stapp.chat)" />)
    const link = screen.getByRole('link', { name: 'Stapp' })
    expect(link.getAttribute('href')).toBe('https://stapp.chat')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('sanitiza tags perigosas e scripts impedindo XSS', () => {
    const malicious = '<script>alert("xss")</script><img src="x" onerror="alert(1)" />[click](javascript:alert(1))'
    const { container } = render(<MarkdownRenderer content={malicious} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    const links = container.querySelectorAll('a')
    for (const link of links) {
      expect(link.getAttribute('href')).not.toMatch(/^javascript:/i)
    }
  })

  it('renderiza blocos de codigo e inline code', () => {
    render(
      <MarkdownRenderer
        content={`Aqui está \`inline code\` e um bloco:
\`\`\`rust
fn main() { println!("olá"); }
\`\`\``}
      />
    )
    const inline = screen.getByText('inline code')
    expect(inline.className).toContain('stapp-inline-code')
    expect(screen.getByText(/fn main/)).toBeTruthy()
    expect(screen.getByText('copiar')).toBeTruthy()
  })

  it('converte shortcodes como :sob: e :smile: em emoji unicode', () => {
    // O desenho e a fonte Twemoji que faz, entao aqui o que interessa e que o
    // shortcode virou o caractere — nao existe mais <img> por emoji.
    const { container } = render(<MarkdownRenderer content="chorando :sob: e sorrindo :smile:" />)
    expect(container.textContent).toBe('chorando 😭 e sorrindo 😄')
    expect(container.querySelectorAll('img').length).toBe(0)
  })

  it('marca a mensagem so de emoji como jumbo', () => {
    const { container } = render(<MarkdownRenderer content=":sob::smile:" />)
    expect(container.firstElementChild?.className).toContain('stapp-markdown-jumbo')
  })
})