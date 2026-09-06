// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProfileProvider } from './Avatar'
import { MembersPanel } from './MembersPanel'

describe('painel de membros', () => {
  it('inclui o proprio perfil vivo como Voce e conta exatamente as linhas', async () => {
    render(
      <ProfileProvider
        avatarBase={null}
        profiles={{
          self: {
            user_id: 'self', username: 'deon', display_name: 'Deon vivo', accent: 'blue',
            bio: '', has_avatar: false, has_banner: false, created_at: 0, updated_at: 1,
          },
        }}
      >
        <MembersPanel
          members={[{
            user_id: 'alice', username: 'Alice', relationship: 'friend',
            can_start_dm: true, has_conversation: true,
          }]}
          onlineIds={new Set(['alice'])}
          selfUserId="self"
          selfUsername="deon"
        />
      </ProfileProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Online — 2' })).toBeTruthy()
    expect(screen.getByText('Deon vivo')).toBeTruthy()
    expect(screen.getByText('você')).toBeTruthy()

    /* A linha continua sendo um botao — o que mudou e o destino: agora o clique
       da esquerda abre o cartao de perfil (inclusive o proprio, que leva a
       "Editar perfil"), e nao mais o menu de acoes. O comportamento do cartao
       tem teste proprio em `profile/UserProfilePopover.test.tsx`. */
    const minhaLinha = screen.getByRole('button', { name: /Deon vivo/ })
    await userEvent.click(minhaLinha)
    expect(minhaLinha.tagName).toBe('BUTTON')
  })
})
