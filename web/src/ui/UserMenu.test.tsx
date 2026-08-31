// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { VoiceTransport } from '../voice/VoiceTransport'
import { UserMenuProvider, useUserMenu, type CallMenuControls } from './UserMenu'

function Harness({ call }: { call: CallMenuControls }) {
  const menu = useUserMenu()
  return <button onClick={(event) => menu.open({
    x: 20,
    y: 20,
    menuKey: 'calltile:peer',
    trigger: event.currentTarget,
  }, { userId: 'user', name: 'Teteu', call })}>Abrir</button>
}

const members = [{
  user_id: 'user',
  username: 'Teteu',
  relationship: 'none' as const,
  can_start_dm: true,
  has_conversation: false,
}]

describe('menu de call', () => {
  it('separa voz e transmissao e abre usando os volumes reais', async () => {
    const user = userEvent.setup()
    let voiceVolume = 0
    let screenVolume = 25
    const transport = {
      getVoiceVolume: vi.fn(() => voiceVolume),
      setVoiceVolume: vi.fn((_peer, value) => { voiceVolume = value }),
      setVoiceMuted: vi.fn((_peer, muted) => { voiceVolume = muted ? 0 : 80 }),
      getScreenShareVolume: vi.fn(() => screenVolume),
      setScreenShareVolume: vi.fn((_peer, value) => { screenVolume = value }),
      setScreenShareMuted: vi.fn((_peer, muted) => { screenVolume = muted ? 0 : 25 }),
      setPublicationSubscribed: vi.fn(),
    } as unknown as VoiceTransport
    const base = { peerId: 'peer', transport, local: false, focused: false, onFocus: vi.fn() }
    const view = render(<UserMenuProvider members={members} selfUserId={null} onMessage={vi.fn()}
      onCall={vi.fn()} onAction={vi.fn()} onEditSelf={vi.fn()}>
      <Harness call={{ ...base, kind: 'person' }} />
    </UserMenuProvider>)

    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Silenciar' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0')
    expect(screen.queryByText('Volume da transmissão')).toBeNull()
    await user.keyboard('{Escape}')

    view.rerender(<UserMenuProvider members={members} selfUserId={null} onMessage={vi.fn()}
      onCall={vi.fn()} onAction={vi.fn()} onEditSelf={vi.fn()}>
      <Harness call={{ ...base, kind: 'screen', publicationId: 'screen-peer' }} />
    </UserMenuProvider>)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Silenciar transmissão' }).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('25')
    expect(screen.queryByText('Volume da voz')).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Parar de assistir' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Mensagem' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Ligar' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Adicionar amigo' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Bloquear' })).toBeNull()
  })

  it('fecha o menu quando o mesmo botao de opcoes e clicado de novo', async () => {
    const user = userEvent.setup()
    const transport = {
      getVoiceVolume: vi.fn(() => 100),
      getScreenShareVolume: vi.fn(() => 100),
    } as unknown as VoiceTransport
    const call = { peerId: 'peer', transport, local: false, focused: false, onFocus: vi.fn(), kind: 'person' as const }
    render(<UserMenuProvider members={members} selfUserId={null} onMessage={vi.fn()}
      onCall={vi.fn()} onAction={vi.fn()} onEditSelf={vi.fn()}>
      <Harness call={call} />
    </UserMenuProvider>)

    const trigger = screen.getByRole('button', { name: 'Abrir' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
