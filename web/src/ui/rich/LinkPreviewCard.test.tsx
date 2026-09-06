// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { openExternalLink } from '../../platform/externalLink'
import { LinkPreviewCard } from './LinkPreviewCard'

vi.mock('../../platform/externalLink', () => ({
  openExternalLink: vi.fn(),
}))

describe('LinkPreviewCard', () => {
  it('renderiza os metadados do link', () => {
    render(
      <LinkPreviewCard
        preview={{
          url: 'https://github.com',
          title: 'GitHub: Let’s build from here',
          description: 'GitHub is where over 100 million developers shape the future of software.',
          image: 'https://github.githubassets.com/assets/campaign-social-031d6161fa10.png',
          site_name: 'GitHub',
        }}
      />
    )

    expect(screen.getByText('GitHub: Let’s build from here')).toBeTruthy()
    expect(screen.getByText(/over 100 million developers/)).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com')
  })

  it('intercepta o clique no card e redireciona para openExternalLink', async () => {
    const user = userEvent.setup()
    render(
      <LinkPreviewCard
        preview={{
          url: 'https://github.com',
          title: 'GitHub: Let’s build from here',
        }}
      />
    )
    const link = screen.getByRole('link')
    await user.click(link)
    expect(openExternalLink).toHaveBeenCalledWith('https://github.com')
  })

  it('não renderiza nada se não houver título nem descrição e nem embed', () => {
    const { container } = render(
      <LinkPreviewCard
        preview={{
          url: 'https://exemplo.com',
        }}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza miniatura com botão de play e só instancia iframe após o clique explícito', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <LinkPreviewCard
        preview={{
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Rick Astley - Never Gonna Give You Up',
          site_name: 'YouTube',
          image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
          provider: 'YouTube',
          video_width: 1280,
          video_height: 720,
        }}
      />
    )

    // Antes do clique: iframe NÃO deve existir no DOM
    expect(container.querySelector('iframe')).toBeNull()

    // Miniatura e botão de play devem estar visíveis
    const playBtn = screen.getByRole('button', { name: 'Reproduzir vídeo' })
    expect(playBtn).toBeTruthy()
    const thumbnail = screen.getByAltText('Rick Astley - Never Gonna Give You Up')
    expect(thumbnail.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')

    // Clique explícito para iniciar reprodução
    await user.click(playBtn)

    // Após o clique: iframe deve ser montado com atributos restritivos
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation')
    expect(iframe?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe?.hasAttribute('allowfullscreen')).toBe(true)

    // O botão de thumbnail/play não deve mais estar no DOM
    expect(screen.queryByRole('button', { name: 'Reproduzir vídeo' })).toBeNull()
  })

  it('permite abrir o link externo do vídeo clicando no título', async () => {
    const user = userEvent.setup()
    render(
      <LinkPreviewCard
        preview={{
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'Rick Astley - Never Gonna Give You Up',
          embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        }}
      />
    )

    const link = screen.getByRole('link', { name: 'Rick Astley - Never Gonna Give You Up' })
    await user.click(link)
    expect(openExternalLink).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})