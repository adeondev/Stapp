// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GifPicker } from './GifPicker'
import * as klipy from '../../net/klipy'

describe('GifPicker', () => {
  it('não renderiza se isOpen for falso', () => {
    const { container } = render(
      <GifPicker isOpen={false} onClose={vi.fn()} onSelectGif={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('busca trending ao abrir e permite selecionar GIF', async () => {
    vi.spyOn(klipy, 'fetchTrendingGifs').mockResolvedValueOnce([
      {
        id: 'gif-1',
        title: 'Cachorrinho animado',
        type: 'gif',
        files: {
          original: { url: 'https://api.klipy.com/gif-1.gif' },
          preview: { url: 'https://api.klipy.com/preview-1.gif' },
        },
      },
    ])

    const onSelect = vi.fn()
    render(<GifPicker isOpen={true} onClose={vi.fn()} onSelectGif={onSelect} />)

    const img = await screen.findByAltText('Cachorrinho animado')
    expect(img).toBeTruthy()

    fireEvent.click(img)
    expect(onSelect).toHaveBeenCalledWith('https://api.klipy.com/gif-1.gif')
  })
})