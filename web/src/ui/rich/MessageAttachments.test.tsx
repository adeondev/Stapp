// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MessageAttachments } from './MessageAttachments'

/** O jsdom normaliza `aspect-ratio: 0.5625` para `0.5625 / 1`. */
function proporcaoDe(elemento: HTMLElement): number {
  const [largura, altura = '1'] = elemento.style.aspectRatio.split('/')
  return Number(largura) / Number(altura)
}

describe('MessageAttachments', () => {
  it('renderiza anexo de imagem com tag img', () => {
    render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-1',
            filename: 'foto.png',
            content_type: 'image/png',
            size_bytes: 1024 * 50,
            url: 'https://stapp.chat/files/foto.png',
          },
        ]}
      />
    )

    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://stapp.chat/files/foto.png')
    expect(img.getAttribute('alt')).toBe('foto.png')
  })

  /* A imagem so reserva espaco antes de carregar quando o anexo traz dimensao.
     Esse metadado passou a ser medido no envio; sem ele a conversa dava salto. */
  it('usa a proporcao real da imagem para reservar o espaco', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-4',
            filename: 'retrato.png',
            content_type: 'image/png',
            size_bytes: 2048,
            width: 1080,
            height: 1920,
            url: 'https://stapp.chat/files/retrato.png',
          },
        ]}
      />
    )

    const caixa = container.querySelector('.stapp-attachment-image-wrapper') as HTMLElement
    expect(proporcaoDe(caixa)).toBeCloseTo(1080 / 1920)
  })

  it('renderiza video no player do app, e nao nos controles do navegador', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-3',
            filename: 'clipe.mp4',
            content_type: 'video/mp4',
            size_bytes: 1024 * 1024,
            width: 1080,
            height: 1920,
            url: 'https://stapp.chat/files/clipe.mp4',
          },
        ]}
      />
    )

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://stapp.chat/files/clipe.mp4')
    // A barra do navegador sai de cena: quem desenha os controles e o app.
    expect(video?.hasAttribute('controls')).toBe(false)
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeTruthy()

    // Video em pe recebe a proporcao real, e nao uma caixa 16:9.
    const caixa = container.querySelector('.video-player') as HTMLElement
    expect(proporcaoDe(caixa)).toBeCloseTo(1080 / 1920)
  })

  it('renderiza arquivo generico como cartao com tipo, tamanho e download', () => {
    render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-2',
            filename: 'documento.pdf',
            content_type: 'application/pdf',
            size_bytes: 1024 * 1024 * 2.5,
            url: 'https://stapp.chat/files/documento.pdf',
          },
        ]}
      />
    )

    expect(screen.getByText('documento.pdf')).toBeTruthy()
    expect(screen.getByText('PDF · 2.5 MB')).toBeTruthy()
    const link = screen.getByRole('link', { name: /Baixar documento\.pdf/ })
    expect(link.getAttribute('href')).toBe('https://stapp.chat/files/documento.pdf')
    expect(link.getAttribute('download')).toBe('documento.pdf')
  })

  it('abre o visualizador ao clicar na imagem, com navegacao entre as da mensagem', async () => {
    render(
      <MessageAttachments
        attachments={[
          { id: 'a', filename: 'um.png', content_type: 'image/png', size_bytes: 10, url: '/files/um.png' },
          { id: 'b', filename: 'dois.png', content_type: 'image/png', size_bytes: 20, url: '/files/dois.png' },
        ]}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Abrir dois.png' }))

    const viewer = await screen.findByRole('dialog', { name: /Imagem: dois\.png/ })
    expect(viewer).toBeTruthy()
    expect(screen.getByText(/2 de 2/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Imagem anterior' })).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Imagem:/ })).toBeNull()
  })
})
