// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationSound } from '../net/notifications'
import type { Profile } from '../protocol'
import type { VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES } from '../voice/preferences'
import { SettingsModal } from './SettingsModal'

const mockProfile: Profile = {
  user_id: 'usr_test_123',
  username: 'daniel',
  display_name: 'Daniel DEV',
  accent: 'blue',
  bio: 'Construindo o Stapp.',
  has_avatar: false,
  updated_at: 1000,
}

const snapshot: VoiceSnapshot = {
  status: 'connected',
  channel: 'geral',
  muted: false,
  deafened: false,
  cameraEnabled: false,
  screenSharing: false,
  screenHasAudio: null,
  error: null,
  audioProcessor: { status: 'idle', effective: 'none' },
  participants: [],
  media: [],
}

function mockTransport(): VoiceTransport {
  return {
    join: vi.fn(async () => true),
    leave: vi.fn(),
    resumeAudio: vi.fn(async () => true),
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCameraEnabled: vi.fn(async () => true),
    setScreenShareEnabled: vi.fn(async () => true),
    listScreenSources: vi.fn(async () => []),
    captureScreenSourceThumbnail: vi.fn(async () => null),
    setInputDevice: vi.fn(async () => {}),
    setOutputDevice: vi.fn(async () => {}),
    setCameraDevice: vi.fn(async () => {}),
    enumerateDevices: vi.fn(async () => ({ inputs: [], outputs: [], cameras: [] })),
    startMicrophoneTest: vi.fn(async () => () => {}),
    startCameraPreview: vi.fn(async () => () => {}),
    setPublicationSubscribed: vi.fn(),
    getVoiceVolume: vi.fn(() => 100),
    setVoiceVolume: vi.fn(),
    setVoiceMuted: vi.fn(),
    getScreenShareVolume: vi.fn(() => 100),
    setScreenShareVolume: vi.fn(),
    setScreenShareMuted: vi.fn(),
    attachMedia: vi.fn(() => () => {}),
    snapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    getPreferences: () => ({ ...DEFAULT_VOICE_PREFERENCES }),
    updatePreferences: vi.fn(async () => {}),
    diagnosticReport: vi.fn(async () => ({
      generatedAt: '',
      backend: 'mock',
      status: 'connected' as const,
    })),
    handleServerMessage: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('SettingsModal', () => {
  let writeTextMock = vi.fn(async () => {})

  beforeEach(() => {
    writeTextMock = vi.fn(async () => {})
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza abas e abre por padrão em Minha Conta', () => {
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
      />
    )

    expect(screen.getByRole('button', { name: /Minha Conta/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Voz & Vídeo/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Aparência/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Notificações & Sons/i })).toBeTruthy()

    expect(screen.getByText('Daniel DEV')).toBeTruthy()
    expect(screen.getByText('@daniel')).toBeTruthy()
    expect(screen.getByText(/usr_test_123/)).toBeTruthy()
  })

  it('permite alternar entre as abas e atualiza títulos', async () => {
    const user = userEvent.setup()
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
      />
    )

    // Clica em Aparência
    await user.click(screen.getByRole('button', { name: /Aparência/i }))
    expect(screen.getByRole('heading', { level: 2, name: /Aparência & Temas/i })).toBeTruthy()
    expect(screen.getByText(/Tokens Semânticos de Superfície/i)).toBeTruthy()
    expect(screen.getByText('--bg-app')).toBeTruthy()

    // Clica em Notificações & Sons
    await user.click(screen.getByRole('button', { name: /Notificações & Sons/i }))
    expect(screen.getByRole('heading', { level: 2, name: /Notificações & Sons/i })).toBeTruthy()
    expect(screen.getByText('Volume de Notificações')).toBeTruthy()
  })

  it('chama som de teste ao clicar no botão na aba de Notificações', async () => {
    const user = userEvent.setup()
    const playSpy = vi.spyOn(notificationSound, 'play').mockImplementation(() => {})

    render(
      <SettingsModal
        isOpen
        initialTab="notifications"
        onClose={vi.fn()}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
      />
    )

    const testBtn = screen.getByRole('button', { name: /Ouvir som de teste/i })
    await user.click(testBtn)

    expect(playSpy).toHaveBeenCalled()
  })

  it('copia o User ID para o clipboard na aba de Minha Conta', async () => {
    const user = userEvent.setup()
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText')

    render(
      <SettingsModal
        isOpen
        initialTab="account"
        onClose={vi.fn()}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
      />
    )

    const copyBtn = screen.getByTitle(/Clique para copiar seu User ID/i)
    await user.click(copyBtn)

    expect(writeSpy).toHaveBeenCalledWith('usr_test_123')
  })

  it('executa fechamento ao teclar ESC e ao clicar no botão de fechar', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <SettingsModal
        isOpen
        onClose={onClose}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
      />
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    const closeBtn = screen.getByLabelText(/Fechar configurações/i)
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('integra controles de voz e vídeo na aba Voz & Vídeo', async () => {
    const user = userEvent.setup()
    const transport = mockTransport()

    render(
      <SettingsModal
        isOpen
        initialTab="voice"
        onClose={vi.fn()}
        profile={mockProfile}
        avatarBase="http://localhost:8080"
        transport={transport}
        snapshot={snapshot}
      />
    )

    expect(screen.getByRole('heading', { level: 2, name: /Voz & Vídeo/i })).toBeTruthy()
    const testMicBtn = screen.getByRole('button', { name: /Testar microfone/i })
    await user.click(testMicBtn)
    expect(transport.startMicrophoneTest).toHaveBeenCalled()
  })
})
