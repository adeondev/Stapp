// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from './protocol'
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

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    connectionMock.onMessage = null
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
    }))

    await user.click(screen.getByRole('button', { name: 'Stapp local' }))
    expect(screen.getByRole('button', { name: /geral/ }).className).toContain('is-active')
    expect(screen.getByRole('heading', { name: /Membros/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Sala de voz/ }))
    expect(await screen.findByRole('region', { name: 'Chamada em Sala de voz' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /geral/ }).className).not.toContain('is-active')
    expect(screen.queryByRole('heading', { name: /Membros/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /geral/ }))
    expect(screen.queryByRole('region', { name: 'Chamada em Sala de voz' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Chamada ativa em Sala de voz' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Expandir chamada' }))
    const reopened = screen.getByRole('region', { name: 'Chamada em Sala de voz' })
    await user.click(within(reopened).getByRole('button', { name: 'desconectar' }))
    expect(screen.getByRole('button', { name: /geral/ }).className).toContain('is-active')
    expect(screen.getByRole('heading', { name: /Membros/ })).toBeTruthy()
  })
})
