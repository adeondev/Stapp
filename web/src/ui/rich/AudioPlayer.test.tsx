// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AudioPlayer } from './AudioPlayer'

describe('AudioPlayer', () => {
  it('renderiza botao de play, barra de posicao e contador', () => {
    const { container } = render(
      <AudioPlayer src="https://stapp.chat/audio.webm" filename="gravacao.webm" />
    )

    expect(screen.getByTitle('Reproduzir')).toBeTruthy()
    expect(screen.getByText('0:00 / 0:00')).toBeTruthy()

    // O slider e o que faltava: sem ele nao dava para saber nem onde o audio esta.
    const slider = screen.getByLabelText('Posição do áudio') as HTMLInputElement
    expect(slider.type).toBe('range')

    // Reproduz pelo proprio elemento de midia, sem baixar o arquivo por fetch.
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('https://stapp.chat/audio.webm')
  })

  it('tem controle de volume, e o valor escolhido vale para os proximos players', () => {
    localStorage.removeItem('stapp:volume-audio')
    const { unmount } = render(<AudioPlayer src="https://stapp.chat/a.webm" />)

    const volume = screen.getByLabelText('Volume') as HTMLInputElement
    expect(volume.value).toBe('1')

    fireEvent.change(volume, { target: { value: '0.3' } })
    expect(screen.getByTitle('Silenciar')).toBeTruthy()
    unmount()

    // Ajustar player a player seria inutil: quem baixou o volume quer o
    // proximo audio baixo tambem.
    render(<AudioPlayer src="https://stapp.chat/b.webm" />)
    expect((screen.getByLabelText('Volume') as HTMLInputElement).value).toBe('0.3')
  })

  it('o botao de mudo volta para o volume que estava antes', () => {
    localStorage.setItem('stapp:volume-audio', '0.8')
    render(<AudioPlayer src="https://stapp.chat/c.webm" />)

    fireEvent.click(screen.getByTitle('Silenciar'))
    expect((screen.getByLabelText('Volume') as HTMLInputElement).value).toBe('0')

    fireEvent.click(screen.getByTitle('Voltar o som'))
    expect((screen.getByLabelText('Volume') as HTMLInputElement).value).toBe('0.8')
  })
})
