// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSnapshot, VoiceTransport } from '../../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../../voice/preferences'
import { VoiceVideoSettings } from './VoiceVideoSettings'

const snapshot: VoiceSnapshot = {
  status: 'connected', channel: 'geral', muted: false, deafened: false,
  cameraEnabled: false, screenSharing: false, screenHasAudio: null, error: null,
  audioProcessor: { status: 'idle', effective: 'none' },
  participants: [], media: [],
}

/** O teste de microfone devolve um controle (medidor + retorno local), nao um cleanup. */
function micTestHandle() {
  return {
    stop: vi.fn(),
    setMonitor: vi.fn(),
    setMonitorVolume: vi.fn(),
    setOutputDevice: vi.fn(async () => {}),
    isMonitoring: () => false,
  }
}

function mockTransport(): VoiceTransport {
  return {
    join: vi.fn(async () => true), leave: vi.fn(), resumeAudio: vi.fn(async () => true),
    setMuted: vi.fn(), setDeafened: vi.fn(),
    setCameraEnabled: vi.fn(async () => true), setScreenShareEnabled: vi.fn(async () => true),
    listScreenSources: vi.fn(async () => []), captureScreenSourceThumbnail: vi.fn(async () => null),
    setInputDevice: vi.fn(async () => {}), setOutputDevice: vi.fn(async () => {}), setCameraDevice: vi.fn(async () => {}),
    enumerateDevices: vi.fn(async () => ({ inputs: [], outputs: [], cameras: [] })),
    startMicrophoneTest: vi.fn(async () => micTestHandle()), startCameraPreview: vi.fn(async () => () => {}),
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

describe('VoiceVideoSettings', () => {
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

  it('avisa quando o contexto nao for seguro, em vez de deixar os controles mentirem', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    render(<VoiceVideoSettings transport={mockTransport()} snapshot={snapshot} />)

    expect(screen.getByText(/Microfone e câmera bloqueados pelo navegador/i)).toBeTruthy()
    expect(screen.getByText(/o navegador bloqueia dispositivos de mídia/i)).toBeTruthy()
  })

  it('exibe erro no teste de microfone quando falhar por falta de permissao ou contexto', async () => {
    const user = userEvent.setup()
    const transport = mockTransport()
    vi.mocked(transport.startMicrophoneTest).mockRejectedValue(
      new Error('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.'),
    )

    render(<VoiceVideoSettings transport={transport} snapshot={snapshot} />)
    await user.click(screen.getByRole('button', { name: 'Testar' }))

    expect(await screen.findByText('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.')).toBeTruthy()
  })

  /* O retorno local e a funcionalidade que nao existia: o teste antigo so media
     o nivel. Aqui o que se trava e que o controle chega ao grafo vivo — ligar,
     desligar e mudar volume nao podem reabrir o microfone. */
  it('liga o retorno do microfone no grafo vivo, sem reabrir a captura', async () => {
    const user = userEvent.setup()
    const transport = mockTransport()
    const handle = micTestHandle()
    vi.mocked(transport.startMicrophoneTest).mockResolvedValue(handle)

    render(<VoiceVideoSettings transport={transport} snapshot={snapshot} />)
    await user.click(screen.getByRole('button', { name: 'Testar' }))
    expect(transport.startMicrophoneTest).toHaveBeenCalledTimes(1)

    const retorno = await screen.findByRole('switch', { name: /Ouvir minha própria voz/i })
    await user.click(retorno)

    expect(handle.setMonitor).toHaveBeenCalledWith(false)
    // Mexer no retorno nao pode ter reaberto a captura do microfone.
    expect(transport.startMicrophoneTest).toHaveBeenCalledTimes(1)
  })

  it('para a captura ao sair da tela', async () => {
    const user = userEvent.setup()
    const transport = mockTransport()
    const handle = micTestHandle()
    vi.mocked(transport.startMicrophoneTest).mockResolvedValue(handle)

    const view = render(<VoiceVideoSettings transport={transport} snapshot={snapshot} />)
    await user.click(screen.getByRole('button', { name: 'Testar' }))
    await screen.findByRole('switch', { name: /Ouvir minha própria voz/i })

    view.unmount()
    expect(handle.stop).toHaveBeenCalled()
  })
})
