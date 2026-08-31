// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../voice/preferences'
import { CallStage } from './CallStage'
import { UserMenuProvider } from './UserMenu'

const snapshot: VoiceSnapshot = {
  status: 'connected', channel: 'geral', muted: false, deafened: false,
  cameraEnabled: true, screenSharing: false, screenHasAudio: null, error: null,
  audioProcessor: { status: 'active', effective: 'standard' },
  participants: [
    { peerId: 'self', name: 'Daniel', local: true, speaking: false, microphone: true, camera: true, screen: false, quality: 'excellent' },
    { peerId: 'alice', name: 'Alice', local: false, speaking: true, microphone: true, camera: false, screen: true, quality: 'good' },
    { peerId: 'bia', name: 'Bia', local: false, speaking: false, microphone: false, camera: false, screen: true, quality: 'poor' },
  ],
  media: [
    { id: 'camera-self', peerId: 'self', name: 'Daniel', kind: 'camera', local: true, subscribed: true, muted: false },
    { id: 'screen-alice', peerId: 'alice', name: 'Alice', kind: 'screen', local: false, subscribed: false, muted: false },
    { id: 'screen-bia', peerId: 'bia', name: 'Bia', kind: 'screen', local: false, subscribed: false, muted: false },
  ],
}

function transport(): VoiceTransport {
  return {
    join: vi.fn(async () => true), leave: vi.fn(), resumeAudio: vi.fn(async () => true),
    setMuted: vi.fn(), setDeafened: vi.fn(),
    setCameraEnabled: vi.fn(async () => true), setScreenShareEnabled: vi.fn(async () => true),
    listScreenSources: vi.fn(async () => []), captureScreenSourceThumbnail: vi.fn(async () => null),
    setInputDevice: vi.fn(async () => {}), setOutputDevice: vi.fn(async () => {}), setCameraDevice: vi.fn(async () => {}),
    enumerateDevices: vi.fn(async () => ({ inputs: [], outputs: [], cameras: [] })),
    startMicrophoneTest: vi.fn(async () => () => {}), startCameraPreview: vi.fn(async () => () => {}),
    setPublicationSubscribed: vi.fn(), getVoiceVolume: vi.fn(() => 100), setVoiceVolume: vi.fn(),
    setVoiceMuted: vi.fn(), getScreenShareVolume: vi.fn(() => 100),
    setScreenShareVolume: vi.fn(), setScreenShareMuted: vi.fn(),
    attachMedia: vi.fn(() => () => {}), snapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}), getPreferences: () => ({ ...DEFAULT_VOICE_PREFERENCES }),
    updatePreferences: vi.fn(async () => {}), diagnosticReport: vi.fn(async () => ({
      generatedAt: '', backend: 'mock', status: 'connected' as const,
    })), handleServerMessage: vi.fn(), destroy: vi.fn(),
  }
}

describe('palco da chamada', () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('mantem multistream sob demanda e permite focar uma transmissao', async () => {
    const user = userEvent.setup()
    const media = transport()
    render(<CallStage channelName="Sala de voz" snapshot={snapshot} transport={media}
      onLeave={vi.fn()} onOpenSettings={vi.fn()} />)

    const watch = screen.getAllByRole('button', { name: /assistir transmissão/i })
    expect(watch).toHaveLength(2)
    await user.click(watch[0])
    expect(media.setPublicationSubscribed).toHaveBeenCalledWith('screen-alice', true)
    expect(screen.getByRole('region', { name: 'Chamada em Sala de voz' }).className).toContain('callstage--focus')
    await user.click(screen.getByRole('button', { name: 'voltar da mídia de Alice' }))
    expect(screen.getByRole('region', { name: 'Chamada em Sala de voz' }).className).not.toContain('callstage--focus')
  })

  it('expoe dock completo e comandos acessiveis por nome', async () => {
    const user = userEvent.setup()
    const media = transport()
    const leave = vi.fn()
    const settings = vi.fn()
    render(<CallStage channelName="Sala" snapshot={snapshot} transport={media}
      onLeave={leave} onOpenSettings={settings} />)

    await user.click(screen.getByRole('button', { name: 'desligar microfone' }))
    await user.click(screen.getByRole('button', { name: 'desligar camera' }))
    await user.click(screen.getByRole('button', { name: 'voz e vídeo' }))
    await user.click(screen.getByRole('button', { name: 'desconectar' }))
    expect(media.setMuted).toHaveBeenCalledWith(true)
    expect(media.setCameraEnabled).toHaveBeenCalledWith(false)
    expect(settings).toHaveBeenCalled()
    expect(leave).toHaveBeenCalled()
  })

  it('escolhe a fonte no modal do Stapp antes de compartilhar no aplicativo', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const user = userEvent.setup()
    const media = transport()
    vi.mocked(media.listScreenSources).mockResolvedValue([
      { id: 'screen:7:0', name: 'Tela principal', kind: 'screen', width: 1920, height: 1080 },
    ])
    render(<CallStage channelName="Sala" snapshot={snapshot} transport={media}
      onLeave={vi.fn()} onOpenSettings={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'compartilhar tela' }))
    expect(screen.getByRole('dialog', { name: 'Compartilhar tela' })).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: /Tela principal/ }))
    await user.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(media.setScreenShareEnabled).toHaveBeenCalledWith(true, {
      preset: 'balanced', sourceId: 'screen:7:0', includeAudio: true,
    })
  })

  it('resolve o userId dos participantes e renderiza avatar com foto quando disponivel', () => {
    const media = transport()
    const snapshotWithAvatars: VoiceSnapshot = {
      ...snapshot,
      media: [],
      participants: [
        { peerId: 'peer-user-1', name: 'Deon', local: true, speaking: false, microphone: true, camera: false, screen: false, quality: 'excellent' },
      ],
    }

    render(
      <CallStage
        channelName="Sala"
        snapshot={snapshotWithAvatars}
        transport={media}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
        resolveUserId={(peerId) => (peerId === 'peer-user-1' ? 'user-1' : undefined)}
        selfUserId="user-1"
      />,
    )

    // Avatar rendered with letter D
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('suporta modo embutido sem os botoes superiores antigos', () => {
    const media = transport()

    render(
      <CallStage
        channelName="dm-call"
        snapshot={snapshot}
        transport={media}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
        variant="embedded"
      />,
    )

    expect(screen.queryByRole('button', { name: 'tela cheia' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'minimizar' })).toBeNull()
  })

  it('troca camera mutada pelo avatar da pessoa', () => {
    const media = transport()
    render(<CallStage channelName="Sala" transport={media} onLeave={vi.fn()} onOpenSettings={vi.fn()}
      snapshot={{ ...snapshot, media: [{ ...snapshot.media[0], muted: true }], participants: [snapshot.participants[0]] }} />)
    expect(screen.getByText('Daniel')).toBeTruthy()
    expect(document.querySelector('video[data-publication="camera-self"]')).toBeNull()
  })

  it('mantem a pessoa separada da transmissao e usa faixa inferior ao focar', async () => {
    const user = userEvent.setup()
    const media = transport()
    const fourTiles: VoiceSnapshot = {
      ...snapshot,
      media: [snapshot.media[1]],
      participants: [
        snapshot.participants[0], snapshot.participants[1], snapshot.participants[2],
        { peerId: 'caio', name: 'Caio', local: false, speaking: false, microphone: true, camera: false, screen: false, quality: 'good' },
      ],
    }
    render(<CallStage channelName="Sala" snapshot={fourTiles} transport={media}
      onLeave={vi.fn()} onOpenSettings={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Assistir transmissão' }))
    expect(screen.getByLabelText('outros participantes').querySelectorAll('.calltile')).toHaveLength(4)
  })

  it('abre o menu real do tile por clique e botao direito e fecha no segundo clique', async () => {
    const user = userEvent.setup()
    const media = transport()
    const { container } = render(
      <UserMenuProvider members={[]} selfUserId={null} onMessage={vi.fn()}
        onCall={vi.fn()} onAction={vi.fn()} onEditSelf={vi.fn()}>
        <CallStage channelName="Sala" snapshot={snapshot} transport={media}
          onLeave={vi.fn()} onOpenSettings={vi.fn()} />
      </UserMenuProvider>,
    )
    const screenTile = container.querySelector<HTMLElement>('.calltile--screen')
    const more = screenTile?.querySelector<HTMLButtonElement>('.calltile__more')
    expect(screenTile).toBeTruthy()
    expect(more).toBeTruthy()

    await user.click(more!)
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.click(more!)
    expect(screen.queryByRole('menu')).toBeNull()

    expect(fireEvent.contextMenu(screenTile!)).toBe(false)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('permite alternar tela cheia na transmissao de tela e recolher barra inferior com chevron', async () => {
    const user = userEvent.setup()
    const media = transport()
    const { container } = render(
      <CallStage
        channelName="Sala"
        snapshot={snapshot}
        transport={media}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )

    // Botão de tela cheia no canto superior direito do tile da Alice
    const fullscreenAlice = screen.getByRole('button', { name: 'tela cheia de Alice' })
    expect(fullscreenAlice).toBeTruthy()
    await user.click(fullscreenAlice)

    // Stage ganha a classe de app fullscreen
    const stage = container.querySelector('.callstage')
    expect(stage?.classList.contains('callstage--app-fullscreen')).toBe(true)

    // O grupo antigo de acoes do header continua ausente mesmo em tela cheia.
    expect(screen.queryByRole('button', { name: 'Sair da tela cheia' })).toBeNull()

    // Botão colapsador da barra inferior (chevron) presente
    const toggleTrayBtn = screen.getByRole('button', { name: 'ocultar barra de participantes' })
    expect(toggleTrayBtn).toBeTruthy()
    await user.click(toggleTrayBtn)

    // Layout em modo colapsado para tela realmente cheia
    expect(stage?.classList.contains('callstage--tray-collapsed')).toBe(true)

    // Clicar novamente restaura
    const restoreTrayBtn = screen.getByRole('button', { name: 'mostrar barra de participantes' })
    expect(restoreTrayBtn).toBeTruthy()
    await user.click(restoreTrayBtn)
    expect(stage?.classList.contains('callstage--tray-collapsed')).toBe(false)

    // Tecla Escape sai da tela cheia
    await user.keyboard('{Escape}')
    expect(stage?.classList.contains('callstage--app-fullscreen')).toBe(false)
  })

  it('exibe badge AO VIVO apenas quando a transmissao estiver inscrita ou for local', () => {
    const media = transport()
    const { container } = render(
      <CallStage
        channelName="Sala"
        snapshot={snapshot}
        transport={media}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )

    // Como Alice e Bia estão com subscribed: false e local: false no snapshot, o badge "AO VIVO" não deve aparecer
    expect(screen.queryByText(/AO VIVO/)).toBeNull()

    // Ambas as miniaturas não inscritas devem ter a classe calltile--unsubscribed
    const unsubscribedTiles = container.querySelectorAll('.calltile--unsubscribed')
    expect(unsubscribedTiles.length).toBe(2)
  })
})
