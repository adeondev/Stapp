// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from './protocol'
import { callSounds } from './net/callSounds'
import { useAutoUpdater } from './platform/updater/useAutoUpdater'
import { useVoiceStore } from './stores'
import App from './App'

const connectionMock = vi.hoisted(() => ({
  onMessage: null as ((message: ServerMsg) => void) | null,
}))

const voiceMock = vi.hoisted(() => ({
  listener: null as ((snapshot: any) => void) | null,
  snapshot: null as any,
  transport: null as any,
}))

vi.mock('./net/connection', () => ({
  defaultServerUrl: () => 'ws://127.0.0.1:8787/ws',
  Connection: class {
    token: string | null = null

    constructor(_url: string, handlers: { onMessage(message: ServerMsg): void }) {
      connectionMock.onMessage = handlers.onMessage
    }

    authenticate(token: string) { this.token = token }
    clearAccess() { this.token = null }
    hasAccess() { return this.token !== null }
    send() {}
    close() {}
  },
}))

vi.mock('./voice/VoiceTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./voice/VoiceTransport')>()
  return { ...actual, createVoiceTransport: () => voiceMock.transport }
})

vi.mock('./platform/updater/useAutoUpdater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform/updater/useAutoUpdater')>()
  return {
    ...actual,
    useAutoUpdater: vi.fn(actual.useAutoUpdater),
  }
})

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    connectionMock.onMessage = null
    useVoiceStore.setState({ muted: false, deafened: false, call: null })
    voiceMock.snapshot = {
      status: 'idle', channel: null, muted: false, deafened: false,
      cameraEnabled: false, screenSharing: false, screenHasAudio: null,
      participants: [], media: [], audioProcessor: { status: 'idle', effective: 'none' }, error: null,
    }
    voiceMock.transport = {
      join: vi.fn(async (channel: string) => {
        voiceMock.snapshot = {
          ...voiceMock.snapshot, status: 'connected', channel,
          participants: [{
            peerId: 'peer-deon', name: 'Deon', local: true, speaking: false,
            microphone: true, camera: false, screen: false, quality: 'excellent',
          }],
        }
        voiceMock.listener?.(voiceMock.snapshot)
        return true
      }),
      leave: vi.fn(() => {
        voiceMock.snapshot = { ...voiceMock.snapshot, status: 'idle', channel: null, participants: [] }
        voiceMock.listener?.(voiceMock.snapshot)
      }),
      resumeAudio: vi.fn(async () => true), setMuted: vi.fn(), setDeafened: vi.fn(),
      setCameraEnabled: vi.fn(async () => true), setScreenShareEnabled: vi.fn(async () => true),
      listScreenSources: vi.fn(async () => []), captureScreenSourceThumbnail: vi.fn(async () => null),
      setInputDevice: vi.fn(async () => {}), setOutputDevice: vi.fn(async () => {}),
      setCameraDevice: vi.fn(async () => {}), enumerateDevices: vi.fn(async () => ({ inputs: [], outputs: [], cameras: [] })),
      startMicrophoneTest: vi.fn(async () => () => {}), startCameraPreview: vi.fn(async () => () => {}),
      setPublicationSubscribed: vi.fn(), getVoiceVolume: vi.fn(() => 100), setVoiceVolume: vi.fn(),
      setVoiceMuted: vi.fn(), getScreenShareVolume: vi.fn(() => 100),
      setScreenShareVolume: vi.fn(), setScreenShareMuted: vi.fn(), attachMedia: vi.fn(() => () => {}),
      snapshot: () => voiceMock.snapshot,
      subscribe: vi.fn((listener: (snapshot: any) => void) => {
        voiceMock.listener = listener; listener(voiceMock.snapshot); return () => { voiceMock.listener = null }
      }),
      getPreferences: () => ({
        inputDeviceId: '', outputDeviceId: '', cameraDeviceId: '', inputMode: 'voice_activity',
        inputVolume: 100, outputVolume: 100, echoCancellation: true, autoGainControl: true,
        noiseMode: 'standard', automaticSensitivity: true, sensitivity: -50, pushToTalkKey: '',
        cameraQuality: '720p', screenPreset: 'balanced', shareAudio: true,
        showSelf: true, showVideoOffParticipants: true,
      }),
      updatePreferences: vi.fn(async () => {}),
      diagnosticReport: vi.fn(async () => ({ generatedAt: '', backend: 'mock', status: 'connected' })),
      handleServerMessage: vi.fn(), destroy: vi.fn(),
    }
    const server = {
      url: 'ws://127.0.0.1:8787/ws',
      name: 'Stapp local',
      username: 'deon',
      lastUsed: 1,
    }
    localStorage.setItem('stapp.servers.v2', JSON.stringify([server]))
    localStorage.setItem('stapp.last-server.v2', server.url)
  })

  it('mantem a interface montada quando a sessao e restaurada', async () => {
    render(<App />)
    expect(connectionMock.onMessage).not.toBeNull()

    act(() => connectionMock.onMessage?.({
      t: 'welcome',
      self_peer_id: 'peer-deon',
      self_user_id: 'user-deon',
      server_name: 'Stapp local',
      channels: [],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon',
        username: 'deon',
        display_name: 'Deon',
        accent: 'blue',
        bio: '',
        has_avatar: false,
        updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 },
      voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    expect(await screen.findByText('Nada por aqui ainda.')).toBeTruthy()
  })

  it('abre sala de voz sem selecionar texto, oculta membros e minimiza ao navegar', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => connectionMock.onMessage?.({
      t: 'welcome', self_peer_id: 'peer-deon', self_user_id: 'user-deon', server_name: 'Stapp local',
      channels: [
        { id: 'geral', name: 'geral', kind: 'text' },
        { id: 'voz', name: 'Sala de voz', kind: 'voice' },
      ],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon', username: 'deon', display_name: 'Deon', accent: 'blue',
        bio: '', has_avatar: false, updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 }, voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    await user.click(screen.getByRole('button', { name: 'Stapp local' }))
    expect(screen.getByRole('button', { name: /geral/ }).className).toContain('is-active')
    expect(screen.getByRole('complementary', { name: 'Membros do servidor' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Sala de voz/ }))
    expect(await screen.findByRole('region', { name: 'Chamada em Sala de voz' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /geral/ }).className).not.toContain('is-active')
    expect(screen.queryByRole('complementary', { name: 'Membros do servidor' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /geral/ }))
    expect(screen.queryByRole('region', { name: 'Chamada em Sala de voz' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Chamada ativa em Sala de voz' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Expandir chamada' }))
    const reopened = screen.getByRole('region', { name: 'Chamada em Sala de voz' })
    await user.click(within(reopened).getByRole('button', { name: 'desconectar' }))
    expect(screen.getByRole('button', { name: /geral/ }).className).toContain('is-active')
    expect(screen.getByRole('complementary', { name: 'Membros do servidor' })).toBeTruthy()
  })

  it('abre a central de configuracoes pelo botao de engrenagem da conta', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => connectionMock.onMessage?.({
      t: 'welcome', self_peer_id: 'peer-deon', self_user_id: 'user-deon', server_name: 'Stapp local',
      channels: [
        { id: 'geral', name: 'geral', kind: 'text' },
      ],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon', username: 'deon', display_name: 'Deon', accent: 'blue',
        bio: 'Dev do Stapp', has_avatar: false, updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 }, voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    const gearBtn = screen.getByRole('button', { name: 'Configurações' })
    await user.click(gearBtn)

    expect(screen.getByText('Stapp Desktop v0.1.0-beta.5')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Minha Conta/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Voz & Vídeo/i })).toBeTruthy()
  })

  it('dispara ringtone ao receber chamada entrante e interrompe som ao encerrar', async () => {
    const playRingtoneSpy = vi.spyOn(callSounds, 'playRingtone')
    const stopLoopSpy = vi.spyOn(callSounds, 'stopLoop')

    render(<App />)
    act(() => connectionMock.onMessage?.({
      t: 'welcome', self_peer_id: 'peer-deon', self_user_id: 'user-deon', server_name: 'Stapp local',
      channels: [{ id: 'geral', name: 'geral', kind: 'text' }],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 }, voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    act(() => connectionMock.onMessage?.({
      t: 'call.incoming',
      user_id: 'user-alice',
      username: 'Alice',
    }))

    expect(playRingtoneSpy).toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'chamada' })).toBeTruthy()
    expect(screen.getByText('esta ligando')).toBeTruthy()

    act(() => connectionMock.onMessage?.({
      t: 'call.ended',
      user_id: 'user-alice',
      reason: 'declined',
    }))

    expect(stopLoopSpy).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: 'chamada' })).toBeNull()

    playRingtoneSpy.mockRestore()
    stopLoopSpy.mockRestore()
  })

  it('exibe a tela de splash no desktop enquanto o bootstrap esta em checking', () => {
    vi.mocked(useAutoUpdater).mockReturnValueOnce({
      isDesktop: true,
      bootPhase: 'checking',
      currentVersion: '0.1.0',
      availableUpdate: null,
      isChecking: true,
      isDownloading: false,
      progress: null,
      isReadyToRelaunch: false,
      error: null,
      isModalOpen: false,
      mandatoryRequirement: null,
      channel: 'stable',
      setChannel: vi.fn(),
      checkForUpdates: vi.fn(async () => null),
      enforceMandatoryVersion: vi.fn(),
      startUpdate: vi.fn(async () => {}),
      relaunch: vi.fn(async () => {}),
      dismissModal: vi.fn(),
    })

    render(<App />)

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Procurando atualizações...')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Conectar' })).toBeNull()
  })

  it('exibe UpdateModal sobre a splash quando ha atualizacao pendente sem interagir com tela principal', () => {
    vi.mocked(useAutoUpdater).mockReturnValueOnce({
      isDesktop: true,
      bootPhase: 'checking',
      currentVersion: '0.1.0',
      availableUpdate: {
        version: '0.2.0',
        currentVersion: '0.1.0',
        body: 'Nova versão disponível!',
      },
      isChecking: false,
      isDownloading: false,
      progress: null,
      isReadyToRelaunch: false,
      error: null,
      isModalOpen: true,
      mandatoryRequirement: null,
      channel: 'stable',
      setChannel: vi.fn(),
      checkForUpdates: vi.fn(async () => null),
      enforceMandatoryVersion: vi.fn(),
      startUpdate: vi.fn(async () => {}),
      relaunch: vi.fn(async () => {}),
      dismissModal: vi.fn(),
    })

    render(<App />)

    // Splash screen e UpdateModal estão visíveis
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Atualização Disponível')).toBeTruthy()
    // Tela principal não está montada
    expect(screen.queryByRole('button', { name: 'Conectar' })).toBeNull()
    expect(screen.queryByRole('region', { name: /chamada/i })).toBeNull()
  })

  it('abre direto na tela de conexao sem passar pelo splash em ambiente web', () => {
    render(<App />)

    expect(screen.queryByText('Procurando atualizações...')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Boas-vindas de volta!' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
  })

  it('preserva preferencias de mudo e ensurdecer ao sair e entrar em outra chamada', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => connectionMock.onMessage?.({
      t: 'welcome', self_peer_id: 'peer-deon', self_user_id: 'user-deon', server_name: 'Stapp local',
      channels: [
        { id: 'geral', name: 'geral', kind: 'text' },
        { id: 'voz-1', name: 'Sala de voz 1', kind: 'voice' },
        { id: 'voz-2', name: 'Sala de voz 2', kind: 'voice' },
      ],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon', username: 'deon', display_name: 'Deon', accent: 'blue',
        bio: '', has_avatar: false, updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 }, voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    // Seleciona o servidor para exibir os canais
    await user.click(screen.getByRole('button', { name: 'Stapp local' }))

    // Entra na primeira sala de voz
    await user.click(screen.getByRole('button', { name: /Sala de voz 1/ }))
    expect(await screen.findByRole('region', { name: 'Chamada em Sala de voz 1' })).toBeTruthy()

    // Muta pelo dock do CallStage
    await user.click(screen.getByRole('button', { name: 'desligar microfone' }))
    expect(useVoiceStore.getState().muted).toBe(true)

    // Sai da primeira chamada
    const callRegion1 = screen.getByRole('region', { name: 'Chamada em Sala de voz 1' })
    await user.click(within(callRegion1).getByRole('button', { name: 'desconectar' }))
    expect(screen.queryByRole('region', { name: 'Chamada em Sala de voz 1' })).toBeNull()

    // O estado de mudo continua preservado na raiz do store
    expect(useVoiceStore.getState().muted).toBe(true)

    // Entra na segunda sala de voz
    await user.click(screen.getByRole('button', { name: /Sala de voz 2/ }))
    expect(await screen.findByRole('region', { name: 'Chamada em Sala de voz 2' })).toBeTruthy()

    // A preferência foi mantida na nova chamada
    expect(useVoiceStore.getState().muted).toBe(true)
    expect(screen.getByRole('button', { name: 'ligar microfone' })).toBeTruthy()
  })

  it('sincroniza mudo e ensurdecer entre CallStage, AccountBar e CallMiniPip', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => connectionMock.onMessage?.({
      t: 'welcome', self_peer_id: 'peer-deon', self_user_id: 'user-deon', server_name: 'Stapp local',
      channels: [
        { id: 'geral', name: 'geral', kind: 'text' },
        { id: 'voz', name: 'Sala de voz', kind: 'voice' },
      ],
      users: [{ user_id: 'user-deon', username: 'deon' }],
      directory: [{ user_id: 'user-deon', username: 'deon' }],
      profiles: [{
        user_id: 'user-deon', username: 'deon', display_name: 'Deon', accent: 'blue',
        bio: '', has_avatar: false, updated_at: 1,
      }],
      voice: { backend: 'mesh', ice_servers: [], max_peers: 6 }, voice_peers: [],
      limits: { max_upload_bytes: 15 * 1024 * 1024, max_text_chars: 4000 },
    }))

    // Seleciona o servidor para exibir os canais
    await user.click(screen.getByRole('button', { name: 'Stapp local' }))

    // Entra na chamada
    await user.click(screen.getByRole('button', { name: /Sala de voz/ }))
    expect(await screen.findByRole('region', { name: 'Chamada em Sala de voz' })).toBeTruthy()

    // Clicar em Mudo no CallStage reflete no store e no AccountBar
    await user.click(screen.getByRole('button', { name: 'desligar microfone' }))
    expect(useVoiceStore.getState().muted).toBe(true)

    // Navega para o canal geral para exibir o mini-player flutuante (CallMiniPip)
    await user.click(screen.getByRole('button', { name: /geral/ }))
    const minipip = await screen.findByRole('complementary', { name: 'Chamada ativa em Sala de voz' })
    expect(minipip).toBeTruthy()

    // Clica em ensurdecer no mini-player
    const deafenBtn = within(minipip).getByRole('button', { name: /ensurdecer/i })
    await user.click(deafenBtn)

    // O ensurdecimento e forçado e reflete no store global
    expect(useVoiceStore.getState().deafened).toBe(true)
    expect(useVoiceStore.getState().muted).toBe(true)
  })
})

