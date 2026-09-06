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
        />
      </ProfileProvider>,
    )

    expect(screen.getByRole('heading', { name: '2 — Online' })).toBeTruthy()
    expect(screen.getByText('2 — Online')).toBeTruthy()
    expect(screen.getByText('Deon vivo')).toBeTruthy()
    expect(screen.getByText('você')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Deon vivo/ }))
    expect(edit).toHaveBeenCalledOnce()
  })

  it('renderiza membros offline com seção separada e formato "Y — Offline"', () => {
    render(
      <ProfileProvider avatarBase={null} profiles={{}}>
        <MembersPanel
          members={[
            { user_id: 'alice', username: 'Alice', relationship: 'friend', can_start_dm: true, has_conversation: true },
            { user_id: 'bob', username: 'Bob', relationship: 'friend', can_start_dm: true, has_conversation: true },
          ]}
          onlineIds={new Set(['alice'])}
          selfUserId={null}
          selfUsername=""
          onEditSelf={vi.fn()}
        />
      </ProfileProvider>,
    )

    expect(screen.getByRole('heading', { name: '1 — Online' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '1 — Offline' })).toBeTruthy()
    expect(screen.getByText('1 — Online')).toBeTruthy()
    expect(screen.getByText('1 — Offline')).toBeTruthy()
    const aliceBtn = screen.getByRole('button', { name: /Alice/ })
    const bobBtn = screen.getByRole('button', { name: /Bob/ })
    expect(bobBtn.classList.contains('is-offline')).toBe(true)
    expect(aliceBtn.classList.contains('is-offline')).toBe(false)
    const aliceAvatar = aliceBtn.querySelector('.members__avatar')
    const bobAvatar = bobBtn.querySelector('.members__avatar')
    expect(aliceAvatar?.classList.contains('is-online')).toBe(true)
    expect(bobAvatar?.classList.contains('is-online')).toBe(false)
  })
})
