// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Profile } from '../protocol'
import { Avatar, ProfileProvider } from './Avatar'

const perfil = (over: Partial<Profile> = {}): Profile => ({
  user_id: 'user-1',
  username: 'daniel',
  display_name: 'Deon',
  accent: 'purple',
  bio: '',
  has_avatar: false,
  has_banner: false,
  created_at: 0,
  updated_at: 0,
  ...over,
})

function desenhar(
  profiles: Record<string, Profile>,
  userId: string,
  fallbackName?: string,
  avatarBase: string | null = null,
) {
  return render(
    <ProfileProvider profiles={profiles} avatarBase={avatarBase}>
      <Avatar userId={userId} className="teste__avatar" fallbackName={fallbackName} />
    </ProfileProvider>,
  )
}

describe('Avatar', () => {
  it('usa a inicial do nome de exibicao, nao a do username', () => {
    desenhar({ 'user-1': perfil() }, 'user-1')
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('pinta com a cor do perfil', () => {
    const { container } = desenhar({ 'user-1': perfil() }, 'user-1')
    const span = container.querySelector('.teste__avatar') as HTMLElement
    expect(span.style.getPropertyValue('--avatar-accent')).toBe('var(--accent-purple)')
    expect(span.style.getPropertyValue('--avatar-ink')).toBe('var(--accent-purple-ink)')
  })

  it('sem perfil ainda, cai no nome dado e na cor padrao', () => {
    const { container } = desenhar({}, 'user-9', 'lucas')
    expect(screen.getByText('L')).toBeTruthy()
    const span = container.querySelector('.teste__avatar') as HTMLElement
    expect(span.style.getPropertyValue('--avatar-accent')).toBe('var(--accent-blue)')
  })

  it('com foto, desenha a imagem em vez da inicial', () => {
    const { container } = desenhar(
      { 'user-1': perfil({ has_avatar: true, updated_at: 1700 }) },
      'user-1',
      undefined,
      'https://servidor.exemplo',
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    // A versao na URL e o que faz trocar a foto invalidar o cache.
    expect(img.getAttribute('src')).toBe('https://servidor.exemplo/avatars/user-1?v=1700')
    expect(screen.queryByText('D')).toBeNull()
  })

  /* O `<span>` em volta pinta `--avatar-accent` para a inicial ter contraste.
     Atras de uma foto isso virava cor solida vazando pela borda arredondada e
     por qualquer transparencia do PNG — e um retangulo colorido piscando
     enquanto a imagem carregava. */
  it('com foto, nao pinta fundo nenhum atras dela', () => {
    const { container } = desenhar(
      { 'user-1': perfil({ has_avatar: true, updated_at: 1700 }) },
      'user-1',
      undefined,
      'https://servidor.exemplo',
    )
    const span = container.querySelector('.teste__avatar') as HTMLElement
    expect(span.style.getPropertyValue('--avatar-accent')).toBe('transparent')
  })

  it('a cor volta quando a foto falha e a inicial reaparece', () => {
    const { container } = desenhar(
      { 'user-1': perfil({ has_avatar: true, updated_at: 1700 }) },
      'user-1',
      undefined,
      'https://servidor.exemplo',
    )
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    const span = container.querySelector('.teste__avatar') as HTMLElement
    expect(span.style.getPropertyValue('--avatar-accent')).toBe('var(--accent-purple)')
  })

  /* O servidor publica `avatar_static_url` RELATIVA. Usada crua, ela e resolvida
     contra a origem da PAGINA — `tauri://localhost` no app desktop, `:5173` no
     dev — e a imagem nunca chega. */
  it('resolve a URL relativa que o servidor publica contra a base do servidor', () => {
    const { container } = desenhar(
      {
        'user-1': perfil({
          has_avatar: true,
          updated_at: 1700,
          avatar_static_url: '/avatars/user-1?v=1700&static=1',
        }),
      },
      'user-1',
      undefined,
      'https://servidor.exemplo',
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://servidor.exemplo/avatars/user-1?v=1700&static=1')
  })

  it('foto que nao carrega cai no avatar gerado, sem quadrado quebrado', () => {
    const { container } = desenhar(
      { 'user-1': perfil({ has_avatar: true, updated_at: 1700 }) },
      'user-1',
      undefined,
      'https://servidor.exemplo',
    )
    const img = container.querySelector('img') as HTMLImageElement
    fireEvent.error(img)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('sem saber o endereco do servidor, nao tenta carregar imagem', () => {
    const { container } = desenhar({ 'user-1': perfil({ has_avatar: true }) }, 'user-1')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('nome que comeca com emoji ainda mostra uma letra', () => {
    desenhar({ 'user-1': perfil({ display_name: '🔥 deon' }) }, 'user-1')
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('adiciona classe is-speaking dinamicamente quando o peer fala', async () => {
    const { useVoiceStore } = await import('../stores/voiceStore')
    const { container } = render(
      <ProfileProvider profiles={{ 'user-1': perfil() }} avatarBase={null}>
        <Avatar userId="user-1" className="avatar-teste" peerId="peer-1" />
      </ProfileProvider>,
    )

    const span = container.querySelector('.avatar-teste') as HTMLElement
    expect(span.className).not.toContain('is-speaking')

    act(() => {
      useVoiceStore.getState().setSpeaking('peer-1', true)
    })
    expect(span.className).toContain('is-speaking')

    act(() => {
      useVoiceStore.getState().setSpeaking('peer-1', false)
    })
    expect(span.className).not.toContain('is-speaking')
  })
})
