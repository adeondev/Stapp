// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
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
})
