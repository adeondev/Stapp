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

  it('exibe empty-state elegante na aba de favoritos quando vazia', () => {
    localStorage.removeItem('stapp_gif_favorites')
    render(<GifPicker isOpen={true} onClose={vi.fn()} onSelectGif={vi.fn()} />)

    const tabFavoritos = screen.getByRole('tab', { name: /Favoritos/i })
    fireEvent.click(tabFavoritos)

    expect(screen.getByText('Nenhum GIF favorito ainda')).toBeTruthy()
    expect(screen.getByText(/Passe o mouse sobre qualquer GIF/i)).toBeTruthy()
  })

  it('lista GIFs salvos na aba favoritos, permite envio e remoção', () => {
    localStorage.setItem(
      'stapp_gif_favorites',
      JSON.stringify(['https://media.klipy.com/fav-1.gif', 'https://media.klipy.com/fav-2.gif'])
    )

    const onSelect = vi.fn()
    render(<GifPicker isOpen={true} onClose={vi.fn()} onSelectGif={onSelect} />)

    const tabFavoritos = screen.getByRole('tab', { name: /Favoritos/i })
    fireEvent.click(tabFavoritos)

    const favBtns = screen.getAllByLabelText('Enviar GIF favorito')
    expect(favBtns.length).toBe(2)

    fireEvent.click(favBtns[0])
    expect(onSelect).toHaveBeenCalledWith('https://media.klipy.com/fav-1.gif')

    const removeBtns = screen.getAllByLabelText('Remover dos favoritos')
    fireEvent.click(removeBtns[0])

    const stored = JSON.parse(localStorage.getItem('stapp_gif_favorites') || '[]')
    expect(stored).toEqual(['https://media.klipy.com/fav-2.gif'])
  })
})