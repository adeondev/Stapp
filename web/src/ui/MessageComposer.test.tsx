// @vitest-environment jsdom

import { createRef, type ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MessageComposer } from './MessageComposer'

function renderComposer(overrides: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  const textareaRef = createRef<HTMLTextAreaElement>()
  const fileInputRef = createRef<HTMLInputElement>()
  const props: ComponentProps<typeof MessageComposer> = {
    textareaRef,
    fileInputRef,
    value: '',
    placeholder: 'falar em geral',
    disabled: false,
    hasContent: false,
    uploading: false,
    overLimit: false,
    recording: false,
    sending: false,
    canPoll: true,
    onChange: vi.fn(),
    onKeyDown: vi.fn(),
    onPaste: vi.fn(),
    onFiles: vi.fn(),
    onSubmit: vi.fn(),
    onRecord: vi.fn(),
    onEmoji: vi.fn(),
    onGif: vi.fn(),
    onPoll: vi.fn(),
    ...overrides,
  }
  return { ...render(<MessageComposer {...props} />), props, textareaRef }
}

describe('MessageComposer', () => {
  it('alterna o menu + sem reabrir e devolve o foco com Escape', async () => {
    const user = userEvent.setup()
    const { textareaRef } = renderComposer()
    const plus = screen.getByRole('button', { name: 'Adicionar' })

    await user.click(plus)
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.click(plus)
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(plus)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(textareaRef.current)
  })

  /* O bug era 4px de desalinhamento entre o `+` da esquerda e os icones da
     direita, porque cada lado tinha altura e hitbox diferentes numa linha
     `align-items: flex-end`. jsdom nao faz layout, entao o que da para travar e
     a invariante que produz o alinhamento: os dois lados sao o mesmo `__slot` e
     todo botao da barra usa a mesma caixa do `IconButton`. */
  it('mantem a barra numa caixa so: mesmos slots e mesma hitbox nos dois lados', () => {
    const { container } = renderComposer({ value: 'oi', hasContent: true })

    const slots = container.querySelectorAll('.message-composer__slot')
    expect(slots).toHaveLength(2)

    const botoes = [...container.querySelectorAll('.message-composer__input button')]
      .filter((node) => node.classList.contains('icon-button'))
    expect(botoes.length).toBeGreaterThanOrEqual(4)
    for (const botao of botoes) {
      expect(botao.classList.contains('icon-button--md')).toBe(true)
    }
  })

  it('mostra microfone vazio, enviar com conteudo e bloqueia durante confirmacao', () => {
    const first = renderComposer()
    expect(screen.getByRole('button', { name: 'Gravar mensagem de voz' })).toBeTruthy()
    first.unmount()

    renderComposer({ value: 'oi', hasContent: true, sending: true })
    const send = screen.getByRole('button', { name: 'Confirmando mensagem' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Gravar mensagem de voz' })).toBeNull()
  })
})
