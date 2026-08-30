// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg } from '../protocol'

const screenPlatform = vi.hoisted(() => ({
  tauri: false,
  stop: vi.fn(async () => {}),
  track: { kind: 'video', stop: vi.fn(), contentHint: '' },
  start: vi.fn(),
}))

vi.mock('../platform/screenCapture', () => ({
  isTauriRuntime: () => screenPlatform.tauri,
  listScreenSources: vi.fn(async () => []),
  captureScreenSourceThumbnail: vi.fn(async () => null),
  startNativeScreenCapture: screenPlatform.start,
}))

vi.mock('livekit-client', () => {
  const Track = {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: {
      Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio',
    },
  }
  const RoomEvent = {
    ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected',
    TrackPublished: 'trackPublished', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed',
    TrackUnpublished: 'trackUnpublished', LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished', ActiveSpeakersChanged: 'activeSpeakersChanged',
    ConnectionQualityChanged: 'connectionQualityChanged', Reconnecting: 'reconnecting',
    Reconnected: 'reconnected', MediaDevicesError: 'mediaDevicesError', Disconnected: 'disconnected',
    AudioPlaybackStatusChanged: 'audioPlaybackStatusChanged',
  }

  class Publication {
    trackSid: string
    source: string
    kind: string
    isSubscribed = false
    isMuted = false
    dimensions = { width: 1280, height: 720 }
    track: unknown
    audioTrack: unknown
    videoTrack: unknown
    constructor(id: string, source: string, kind = 'video') {
      this.trackSid = id; this.source = source; this.kind = kind
      const mediaTrack = {
        currentBitrate: 900_000,
        attach: vi.fn(), detach: vi.fn(), getRTCStatsReport: vi.fn(async () => new Map()),
      }
      this.track = mediaTrack
      if (kind === 'video') this.videoTrack = mediaTrack
      else this.audioTrack = mediaTrack
    }
    setSubscribed(value: boolean) { this.isSubscribed = value }
    setVideoQuality = vi.fn()
  }

  class Participant {
    trackPublications = new Map<string, Publication>()
    identity: string
    name: string
    isLocal: boolean
    isSpeaking = false
    isMicrophoneEnabled = true
    isCameraEnabled = false
    isScreenShareEnabled = false
    connectionQuality = 'excellent'
    constructor(identity: string, name: string, local = false) {
      this.identity = identity; this.name = name; this.isLocal = local
    }
    getTrackPublications() { return [...this.trackPublications.values()] }
    getTrackPublication(source: string) {
      return [...this.trackPublications.values()].find((publication) => publication.source === source)
    }
  }

  class Room {
    static instances: Room[] = []
    options: unknown
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    remoteParticipants = new Map<string, Participant>()
    localParticipant = new Participant('self-peer', 'Daniel', true) as Participant & {
      setMicrophoneEnabled(enabled: boolean): Promise<Publication | undefined>
      setCameraEnabled(enabled: boolean): Promise<Publication | undefined>
      setScreenShareEnabled(enabled: boolean): Promise<Publication | undefined>
      publishTrack(track: unknown, options: { source: string }): Promise<Publication>
      unpublishTrack(track: unknown): Promise<Publication | undefined>
    }
    connect = vi.fn(async () => {})
    disconnect = vi.fn(async () => {})
    startAudio = vi.fn(async () => {})
    canPlaybackAudio = true
    switchActiveDevice = vi.fn(async () => true)
    constructor(options: unknown) {
      this.options = options
      this.localParticipant.setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
        this.localParticipant.isMicrophoneEnabled = enabled
        if (!enabled) return undefined
        const publication = new Publication('local-mic', Track.Source.Microphone, Track.Kind.Audio)
        this.localParticipant.trackPublications.set(publication.trackSid, publication)
        return publication
      })
      this.localParticipant.setCameraEnabled = vi.fn(async (enabled: boolean) => {
        this.localParticipant.isCameraEnabled = enabled
        if (!enabled) return undefined
        const publication = new Publication('local-camera', Track.Source.Camera)
        publication.isSubscribed = true
        this.localParticipant.trackPublications.set(publication.trackSid, publication)
        this.emit(RoomEvent.LocalTrackPublished, publication, this.localParticipant)
        return publication
      })
      this.localParticipant.setScreenShareEnabled = vi.fn(async (enabled: boolean) => {
        this.localParticipant.isScreenShareEnabled = enabled
        const existing = this.localParticipant.getTrackPublication(Track.Source.ScreenShare)
        if (!enabled) {
          if (existing) this.localParticipant.trackPublications.delete(existing.trackSid)
          if (existing) this.emit(RoomEvent.LocalTrackUnpublished, existing, this.localParticipant)
          return undefined
        }
        const publication = new Publication('local-screen', Track.Source.ScreenShare)
        publication.isSubscribed = true
        this.localParticipant.trackPublications.set(publication.trackSid, publication)
        this.emit(RoomEvent.LocalTrackPublished, publication, this.localParticipant)
        return publication
      })
      this.localParticipant.publishTrack = vi.fn(async (track: unknown, options: { source: string }) => {
        this.localParticipant.isScreenShareEnabled = true
        const publication = new Publication('local-native-screen', options.source)
        publication.track = track
        publication.videoTrack = track
        publication.isSubscribed = true
        this.localParticipant.trackPublications.set(publication.trackSid, publication)
        this.emit(RoomEvent.LocalTrackPublished, publication, this.localParticipant)
        return publication
      })
      this.localParticipant.unpublishTrack = vi.fn(async (track: unknown) => {
        const publication = [...this.localParticipant.trackPublications.values()]
          .find((candidate) => candidate.track === track)
        if (!publication) return undefined
        this.localParticipant.isScreenShareEnabled = false
        this.localParticipant.trackPublications.delete(publication.trackSid)
        this.emit(RoomEvent.LocalTrackUnpublished, publication, this.localParticipant)
        return publication
      })
      Room.instances.push(this)
    }
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }
  }

  return { Room, RoomEvent, Track, VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 }, Publication, Participant }
})

import { LiveKitTransport } from './LiveKitTransport'

const config = {
  backend: 'livekit' as const, max_peers: 6, camera: true, screen_share: true, screen_audio: true,
}

describe('LiveKitTransport', () => {
  beforeEach(async () => {
    localStorage.clear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
    })
    const sdk = await import('livekit-client') as unknown as { Room: { instances: unknown[] } }
    sdk.Room.instances.length = 0
    screenPlatform.tauri = false
    screenPlatform.stop.mockClear()
    screenPlatform.start.mockReset()
    screenPlatform.start.mockResolvedValue({
      stream: { getTracks: () => [screenPlatform.track] },
      track: screenPlatform.track,
      ended: new Promise<string>(() => {}),
      stop: screenPlatform.stop,
    })
  })

  it('pede grant, conecta com adaptive stream e confirma somente depois do SFU', async () => {
    const sent: ClientMsg[] = []
    const errors: string[] = []
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: (message) => sent.push(message),
      onSpeaking: vi.fn(), onError: (message) => errors.push(message),
    })

    expect(await transport.join('sala')).toBe(true)
    expect(sent).toEqual([{ t: 'voice.join', channel: 'sala' }])
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://26.1.2.3:7880',
      token: 'jwt-que-nao-pode-ser-persistido', expires_at: Date.now() + 60_000,
    })

    await vi.waitFor(() => expect(sent).toContainEqual({ t: 'voice.connected', channel: 'sala' }))
    const sdk = await import('livekit-client') as unknown as { Room: { instances: Array<any> } }
    const room = sdk.Room.instances[0]
    expect(room.options).toMatchObject({ adaptiveStream: true, dynacast: true })
    expect(room.connect).toHaveBeenCalledWith('ws://localhost:7880', 'jwt-que-nao-pode-ser-persistido', { autoSubscribe: false })
    expect(transport.snapshot().status).toBe('connected')
    expect(JSON.stringify(localStorage)).not.toContain('jwt-que-nao-pode-ser-persistido')
    expect(errors).toEqual([])
    transport.destroy()
  })

  it('nao reinicia a mesma call e uma sala antiga nao derruba a nova', async () => {
    const sent: ClientMsg[] = []
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: (message) => sent.push(message),
      onSpeaking: vi.fn(), onError: vi.fn(),
    })

    await transport.join('sala-1')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala-1', url: 'ws://sfu', token: 'primeiro',
      expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; RoomEvent: Record<string, string>
    }
    const firstRoom = sdk.Room.instances[0]
    expect(await transport.join('sala-1')).toBe(true)
    expect(sent.filter((message) => message.t === 'voice.join')).toHaveLength(1)
    expect(firstRoom.disconnect).not.toHaveBeenCalled()

    await transport.join('sala-2')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala-2', url: 'ws://sfu', token: 'segundo',
      expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot()).toMatchObject({ status: 'connected', channel: 'sala-2' }))
    await vi.waitFor(() => expect(sdk.Room.instances).toHaveLength(2))
    const secondRoom = sdk.Room.instances[1]
    await vi.waitFor(() => expect(firstRoom.disconnect).toHaveBeenCalledWith(true))
    expect(secondRoom.disconnect).not.toHaveBeenCalled()

    firstRoom.emit(sdk.RoomEvent.Disconnected)
    expect(transport.snapshot()).toMatchObject({ status: 'connected', channel: 'sala-2' })
    expect(secondRoom.disconnect).not.toHaveBeenCalled()
    transport.destroy()
  })

  it('mantem telas remotas sem assinatura ate clicar em Assistir e limpa no fim', async () => {
    const sent: ClientMsg[] = []
    const errors: string[] = []
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: (message) => sent.push(message), onSpeaking: vi.fn(),
      onError: (message) => errors.push(message),
    })
    await transport.join('sala')
    transport.handleServerMessage({ t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000 })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const room = sdk.Room.instances[0]
    const remote = new sdk.Participant('peer-2', 'Alice')
    const screen = new sdk.Publication('screen-2', sdk.Track.Source.ScreenShare)
    const screenAudio = new sdk.Publication('screen-audio-2', sdk.Track.Source.ScreenShareAudio, 'audio')
    remote.trackPublications.set(screen.trackSid, screen)
    remote.trackPublications.set(screenAudio.trackSid, screenAudio)
    room.remoteParticipants.set(remote.identity, remote)
    room.emit(sdk.RoomEvent.TrackPublished, screenAudio, remote)
    room.emit(sdk.RoomEvent.TrackPublished, screen, remote)

    expect(transport.snapshot().media).toContainEqual(expect.objectContaining({ id: 'screen-2', subscribed: false }))
    expect(screenAudio.isSubscribed).toBe(false)
    transport.setPublicationSubscribed('screen-2', true)
    expect(screen.isSubscribed).toBe(true)
    expect(screenAudio.isSubscribed).toBe(true)
    transport.setPublicationVolume('screen-2', 40)
    transport.setPublicationSubscribed('screen-2', false)
    expect(screenAudio.isSubscribed).toBe(false)

    expect(await transport.setScreenShareEnabled(true, 'balanced')).toBe(true)
    expect(transport.snapshot().screenHasAudio).toBe(false)
    expect(errors).toContain('A fonte escolhida nao forneceu audio; a tela continua ao vivo sem som.')
    expect(await transport.setScreenShareEnabled(false)).toBe(true)
    expect(transport.snapshot().screenSharing).toBe(false)

    transport.leave()
    await vi.waitFor(() => expect(room.disconnect).toHaveBeenCalledWith(true))
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(0)
  })

  it('publica a fonte escolhida pelo seletor do app sem abrir o picker do navegador', async () => {
    screenPlatform.tauri = true
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as { Room: { instances: Array<any> }; Track: any }
    const room = sdk.Room.instances[0]
    expect(await transport.setScreenShareEnabled(true, 'balanced', 'screen:7:0')).toBe(true)
    expect(screenPlatform.start).toHaveBeenCalledWith({
      sourceId: 'screen:7:0', maxWidth: 1920, maxHeight: 1080, fps: 30,
    })
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      screenPlatform.track,
      expect.objectContaining({ source: sdk.Track.Source.ScreenShare }),
    )
    expect(room.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled()
    expect(transport.snapshot().screenSharing).toBe(true)

    expect(await transport.setScreenShareEnabled(false)).toBe(true)
    expect(screenPlatform.stop).toHaveBeenCalled()
    expect(transport.snapshot().screenSharing).toBe(false)
    transport.destroy()
  })

  it('expoe reconexao e recusa grant expirado sem abrir sala', async () => {
    const errors: string[] = []
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: (message) => errors.push(message),
    })
    await transport.join('sala')
    transport.handleServerMessage({ t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'old', expires_at: Date.now() - 1 })
    expect(transport.snapshot().status).toBe('idle')
    expect(errors).toContain('A autorizacao de midia expirou; tente entrar novamente.')
  })
})
