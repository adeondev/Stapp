// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageAttachments } from './MessageAttachments'

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

  it('renderiza anexo de vídeo com player, e não como arquivo para baixar', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-3',
            filename: 'clipe.mp4',
            content_type: 'video/mp4',
            size_bytes: 1024 * 1024,
            url: 'https://stapp.chat/files/clipe.mp4',
          },
        ]}
      />
    )

    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://stapp.chat/files/clipe.mp4')
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renderiza anexo genérico como link de download com tamanho formatado', () => {
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
    expect(screen.getByText('2.5 MB')).toBeTruthy()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://stapp.chat/files/documento.pdf')
    expect(link.getAttribute('download')).toBe('documento.pdf')
  })
})