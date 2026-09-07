// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile, SocialMember, UserId } from '../../protocol'
import { usePresenceStore } from '../../stores/presenceStore'
import { ProfileProvider } from '../Avatar'
import { MenuHost } from '../Menu'
import { UserProfileProvider, useProfileTrigger } from './UserProfilePopover'

const perfil = (id: string, nome: string, extra: Partial<Profile> = {}): Profile => ({
  user_id: id,
  username: nome.toLowerCase(),
  display_name: nome,
  accent: 'blue',
  bio: '',
  has_avatar: false,
  has_banner: false,
  created_at: 0,
  updated_at: 1,
  ...extra,
})

const amiga: SocialMember = {
  user_id: 'alice', username: 'alice', relationship: 'friend',
  can_start_dm: true, has_conversation: true,
}

function Alvo({ userId }: { userId: UserId }) {
  const gatilho = useProfileTrigger(userId)
  return <span {...gatilho}>abrir {userId}</span>
}

function montar(
  over: Partial<React.ComponentProps<typeof UserProfileProvider>> = {},
  extraProfiles: Record<string, Profile> = {},
  extraAlvos: string[] = [],
) {
  const profiles = {
    self: perfil('self', 'Deon'),
    alice: perfil('alice', 'Alice', { bio: 'oi', created_at: 1_600_000_000_000 }),
    ...extraProfiles,
  }
  usePresenceStore.setState({ profiles, profileDetails: {} })
  const props = {
    selfUserId: 'self' as UserId,
    members: [amiga],
    onlineIds: new Set<UserId>(['alice']),
    avatarBase: null,
    onMessage: vi.fn(),
    onCall: vi.fn(),
    onQuickMessage: vi.fn(),
    onAction: vi.fn(),
    onEditSelf: vi.fn(),
    onFetchDetail: vi.fn(),
    ...over,
  }
  const view = render(
    <ProfileProvider profiles={profiles} avatarBase={null}>
      <MenuHost>
        <UserProfileProvider {...props}>
          <Alvo userId="alice" />
          <Alvo userId="self" />
          <Alvo userId="fantasma" />
          {extraAlvos.map((id) => (
            <Alvo key={id} userId={id} />
          ))}
          <button type="button">fora</button>
        </UserProfileProvider>
      </MenuHost>
    </ProfileProvider>,
  )
  return { ...view, props }
}

afterEach(() => {
  usePresenceStore.getState().resetPresence()
})

describe('UserProfilePopover', () => {
  it('abre o cartao a partir de qualquer alvo e mostra o que existe de verdade', async () => {
    montar()
    await userEvent.click(screen.getByText('abrir alice'))

    const cartao = await screen.findByRole('dialog', { name: 'Perfil' })
    expect(cartao).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Alice' })).toBeTruthy()
    expect(screen.getByText('@alice')).toBeTruthy()
    expect(screen.getByText('Amigos')).toBeTruthy()
    expect(screen.getByText('oi')).toBeTruthy()
    expect(screen.getByText('Membro desde')).toBeTruthy()
  })

  it('pede o detalhe ao abrir, e nao a cada avatar desenhado', async () => {
    const { props } = montar()
    expect(props.onFetchDetail).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('abrir alice'))
    await waitFor(() => expect(props.onFetchDetail).toHaveBeenCalledWith('alice'))
  })

  /* Enquanto o servidor nao respondeu, `mutualFriends` e `undefined`. O cartao
     precisa dizer que esta carregando — anunciar "nenhum amigo em comum" antes
     de saber seria inventar dado, que e justamente o que nao pode acontecer. */
  it('distingue carregando de nao ter nenhum amigo em comum', async () => {
    montar()
    await userEvent.click(screen.getByText('abrir alice'))
    expect(screen.getByText('Carregando…')).toBeTruthy()

    usePresenceStore.setState({ profileDetails: { alice: { mutualFriends: [] } } })
    await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull())
    expect(screen.queryByText(/Amigos em comum/)).toBeNull()
  })

  it('mostra indisponivel quando a conta nao existe mais', async () => {
    montar()
    await userEvent.click(screen.getByText('abrir fantasma'))

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText(/conta pode ter sido removida/i)).toBeTruthy()
  })

  it('fecha no Escape e devolve o foco para quem abriu', async () => {
    montar()
    const alvo = screen.getByText('abrir alice')
    await userEvent.click(alvo)
    await screen.findByRole('dialog', { name: 'Perfil' })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Perfil' })).toBeNull())
    expect(document.activeElement).toBe(alvo)
  })

  it('fecha ao clicar fora e nao fecha ao clicar dentro', async () => {
    montar()
    await userEvent.click(screen.getByText('abrir alice'))
    await screen.findByRole('dialog', { name: 'Perfil' })

    await userEvent.click(screen.getByRole('heading', { name: 'Alice' }))
    expect(screen.queryByRole('dialog', { name: 'Perfil' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'fora' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Perfil' })).toBeNull())
  })

  it('abre pelo teclado com Enter', async () => {
    montar()
    const alvo = screen.getByText('abrir alice')
    alvo.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Perfil' })).toBeTruthy()
  })

  it('manda a mensagem rapida sem trocar de tela', async () => {
    const { props } = montar()
    await userEvent.click(screen.getByText('abrir alice'))

    const campo = await screen.findByLabelText('Mensagem para Alice')
    await userEvent.type(campo, 'oi tudo bem{Enter}')
    expect(props.onQuickMessage).toHaveBeenCalledWith('alice', 'oi tudo bem')
  })

  it('no proprio perfil oferece editar, e nao acoes sociais', async () => {
    const { props } = montar()
    await userEvent.click(screen.getByText('abrir self'))
    await screen.findByRole('dialog', { name: 'Perfil' })

    expect(screen.queryByRole('button', { name: 'Mensagem' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ligar' })).toBeNull()
    expect(screen.queryByText('Carregando…')).toBeNull()
    // O proprio perfil nao gera consulta de amigos em comum consigo mesmo.
    expect(props.onFetchDetail).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Editar perfil' }))
    expect(props.onEditSelf).toHaveBeenCalledOnce()
  })

  it('renderiza banner com cor sólida customizada (banner_color)', async () => {
    const { container } = montar(
      {
        members: [{ user_id: 'bob', username: 'bob', relationship: 'none', can_start_dm: false, has_conversation: false }],
      },
      {
        bob: perfil('bob', 'Bob', { banner_color: '#123456' }),
      },
      ['bob'],
    )

    await userEvent.click(screen.getByText('abrir bob'))
    const dialog = await screen.findByRole('dialog', { name: 'Perfil' })
    const bannerEl = dialog.querySelector('.profile-card__banner') as HTMLElement
    expect(bannerEl).toBeTruthy()
    expect(bannerEl.style.backgroundColor).toBe('rgb(18, 52, 86)') // #123456
  })

  it('renderiza banner com banner_url customizado', async () => {
    montar(
      {
        members: [{ user_id: 'carol', username: 'carol', relationship: 'none', can_start_dm: false, has_conversation: false }],
      },
      {
        carol: perfil('carol', 'Carol', { banner_url: 'https://cdn.example.com/banner.gif' }),
      },
      ['carol'],
    )

    await userEvent.click(screen.getByText('abrir carol'))
    const dialog = await screen.findByRole('dialog', { name: 'Perfil' })

    const bannerImg = dialog.querySelector('.profile-card__banner-img') as HTMLImageElement
    expect(bannerImg).toBeTruthy()
    expect(bannerImg.src).toBe('https://cdn.example.com/banner.gif')
  })

  it('exibe badges de status online e nome do servidor', async () => {
    const profiles = {
      self: perfil('self', 'Deon'),
      alice: perfil('alice', 'Alice'),
    }
    usePresenceStore.setState({ profiles, profileDetails: {} })
    montar({
      members: [{
        user_id: 'alice',
        username: 'alice',
        relationship: 'friend',
        can_start_dm: true,
        has_conversation: true,
        server_name: 'Stapp Oficial',
      }],
      onlineIds: new Set<UserId>(['alice']),
    })

    await userEvent.click(screen.getByText('abrir alice'))
    await screen.findByRole('dialog', { name: 'Perfil' })

    expect(screen.getByText('Online')).toBeTruthy()
    expect(screen.getByText('Stapp Oficial')).toBeTruthy()
  })

  it('abre modal de perfil completo ao clicar em Ver perfil completo', async () => {
    montar()
    await userEvent.click(screen.getByText('abrir alice'))
    await screen.findByRole('dialog', { name: 'Perfil' })

    const btnVerCompleto = screen.getByRole('button', { name: 'Ver perfil completo' })
    expect(btnVerCompleto).toBeTruthy()
    await userEvent.click(btnVerCompleto)

    // O modal com classe profile-full deve abrir
    const modal = await screen.findByRole('dialog', { name: 'Perfil' })
    expect(modal.classList.contains('profile-full')).toBe(true)
  })
})
