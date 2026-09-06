// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MessageAttachments } from './MessageAttachments'
import { clearAttachmentTicketCache } from '../../net/attachmentTickets'

vi.mock('../../net/mediaUpload', () => ({
  attachmentContentUrl: vi.fn(),
}))

describe('MessageAttachments', () => {
  beforeEach(() => {
    clearAttachmentTicketCache()
  })

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

  it('reserva espaco por proporcao de aspecto da imagem', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-aspect',
            filename: 'foto.png',
            content_type: 'image/png',
            size_bytes: 1024 * 50,
            width: 1200,
            height: 800,
            url: 'https://stapp.chat/files/foto.png',
          },
        ]}
      />
    )

    const wrapper = container.querySelector('.stapp-attachment-image-wrapper') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.aspectRatio).toBe('1200 / 800')
  })

  it('aplica proporcao padrao 16 / 9 quando nao ha metadados de dimensao', () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-no-dim',
            filename: 'foto.png',
            content_type: 'image/png',
            size_bytes: 1024 * 50,
            url: 'https://stapp.chat/files/foto.png',
          },
        ]}
      />
    )

    const wrapper = container.querySelector('.stapp-attachment-image-wrapper') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.aspectRatio).toBe('16 / 9')
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

  it('exibe botao de tentar novamente quando o anexo falha e permite retry', async () => {
    const { attachmentContentUrl } = await import('../../net/mediaUpload')
    const mockContentUrl = vi.mocked(attachmentContentUrl)
    mockContentUrl.mockRejectedValueOnce(new Error('Network error'))

    render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-err',
            filename: 'foto_antiga.png',
            content_type: 'image/png',
            size_bytes: 1024 * 50,
          },
        ]}
        serverUrl="ws://localhost:9000"
        accessToken="token-123"
      />
    )

    const errMsg = await screen.findByText('Anexo indisponível')
    expect(errMsg).toBeTruthy()
    const retryBtn = screen.getByRole('button', { name: 'Tentar novamente' })
    expect(retryBtn).toBeTruthy()

    mockContentUrl.mockResolvedValueOnce('https://stapp.chat/files/recovered.png')
    retryBtn.click()

    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toBe('https://stapp.chat/files/recovered.png')
  })

  it('isola erro de um anexo sem impedir a renderização dos demais anexos', async () => {
    const { attachmentContentUrl } = await import('../../net/mediaUpload')
    const mockContentUrl = vi.mocked(attachmentContentUrl)
    mockContentUrl.mockImplementation(async (_server, _token, id) => {
      if (id === 'att-broken') {
        throw new Error('404 Not Found')
      }
      return 'https://stapp.chat/files/healthy.png'
    })

    render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-broken',
            filename: 'quebrado.png',
            content_type: 'image/png',
            size_bytes: 1024,
          },
          {
            id: 'att-healthy',
            filename: 'saudavel.png',
            content_type: 'image/png',
            size_bytes: 2048,
          },
        ]}
        serverUrl="ws://localhost:9000"
        accessToken="token-123"
      />
    )

    const errMsg = await screen.findByText('Anexo indisponível')
    expect(errMsg).toBeTruthy()

    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toBe('https://stapp.chat/files/healthy.png')
    expect(img.getAttribute('alt')).toBe('saudavel.png')
  })

  it('não registra listeners de visibilitychange por anexo individual', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    render(
      <MessageAttachments
        attachments={[
          {
            id: 'att-1',
            filename: 'f1.png',
            content_type: 'image/png',
            size_bytes: 100,
          },
          {
            id: 'att-2',
            filename: 'f2.png',
            content_type: 'image/png',
            size_bytes: 200,
          },
        ]}
        serverUrl="ws://localhost:9000"
        accessToken="token-123"
      />
    )

    const visibilityCalls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === 'visibilitychange',
    )
    expect(visibilityCalls.length).toBe(0)
    addEventListenerSpy.mockRestore()
  })
})