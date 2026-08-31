// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmojiPicker } from './EmojiPicker'

describe('EmojiPicker', () => {
  it('não renderiza nada quando isOpen é false', () => {
    const { container } = render(
      <EmojiPicker isOpen={false} onClose={vi.fn()} onSelectEmoji={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('fecha ao pressionar a tecla Escape', () => {
    const onClose = vi.fn()
    render(<EmojiPicker isOpen={true} onClose={onClose} onSelectEmoji={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})