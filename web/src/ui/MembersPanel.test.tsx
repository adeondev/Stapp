// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProfileProvider } from './Avatar'
import { MembersPanel } from './MembersPanel'

describe('painel de membros', () => {
  it('inclui o proprio perfil vivo como Voce e conta exatamente as linhas', async () => {
    const edit = vi.fn()
    render(
      <ProfileProvider
        avatarBase={null}
        profiles={{
          self: {
            user_id: 'self', username: 'deon', display_name: 'Deon vivo', accent: 'blue',
            bio: '', has_avatar: false, updated_at: 1,
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
          onEditSelf={edit}
          onMessage={vi.fn()}
          onAction={vi.fn()}
        />
      </ProfileProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Membros — 2' })).toBeTruthy()
    expect(screen.getByText('Deon vivo')).toBeTruthy()
    expect(screen.getByText('Você · Online')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Deon vivo/ }))
    expect(edit).toHaveBeenCalledOnce()
  })
})
