// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
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

function desenhar(profiles: Record<string, Profile>, userId: string, fallbackName?: string) {
  return render(
    <ProfileProvider profiles={profiles}>
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

  it('nome que comeca com emoji ainda mostra uma letra', () => {
    desenhar({ 'user-1': perfil({ display_name: '🔥 deon' }) }, 'user-1')
    expect(screen.getByText('D')).toBeTruthy()
  })
})
