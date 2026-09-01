// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../voice/preferences'
import { VoiceSettings } from './VoiceSettings'

const snapshot: VoiceSnapshot = {
  status: 'connected', channel: 'geral', muted: false, deafened: false,
  cameraEnabled: false, screenSharing: false, screenHasAudio: null, error: null,
  audioProcessor: { status: 'idle', effective: 'none' },
  participants: [], media: [],
}

function mockTransport(): VoiceTransport {
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

describe('VoiceSettings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  })

  it('exibe banner informativo de aviso quando o contexto nao for seguro', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    const transport = mockTransport()
    render(<VoiceSettings open transport={transport} snapshot={snapshot} onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Microfone e câmera bloqueados pelo navegador/i)).toBeTruthy()
    expect(screen.getByText(/Em conexões HTTP remotas, o navegador bloqueia dispositivos de mídia/i)).toBeTruthy()
  })

  it('exibe erro no teste de microfone quando falhar por falta de permissao ou contexto', async () => {
    const user = userEvent.setup()
    const transport = mockTransport()
    vi.mocked(transport.startMicrophoneTest).mockRejectedValue(new Error('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.'))

    render(<VoiceSettings open transport={transport} snapshot={snapshot} onClose={vi.fn()} />)
    const testButton = screen.getByRole('button', { name: 'Testar microfone' })
    await user.click(testButton)

    expect(await screen.findByText('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.')).toBeTruthy()
  })
})