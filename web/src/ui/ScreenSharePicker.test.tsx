// @vitest-environment jsdom

import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../voice/preferences'
import { ScreenSharePicker } from './ScreenSharePicker'

function mockTransport(initialSources = [
  { id: 'screen:1', name: 'Monitor 1', kind: 'screen' as const, width: 1920, height: 1080 },
  { id: 'window:1', name: 'Editor de Código', kind: 'window' as const, width: 1280, height: 720 },
]): VoiceTransport {
  let sources = [...initialSources]
  return {
    join: vi.fn(async () => true), leave: vi.fn(), resumeAudio: vi.fn(async () => true),
    setMuted: vi.fn(), setDeafened: vi.fn(),
    setCameraEnabled: vi.fn(async () => true), setScreenShareEnabled: vi.fn(async () => true),
    listScreenSources: vi.fn(async () => sources),
    captureScreenSourceThumbnail: vi.fn(async () => 'png-preview'),
    setInputDevice: vi.fn(async () => {}), setOutputDevice: vi.fn(async () => {}), setCameraDevice: vi.fn(async () => {}),
    enumerateDevices: vi.fn(async () => ({ inputs: [], outputs: [], cameras: [] })),
    startMicrophoneTest: vi.fn(async () => () => {}), startCameraPreview: vi.fn(async () => () => {}),
    setPublicationSubscribed: vi.fn(), getVoiceVolume: vi.fn(() => 100), setVoiceVolume: vi.fn(),
    setVoiceMuted: vi.fn(), getScreenShareVolume: vi.fn(() => 100),
    setScreenShareVolume: vi.fn(), setScreenShareMuted: vi.fn(),
    attachMedia: vi.fn(() => () => {}),
    snapshot: () => ({
      status: 'connected', channel: 'geral', muted: false, deafened: false,
      cameraEnabled: false, screenSharing: false, screenHasAudio: null, error: null,
      audioProcessor: { status: 'idle', effective: 'none' },
      participants: [], media: [],
    }),
    subscribe: vi.fn(() => () => {}), getPreferences: () => ({ ...DEFAULT_VOICE_PREFERENCES }),
    updatePreferences: vi.fn(async () => {}), diagnosticReport: vi.fn(async () => ({
      generatedAt: '', backend: 'mock', status: 'connected' as const,
    })), handleServerMessage: vi.fn(), destroy: vi.fn(),
  }
}

describe('ScreenSharePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('lista fontes no modo desktop nativo com abas e botao de atualizar', async () => {
    const transport = mockTransport()
    render(
      <ScreenSharePicker
        transport={transport}
        initialPreset="balanced"
        onClose={vi.fn()}
        onShare={vi.fn(async () => true)}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('tab', { name: /Telas/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Janelas/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Atualizar/i })).toBeTruthy()
    expect(screen.getByText('Monitor 1')).toBeTruthy()
  })

  it('atualiza fontes dinamicamente a cada 2 segundos e via botao de atualizar', async () => {
    let currentSources: Array<{ id: string; name: string; kind: 'screen' | 'window'; width: number; height: number }> = [
      { id: 'screen:1', name: 'Monitor 1', kind: 'screen', width: 1920, height: 1080 },
    ]
    const transport = mockTransport()
    vi.mocked(transport.listScreenSources).mockImplementation(async () => currentSources)

    render(
      <ScreenSharePicker
        transport={transport}
        initialPreset="balanced"
        onClose={vi.fn()}
        onShare={vi.fn(async () => true)}
      />
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('Novo Jogo')).toBeNull()

    // Nova janela surge no sistema operacional
    currentSources = [
      { id: 'screen:1', name: 'Monitor 1', kind: 'screen' as const, width: 1920, height: 1080 },
      { id: 'window:2', name: 'Novo Jogo', kind: 'window' as const, width: 1920, height: 1080 },
    ]

    // Avanca 2 segundos para o polling
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Troca para aba Janelas
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('tab', { name: /Janelas/i }))
    expect(screen.getByText('Novo Jogo')).toBeTruthy()

    // Clica no botao Atualizar
    const refreshBtn = screen.getByRole('button', { name: /Atualizar/i })
    await user.click(refreshBtn)
    expect(transport.listScreenSources).toHaveBeenCalled()
  })
})
