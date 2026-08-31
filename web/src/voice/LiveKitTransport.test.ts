// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg } from '../protocol'

const screenPlatform = vi.hoisted(() => ({
  tauri: false,
  stop: vi.fn(async () => {}),
  track: { kind: 'video', stop: vi.fn(), contentHint: '' },
  audioTrack: { kind: 'audio', stop: vi.fn() },
  browserStop: vi.fn(async () => {}),
  browserStart: vi.fn(),
  rnnoiseFail: false,
  start: vi.fn(),
}))

vi.mock('../platform/screenCapture', () => ({
  isTauriRuntime: () => screenPlatform.tauri,
  listScreenSources: vi.fn(async () => []),
  captureScreenSourceThumbnail: vi.fn(async () => null),
  startNativeScreenCapture: screenPlatform.start,
  startBrowserScreenCapture: screenPlatform.browserStart,
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
    TrackMuted: 'trackMuted', TrackUnmuted: 'trackUnmuted',
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
        kind,
        currentBitrate: 900_000,
        attach: vi.fn(), detach: vi.fn(), getRTCStatsReport: vi.fn(async () => new Map()),
        setProcessor: vi.fn(async (processor: { name?: string }) => {
          if (screenPlatform.rnnoiseFail && processor.name === 'stapp-rnnoise') {
            throw new Error('WASM RNNoise falhou')
          }
        }),
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
        const audio = options.source === Track.Source.ScreenShareAudio
        if (!audio) this.localParticipant.isScreenShareEnabled = true
        const publication = new Publication(
          audio ? 'local-native-screen-audio' : 'local-native-screen',
          options.source,
          audio ? Track.Kind.Audio : Track.Kind.Video,
        )
        publication.track = track
        if (audio) publication.audioTrack = track
        else publication.videoTrack = track
        publication.isSubscribed = true
        this.localParticipant.trackPublications.set(publication.trackSid, publication)
        this.emit(RoomEvent.LocalTrackPublished, publication, this.localParticipant)
        return publication
      })
      this.localParticipant.unpublishTrack = vi.fn(async (track: unknown) => {
        const publication = [...this.localParticipant.trackPublications.values()]
          .find((candidate) => candidate.track === track)
        if (!publication) return undefined
        if (publication.source === Track.Source.ScreenShare) {
          this.localParticipant.isScreenShareEnabled = false
        }
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

  return {
    Room, RoomEvent, Track, VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 }, Publication, Participant,
    AudioPresets: { musicHighQualityStereo: { maxBitrate: 128_000 } },
  }
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
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn(async () => {}),
    })
    const sdk = await import('livekit-client') as unknown as { Room: { instances: unknown[] } }
    sdk.Room.instances.length = 0
    screenPlatform.tauri = false
    screenPlatform.rnnoiseFail = false
    screenPlatform.stop.mockClear()
    screenPlatform.browserStop.mockClear()
    screenPlatform.start.mockReset()
    screenPlatform.browserStart.mockReset()
    screenPlatform.start.mockResolvedValue({
      stream: { getTracks: () => [screenPlatform.track] },
      track: screenPlatform.track,
      hasAudio: false,
      audioError: undefined,
      ended: new Promise<string>(() => {}),
      stop: screenPlatform.stop,
    })
    screenPlatform.browserStart.mockResolvedValue({
      stream: { id: 'browser-stream', getTracks: () => [screenPlatform.track] },
      track: screenPlatform.track,
      hasAudio: false,
      audioError: 'a fonte escolhida nao forneceu audio',
      audioValidation: undefined,
      ended: new Promise<string>(() => {}),
      stop: screenPlatform.browserStop,
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
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://26.1.2.3:7880',
      token: 'grant-duplicado', expires_at: Date.now() + 60_000,
    })

    await vi.waitFor(() => expect(sent).toContainEqual({ t: 'voice.connected', channel: 'sala' }))
    const sdk = await import('livekit-client') as unknown as { Room: { instances: Array<any> } }
    const room = sdk.Room.instances[0]
    expect(sdk.Room.instances).toHaveLength(1)
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
    room.remoteParticipants.set(remote.identity, remote)
    room.emit(sdk.RoomEvent.TrackPublished, screen, remote)

    expect(transport.snapshot().media).toContainEqual(expect.objectContaining({ id: 'screen-2', subscribed: false }))
    expect(screenAudio.isSubscribed).toBe(false)
    transport.setPublicationSubscribed('screen-2', true)
    expect(screen.isSubscribed).toBe(true)

    // O audio pode ser publicado depois do clique no video, especialmente ao reentrar.
    remote.trackPublications.set(screenAudio.trackSid, screenAudio)
    room.emit(sdk.RoomEvent.TrackPublished, screenAudio, remote)
    expect(screenAudio.isSubscribed).toBe(true)
    transport.setScreenShareVolume('peer-2', 40)
    transport.setPublicationSubscribed('screen-2', false)
    expect(screenAudio.isSubscribed).toBe(false)

    expect(await transport.setScreenShareEnabled(true, { preset: 'balanced' })).toBe(true)
    expect(transport.snapshot().screenHasAudio).toBe(false)
    expect(screenPlatform.browserStart).toHaveBeenCalledWith(expect.objectContaining({
      includeAudio: true,
    }))
    expect(errors).toContain('A tela continua ao vivo sem som: a fonte escolhida nao forneceu audio.')
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
    expect(await transport.setScreenShareEnabled(true, { preset: 'balanced', sourceId: 'screen:7:0' })).toBe(true)
    expect(screenPlatform.start).toHaveBeenCalledWith({
      sourceId: 'screen:7:0', maxWidth: 1920, maxHeight: 1080, fps: 30, includeAudio: true,
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

  it('publica o audio nativo separado e desmonta as duas faixas', async () => {
    screenPlatform.tauri = true
    screenPlatform.start.mockResolvedValueOnce({
      stream: { getTracks: () => [screenPlatform.track, screenPlatform.audioTrack] },
      track: screenPlatform.track,
      audioTrack: screenPlatform.audioTrack,
      hasAudio: true,
      audioError: undefined,
      ended: new Promise<string>(() => {}),
      stop: screenPlatform.stop,
    })
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
    expect(await transport.setScreenShareEnabled(true, {
      preset: 'balanced', sourceId: 'window:9:0', includeAudio: true,
    })).toBe(true)
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      screenPlatform.audioTrack,
      expect.objectContaining({ source: sdk.Track.Source.ScreenShareAudio }),
    )
    expect(transport.snapshot().screenHasAudio).toBe(true)

    expect(await transport.setScreenShareEnabled(false)).toBe(true)
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(screenPlatform.audioTrack)
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(screenPlatform.track)
    expect(screenPlatform.stop).toHaveBeenCalled()
    transport.destroy()
  })

  it('reaplica ensurdecimento em quem entra depois e em novos anexos', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))
    transport.setDeafened(true)

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const room = sdk.Room.instances[0]
    const newcomer = new sdk.Participant('peer-new', 'Nova pessoa')
    const microphone = new sdk.Publication('mic-new', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    newcomer.trackPublications.set(microphone.trackSid, microphone)
    room.remoteParticipants.set(newcomer.identity, newcomer)
    room.emit(sdk.RoomEvent.TrackSubscribed, microphone.audioTrack, microphone, newcomer)

    const audio = document.querySelector<HTMLAudioElement>('audio[data-stapp-voice="mic-new"]')
    expect(audio?.muted).toBe(true)
    audio?.dispatchEvent(new Event('play'))
    expect(audio?.muted).toBe(true)
    if (audio) audio.muted = false
    room.emit(sdk.RoomEvent.ParticipantDisconnected, { identity: 'outra-pessoa' })
    expect(audio?.muted).toBe(true)
    transport.destroy()
  })

  it('mantem voz e audio da transmissao independentes durante toda a call', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const room = sdk.Room.instances[0]
    const remote = new sdk.Participant('peer-volume', 'Volume')
    const microphone = new sdk.Publication('mic-volume', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    const screenAudio = new sdk.Publication('screen-volume', sdk.Track.Source.ScreenShareAudio, sdk.Track.Kind.Audio)
    remote.trackPublications.set(microphone.trackSid, microphone)
    remote.trackPublications.set(screenAudio.trackSid, screenAudio)
    room.remoteParticipants.set(remote.identity, remote)
    room.emit(sdk.RoomEvent.TrackSubscribed, microphone.audioTrack, microphone, remote)
    room.emit(sdk.RoomEvent.TrackSubscribed, screenAudio.audioTrack, screenAudio, remote)

    transport.setVoiceVolume(remote.identity, 35)
    transport.setScreenShareVolume(remote.identity, 0)
    expect(document.querySelector<HTMLAudioElement>('audio[data-stapp-voice="mic-volume"]')?.volume).toBeCloseTo(0.35)
    expect(document.querySelector<HTMLAudioElement>('audio[data-stapp-voice="screen-volume"]')?.volume).toBe(0)
    expect(transport.getVoiceVolume(remote.identity)).toBe(35)
    expect(transport.getScreenShareVolume(remote.identity)).toBe(0)

    transport.setVoiceMuted(remote.identity, true)
    transport.setScreenShareMuted(remote.identity, false)
    expect(transport.getVoiceVolume(remote.identity)).toBe(0)
    expect(transport.getScreenShareVolume(remote.identity)).toBe(100)
    transport.setVoiceMuted(remote.identity, false)
    expect(transport.getVoiceVolume(remote.identity)).toBe(35)

    transport.leave()
    expect(transport.getVoiceVolume(remote.identity)).toBe(35)
    expect(transport.getScreenShareVolume(remote.identity)).toBe(100)
    transport.destroy()
    expect(transport.getVoiceVolume(remote.identity)).toBe(100)
    expect(transport.getScreenShareVolume(remote.identity)).toBe(100)
  })

  it('substitui microfone republicado sem tocar duas copias e limpa ao desconectar', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const room = sdk.Room.instances[0]
    const remote = new sdk.Participant('peer-republish', 'Alice')
    const first = new sdk.Publication('mic-old', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    const replacement = new sdk.Publication('mic-new', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    remote.trackPublications.set(first.trackSid, first)
    room.remoteParticipants.set(remote.identity, remote)
    room.emit(sdk.RoomEvent.TrackSubscribed, first.audioTrack, first, remote)
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(1)

    remote.trackPublications.set(replacement.trackSid, replacement)
    room.emit(sdk.RoomEvent.TrackSubscribed, replacement.audioTrack, replacement, remote)
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(1)
    expect(document.querySelector('audio[data-stapp-voice="mic-new"]')).toBeTruthy()
    expect(first.audioTrack.detach).toHaveBeenCalled()

    const firstScreen = new sdk.Publication('screen-audio-old', sdk.Track.Source.ScreenShareAudio, sdk.Track.Kind.Audio)
    const replacementScreen = new sdk.Publication('screen-audio-new', sdk.Track.Source.ScreenShareAudio, sdk.Track.Kind.Audio)
    remote.trackPublications.set(firstScreen.trackSid, firstScreen)
    room.emit(sdk.RoomEvent.TrackSubscribed, firstScreen.audioTrack, firstScreen, remote)
    remote.trackPublications.set(replacementScreen.trackSid, replacementScreen)
    room.emit(sdk.RoomEvent.TrackSubscribed, replacementScreen.audioTrack, replacementScreen, remote)
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(2)
    expect(document.querySelector('audio[data-stapp-voice="screen-audio-new"]')).toBeTruthy()
    expect(firstScreen.audioTrack.detach).toHaveBeenCalled()

    room.remoteParticipants.delete(remote.identity)
    room.emit(sdk.RoomEvent.ParticipantDisconnected, remote)
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(0)
    transport.destroy()
  })

  it('zera voz e transmissao antigas antes de tocar a sessao reentrada', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const enter = async (token: string) => {
      await transport.join('sala')
      transport.handleServerMessage({
        t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token, expires_at: Date.now() + 60_000,
      })
      await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))
      return sdk.Room.instances[sdk.Room.instances.length - 1]
    }

    const firstRoom = await enter('first')
    const firstRemote = new sdk.Participant('peer-session', 'Alice')
    const firstMic = new sdk.Publication('mic-session-old', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    const firstScreen = new sdk.Publication('screen-session-old', sdk.Track.Source.ScreenShareAudio, sdk.Track.Kind.Audio)
    firstRemote.trackPublications.set(firstMic.trackSid, firstMic)
    firstRemote.trackPublications.set(firstScreen.trackSid, firstScreen)
    firstRoom.remoteParticipants.set(firstRemote.identity, firstRemote)
    firstRoom.emit(sdk.RoomEvent.TrackSubscribed, firstMic.audioTrack, firstMic, firstRemote)
    firstRoom.emit(sdk.RoomEvent.TrackSubscribed, firstScreen.audioTrack, firstScreen, firstRemote)
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(2)
    transport.setVoiceVolume(firstRemote.identity, 37)
    transport.setScreenShareVolume(firstRemote.identity, 0)

    transport.leave()
    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(0)
    expect(firstMic.audioTrack.detach).toHaveBeenCalled()
    expect(firstScreen.audioTrack.detach).toHaveBeenCalled()
    expect(transport.getVoiceVolume(firstRemote.identity)).toBe(37)
    expect(transport.getScreenShareVolume(firstRemote.identity)).toBe(0)

    const secondRoom = await enter('second')
    const secondRemote = new sdk.Participant('peer-session', 'Alice')
    const secondMic = new sdk.Publication('mic-session-new', sdk.Track.Source.Microphone, sdk.Track.Kind.Audio)
    const secondScreen = new sdk.Publication('screen-session-new', sdk.Track.Source.ScreenShareAudio, sdk.Track.Kind.Audio)
    secondRemote.trackPublications.set(secondMic.trackSid, secondMic)
    secondRemote.trackPublications.set(secondScreen.trackSid, secondScreen)
    secondRoom.remoteParticipants.set(secondRemote.identity, secondRemote)
    secondRoom.emit(sdk.RoomEvent.TrackSubscribed, secondMic.audioTrack, secondMic, secondRemote)
    secondRoom.emit(sdk.RoomEvent.TrackSubscribed, secondScreen.audioTrack, secondScreen, secondRemote)

    expect(document.querySelectorAll('audio[data-stapp-voice]')).toHaveLength(2)
    expect(document.querySelector('audio[data-stapp-voice="mic-session-old"]')).toBeNull()
    expect(document.querySelector('audio[data-stapp-voice="screen-session-old"]')).toBeNull()
    expect(document.querySelector<HTMLAudioElement>('audio[data-stapp-voice="mic-session-new"]')?.volume).toBeCloseTo(0.37)
    expect(document.querySelector<HTMLAudioElement>('audio[data-stapp-voice="screen-session-new"]')?.volume).toBe(0)
    transport.destroy()
    expect(transport.getVoiceVolume(firstRemote.identity)).toBe(100)
    expect(transport.getScreenShareVolume(firstRemote.identity)).toBe(100)
  })

  it('remove camera mutada da grade e devolve quando ela reabre', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))

    const sdk = await import('livekit-client') as unknown as {
      Room: { instances: Array<any> }; Participant: new (id: string, name: string) => any
      Publication: new (id: string, source: string, kind?: string) => any; RoomEvent: Record<string, string>; Track: any
    }
    const room = sdk.Room.instances[0]
    const remote = new sdk.Participant('peer-camera', 'Camera')
    const camera = new sdk.Publication('camera-new', sdk.Track.Source.Camera)
    remote.trackPublications.set(camera.trackSid, camera)
    room.remoteParticipants.set(remote.identity, remote)
    room.emit(sdk.RoomEvent.TrackPublished, camera, remote)
    expect(transport.snapshot().media).toContainEqual(expect.objectContaining({ id: 'camera-new' }))

    camera.isMuted = true
    room.emit(sdk.RoomEvent.TrackMuted, camera, remote)
    expect(transport.snapshot().media).not.toContainEqual(expect.objectContaining({ id: 'camera-new' }))
    camera.isMuted = false
    room.emit(sdk.RoomEvent.TrackUnmuted, camera, remote)
    expect(transport.snapshot().media).toContainEqual(expect.objectContaining({ id: 'camera-new' }))
    transport.destroy()
  })

  it('preserva RNNoise no fallback e tenta novamente ao trocar o microfone', async () => {
    localStorage.setItem('stapp.voice.preferences.v1', JSON.stringify({ noiseMode: 'enhanced' }))
    screenPlatform.rnnoiseFail = true
    const errors: string[] = []
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: (message) => errors.push(message),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))
    expect(errors).toEqual([])
    expect(transport.snapshot().audioProcessor).toMatchObject({
      status: 'fallback', effective: 'standard', error: 'WASM RNNoise falhou',
    })
    expect(JSON.parse(localStorage.getItem('stapp.voice.preferences.v1') ?? '{}')).toMatchObject({
      noiseMode: 'enhanced',
    })
    expect(await transport.diagnosticReport()).toMatchObject({
      audioProcessor: 'stapp-voice-processing', audioProcessorError: 'WASM RNNoise falhou',
    })

    screenPlatform.rnnoiseFail = false
    await transport.setInputDevice('microfone-novo')
    expect(await transport.diagnosticReport()).toMatchObject({ audioProcessor: 'stapp-rnnoise' })
    expect(transport.snapshot().audioProcessor).toMatchObject({ status: 'active', effective: 'rnnoise' })
    expect(JSON.parse(localStorage.getItem('stapp.voice.preferences.v1') ?? '{}')).toMatchObject({
      noiseMode: 'enhanced', inputDeviceId: 'microfone-novo',
    })
    transport.destroy()
  })

  it('ativa RNNoise na faixa atual sem reiniciar o microfone', async () => {
    const transport = new LiveKitTransport(config, {
      selfPeerId: 'self-peer', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn(),
    })
    await transport.join('sala')
    transport.handleServerMessage({
      t: 'voice.grant', channel: 'sala', url: 'ws://sfu', token: 'jwt', expires_at: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(transport.snapshot().status).toBe('connected'))
    const sdk = await import('livekit-client') as unknown as { Room: { instances: Array<any> } }
    const microphone = sdk.Room.instances[0].localParticipant.setMicrophoneEnabled
    const callsBefore = microphone.mock.calls.length

    await transport.updatePreferences({ noiseMode: 'enhanced' })

    expect(microphone).toHaveBeenCalledTimes(callsBefore)
    expect(transport.snapshot().audioProcessor).toMatchObject({ status: 'active', effective: 'rnnoise' })
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
