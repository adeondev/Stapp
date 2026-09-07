// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CallTileAvatar } from './CallTile'
import { Avatar, ProfileProvider } from './Avatar'

describe('Avatar GIF reativo a fala', () => {
  it('CallTileAvatar alterna entre avatar_static_url e avatar_gif_url conforme isSpeaking', () => {
    const user = {
      avatar_static_url: 'http://server/avatars/u1?v=1&static=1',
      avatar_gif_url: 'http://server/avatars/u1?v=1&gif=1',
      display_name: 'Tester',
      username: 'tester',
    }

    // Em silêncio (isSpeaking = false): exibe avatar_static_url
    const { container, rerender } = render(
      <CallTileAvatar user={user} isSpeaking={false} className="avatar-img" />
    )
    let img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe(user.avatar_static_url)

    // Falando (isSpeaking = true): exibe avatar_gif_url
    rerender(
      <CallTileAvatar user={user} isSpeaking={true} className="avatar-img" />
    )
    img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe(user.avatar_gif_url)

    // Voltando ao silêncio: retorna ao frame estático
    rerender(
      <CallTileAvatar user={user} isSpeaking={false} className="avatar-img" />
    )
    img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe(user.avatar_static_url)
  })

  it('Avatar componente visual alterna src do GIF reativo a flag speaking', () => {
    const profiles = {
      u_gif: {
        user_id: 'u_gif',
        username: 'gifuser',
        display_name: 'Gif User',
        accent: 'blue' as const,
        bio: '',
        has_avatar: true,
        avatar_gif: true,
        avatar_static_url: 'http://server/avatars/u_gif?v=1&static=1',
        avatar_gif_url: 'http://server/avatars/u_gif?v=1&gif=1',
        has_banner: false,
        created_at: 0,
        updated_at: 1,
      },
    }

    const { container, rerender } = render(
      <ProfileProvider profiles={profiles} avatarBase="http://server">
        <Avatar userId="u_gif" speaking={false} />
      </ProfileProvider>
    )

    let img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('http://server/avatars/u_gif?v=1&static=1')

    // Falando:
    rerender(
      <ProfileProvider profiles={profiles} avatarBase="http://server">
        <Avatar userId="u_gif" speaking={true} />
      </ProfileProvider>
    )
    img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('http://server/avatars/u_gif?v=1&gif=1')
  })
})
