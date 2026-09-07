// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Profile } from '../../protocol'
import { ProfileProvider } from '../Avatar'
import { UserProfileCard } from './UserProfileCard'

/* O banner estava salvo, o servidor devolvia 200, e no aplicativo desktop
   aparecia so a faixa de cor com um icone de imagem quebrada. `banner_url` chega
   RELATIVA ao servidor (`/banners/<id>?v=...`); usada crua ela e resolvida
   contra a origem da PAGINA, que no Tauri e `tauri://localhost` e no dev e
   `:5173` — nunca o servidor. */

const perfil = (over: Partial<Profile> = {}): Profile => ({
  user_id: 'user-1',
  username: 'lolacas',
  display_name: 'Lolacas',
  accent: 'purple',
  bio: '',
  has_avatar: false,
  has_banner: false,
  created_at: 0,
  updated_at: 0,
  ...over,
})

function desenhar(profile: Profile, avatarBase: string | null, props = {}) {
  return render(
    <ProfileProvider profiles={{ [profile.user_id]: profile }} avatarBase={avatarBase}>
      <UserProfileCard userId={profile.user_id} {...props} />
    </ProfileProvider>,
  )
}

const bannerDe = (container: HTMLElement) =>
  container.querySelector('.profile-card__banner-img') as HTMLImageElement | null

describe('banner do cartão de perfil', () => {
  it('resolve a URL relativa contra o servidor', () => {
    const { container } = desenhar(
      perfil({ has_banner: true, updated_at: 99, banner_url: '/banners/user-1?v=99' }),
      'https://servidor.exemplo',
    )
    expect(bannerDe(container)?.getAttribute('src'))
      .toBe('https://servidor.exemplo/banners/user-1?v=99')
  })

  it('acha a base pelo contexto quando ela não vem por prop', () => {
    const { container } = desenhar(
      perfil({ has_banner: true, updated_at: 99 }),
      'https://servidor.exemplo',
    )
    expect(bannerDe(container)?.getAttribute('src'))
      .toBe('https://servidor.exemplo/banners/user-1?v=99')
  })

  it('a prévia local do editor passa intacta, sem ganhar prefixo', () => {
    const { container } = desenhar(
      perfil({ has_banner: true }),
      'https://servidor.exemplo',
      { bannerPreview: 'blob:https://app/rascunho' },
    )
    expect(bannerDe(container)?.getAttribute('src')).toBe('blob:https://app/rascunho')
  })

  it('sem imagem, a faixa é a cor escolhida', () => {
    const { container } = desenhar(perfil({ banner_color: '#123456' }), 'https://servidor.exemplo')
    expect(bannerDe(container)).toBeNull()
    const faixa = container.querySelector('.profile-card__banner') as HTMLElement
    expect(faixa.style.backgroundColor).toBe('rgb(18, 52, 86)')
  })

  /* Imagem e cor sao exclusivas: com imagem a cor nao pinta nada atras dela. */
  it('com imagem, a cor sólida não é pintada por baixo', () => {
    const { container } = desenhar(
      perfil({ has_banner: true, updated_at: 99, banner_color: '#123456' }),
      'https://servidor.exemplo',
    )
    expect(bannerDe(container)).not.toBeNull()
    const faixa = container.querySelector('.profile-card__banner') as HTMLElement
    expect(faixa.style.backgroundColor).toBe('')
    expect(faixa.className).toContain('has-image')
  })
})
