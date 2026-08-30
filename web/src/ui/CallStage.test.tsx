// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../voice/preferences'
import { CallStage } from './CallStage'

const snapshot: VoiceSnapshot = {
  status: 'connected', channel: 'geral', muted: false, deafened: false,
  cameraEnabled: true, screenSharing: false, screenHasAudio: null, error: null,
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
    setPublicationSubscribed: vi.fn(), setPublicationQuality: vi.fn(), setParticipantVolume: vi.fn(),
    setPublicationVolume: vi.fn(), attachMedia: vi.fn(() => () => {}), snapshot: () => snapshot,
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
      onMinimize={vi.fn()} onLeave={vi.fn()} onOpenSettings={vi.fn()} />)

    const watch = screen.getAllByRole('button', { name: /assistir transmissão/i })
    expect(watch).toHaveLength(2)
    await user.click(watch[0])
    expect(media.setPublicationSubscribed).toHaveBeenCalledWith('screen-alice', true)

    await user.click(screen.getByRole('button', { name: 'opções de Alice' }))
    await user.click(screen.getByRole('menuitem', { name: 'Focar' }))
    expect(screen.getByRole('region', { name: 'Chamada em Sala de voz' }).className).toContain('callstage--focus')
  })

  it('expoe dock completo e comandos acessiveis por nome', async () => {
    const user = userEvent.setup()
    const media = transport()
    const leave = vi.fn()
    const settings = vi.fn()
    render(<CallStage channelName="Sala" snapshot={snapshot} transport={media}
      onMinimize={vi.fn()} onLeave={leave} onOpenSettings={settings} />)

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
      onMinimize={vi.fn()} onLeave={vi.fn()} onOpenSettings={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'compartilhar tela' }))
    expect(screen.getByRole('dialog', { name: 'Compartilhar tela' })).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: /Tela principal/ }))
    await user.click(screen.getByRole('button', { name: 'Compartilhar' }))

    expect(media.setScreenShareEnabled).toHaveBeenCalledWith(true, 'balanced', 'screen:7:0')
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
        onMinimize={vi.fn()}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
        resolveUserId={(peerId) => (peerId === 'peer-user-1' ? 'user-1' : undefined)}
        selfUserId="user-1"
      />,
    )

    // Avatar rendered with letter D
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('suporta modo embutido (embedded) e exibe botao para alternar', async () => {
    const media = transport()
    const onToggleVariant = vi.fn()

    render(
      <CallStage
        channelName="dm-call"
        snapshot={snapshot}
        transport={media}
        onMinimize={vi.fn()}
        onLeave={vi.fn()}
        onOpenSettings={vi.fn()}
        variant="embedded"
        onToggleVariant={onToggleVariant}
      />,
    )

    const toggleBtn = screen.getByRole('button', { name: 'tela cheia' })
    expect(toggleBtn).toBeTruthy()
    await userEvent.click(toggleBtn)
    expect(onToggleVariant).toHaveBeenCalledTimes(1)
  })
})
