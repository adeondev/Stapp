import type {
  LocalAudioTrack,
  Participant,
  RemoteTrackPublication,
  Room,
  TrackPublication,
} from 'livekit-client'
import {
  captureScreenSourceThumbnail,
  isTauriRuntime,
  listScreenSources,
  startBrowserScreenCapture,
  startNativeScreenCapture,
  type BrowserScreenCapture,
  type NativeScreenCapture,
  type ScreenSource,
} from '../platform/screenCapture'
import type { PeerId, ServerMsg, VoiceConfig } from '../protocol'
import type {
  DiagnosticReport,
  InboundAudioDiagnostic,
  MediaDeviceLists,
  ScreenShareOptions,
  VoiceParticipantState,
  VoiceSnapshot,
  VoiceTransport,
  VoiceTransportOptions,
} from './VoiceTransport'
import {
  loadVoicePreferences,
  saveVoicePreferences,
  type ScreenPreset,
  type VoicePreferences,
} from './preferences'
import { RnnoiseTrackProcessor } from './RnnoiseTrackProcessor'
import {
  VoiceAudioProcessor,
  type ConfigurableAudioProcessor,
  type VoiceProcessorSettings,
} from './VoiceAudioProcessor'

type LiveKitModule = typeof import('livekit-client')

interface InboundAudioBaseline {
  sampledAt: number
  bytesReceived: number
  packetsReceived: number
  packetsLost: number
  totalSamplesReceived: number
  concealedSamples: number
  jitterBufferDelay: number
  jitterBufferEmittedCount: number
}

const SCREEN_PRESETS = {
  economy: { width: 1280, height: 720, frameRate: 15, maxBitrate: 1_200_000 },
  balanced: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_500_000 },
  fluid: { width: 1280, height: 720, frameRate: 60, maxBitrate: 4_500_000 },
  original: { width: 3840, height: 2160, frameRate: 60, maxBitrate: 8_000_000 },
} as const

export class LiveKitTransport implements VoiceTransport {
  private room: Room | null = null
  private sdk: LiveKitModule | null = null
  private requestedChannel: string | null = null
  private sessionGeneration = 0
  private audioPlaybackWarningShown = false
  private preferences = loadVoicePreferences()
  private audioProcessor: ConfigurableAudioProcessor | null = null
  private audioProcessorName = 'none'
  private audioProcessorSampleRate?: number
  private audioProcessorError?: string
  private nativeScreenCapture: NativeScreenCapture | null = null
  private browserScreenCapture: BrowserScreenCapture | null = null
  private screenAudioDiagnostic: NativeScreenCapture['audioValidation'] | null = null
  private browserScreenAudioDiagnostic: BrowserScreenCapture['audioValidation'] | null = null
  private readonly listeners = new Set<(snapshot: VoiceSnapshot) => void>()
  private readonly audioElements = new Map<string, HTMLAudioElement>()
  private readonly publicationOwners = new Map<string, PeerId>()
  private readonly audioSources = new Map<string, string>()
  private readonly voiceVolumes = new Map<PeerId, number>()
  private readonly lastVoiceVolumes = new Map<PeerId, number>()
  private readonly screenShareVolumes = new Map<PeerId, number>()
  private readonly lastScreenShareVolumes = new Map<PeerId, number>()
  private readonly watchedScreenPeers = new Set<PeerId>()
  private readonly inboundAudioBaselines = new Map<string, InboundAudioBaseline>()
  private readonly inboundAudioHealthFailures = new Map<string, number>()
  private readonly audioRepairCooldowns = new Map<string, number>()
  private inboundAudioDiagnostics: InboundAudioDiagnostic[] = []
  private audioHealthTimer: number | null = null
  private audioHealthCollecting = false
  private state: VoiceSnapshot = {
    status: 'idle', channel: null, muted: false, deafened: false,
    cameraEnabled: false, screenSharing: false, screenHasAudio: null,
    participants: [], media: [], audioProcessor: { status: 'idle', effective: 'none' }, error: null,
  }

  constructor(
    private readonly config: Extract<VoiceConfig, { backend: 'livekit' }>,
    private readonly options: VoiceTransportOptions,
  ) {}

  async join(channel: string): Promise<boolean> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.fail('O microfone exige uma conexão segura (HTTPS) ou o aplicativo Desktop. Em conexões HTTP remotas, o navegador bloqueia a captura de mídia.')
      return false
    }
    if (this.requestedChannel === channel && this.state.status !== 'idle') return true
    if (this.requestedChannel || this.room) this.endSession(true)
    this.sessionGeneration += 1
    this.requestedChannel = channel
    this.audioPlaybackWarningShown = false
    this.state = { ...this.state, status: 'requesting', channel, error: null }
    this.emit()
    this.options.send({ t: 'voice.join', channel })
    return true
  }

  handleServerMessage(msg: ServerMsg) {
    if (msg.t === 'voice.grant' && msg.channel === this.requestedChannel) {
      // A duplicate grant must never create a second Room playing the same peers.
      if (this.state.status !== 'requesting') return
      void this.connect(msg.url, msg.token, msg.expires_at, msg.channel, this.sessionGeneration)
      return
    }
    if (msg.t === 'voice.denied' && msg.channel === this.requestedChannel) {
      this.endSession(false)
      this.state = { ...this.state, status: 'idle', channel: null, error: msg.message }
      this.emit()
      this.options.onError(msg.message)
      return
    }
    if (msg.t === 'voice.state') this.syncStappState(msg)
  }

  setMuted(muted: boolean) {
    void this.resumeAudio()
    this.state = { ...this.state, muted }
    void this.applyMicrophoneState()
    this.publishState()
    this.sync()
  }

  setDeafened(deafened: boolean) {
    this.state = { ...this.state, deafened }
    this.applyPlaybackState()
    void this.resumeAudio()
    void this.applyMicrophoneState()
    this.publishState()
    this.sync()
  }

  async setCameraEnabled(enabled: boolean): Promise<boolean> {
    const room = this.room
    if (!room || !this.config.camera) return false
    try {
      await room.localParticipant.setCameraEnabled(
        enabled,
        enabled
          ? {
              deviceId: this.preferences.cameraDeviceId || undefined,
              resolution: this.preferences.cameraQuality === '1080p'
                ? { width: 1920, height: 1080, frameRate: 30 }
                : { width: 1280, height: 720, frameRate: 30 },
            }
          : undefined,
        { videoCodec: 'vp9', backupCodec: { codec: 'vp8' }, simulcast: true },
      )
      this.state = { ...this.state, cameraEnabled: enabled }
      this.publishState()
      this.sync()
      return true
    } catch (error) {
      this.fail(mediaError(error, 'Nao consegui abrir a camera.'))
      return false
    }
  }

  async setScreenShareEnabled(
    enabled: boolean,
    options: ScreenShareOptions = {},
  ): Promise<boolean> {
    const preset = options.preset ?? this.preferences.screenPreset
    const sourceId = options.sourceId
    const includeAudio = options.includeAudio ?? this.preferences.shareAudio
    const room = this.room
    const sdk = this.sdk
    if (!room || !sdk || !this.config.screen_share) return false
    try {
      if (!enabled) {
        await this.stopScreenShare(room)
        this.state = { ...this.state, screenSharing: false, screenHasAudio: null }
        this.publishState()
        this.sync()
        return true
      }

      if (this.state.screenSharing) {
        await this.stopScreenShare(room)
      }

      const quality = SCREEN_PRESETS[preset]
      if (isTauriRuntime()) {
        if (!sourceId) {
          this.fail('Escolha uma tela ou janela no seletor do Stapp.')
          return false
        }
        const capture = await startNativeScreenCapture({
          sourceId,
          maxWidth: quality.width,
          maxHeight: quality.height,
          fps: quality.frameRate,
          includeAudio: includeAudio && this.config.screen_audio,
        })
        this.nativeScreenCapture = capture
        this.screenAudioDiagnostic = capture.audioValidation ?? null
        this.browserScreenAudioDiagnostic = null
        const streamName = `stapp-screen-${capture.track.id || 'native'}`
        try {
          await room.localParticipant.publishTrack(capture.track, {
            source: sdk.Track.Source.ScreenShare,
            name: 'stapp-screen',
            stream: streamName,
            videoCodec: 'vp9',
            backupCodec: { codec: 'vp8' },
            simulcast: false,
            screenShareEncoding: {
              maxBitrate: quality.maxBitrate,
              maxFramerate: quality.frameRate,
            },
          })
        } catch (error) {
          this.nativeScreenCapture = null
          await capture.stop()
          throw error
        }
        let hasAudio = false
        if (capture.audioTrack) {
          try {
            await room.localParticipant.publishTrack(capture.audioTrack, {
              source: sdk.Track.Source.ScreenShareAudio,
              name: 'stapp-screen-audio',
              stream: streamName,
              audioPreset: sdk.AudioPresets.musicHighQualityStereo,
              forceStereo: true,
              dtx: false,
              red: false,
            })
            hasAudio = true
          } catch (error) {
            await room.localParticipant.unpublishTrack(capture.audioTrack).catch(() => undefined)
            capture.audioTrack.stop()
            this.options.onError(mediaError(
              error,
              'A tela continua ao vivo, mas nao consegui publicar o audio.',
            ))
          }
        }
        void capture.ended.then((reason) => {
          if (this.nativeScreenCapture !== capture) return
          this.options.onError(`O compartilhamento terminou: ${reason}.`)
          void this.setScreenShareEnabled(false)
        })
        this.finishScreenShareStart(preset, includeAudio, hasAudio)
        if (includeAudio && this.config.screen_audio && !hasAudio && capture.audioError) {
          this.options.onError(`A tela continua ao vivo sem som: ${capture.audioError}.`)
        }
        return true
      }

      const capture = await startBrowserScreenCapture({
        maxWidth: quality.width,
        maxHeight: quality.height,
        fps: quality.frameRate,
        includeAudio: includeAudio && this.config.screen_audio,
        contentHint: preset === 'fluid' ? 'motion' : 'detail',
      })
      this.browserScreenCapture = capture
      this.browserScreenAudioDiagnostic = capture.audioValidation ?? null
      this.screenAudioDiagnostic = null
      const streamName = `stapp-screen-${capture.stream.id || capture.track.id || 'web'}`
      try {
        await room.localParticipant.publishTrack(capture.track, {
          source: sdk.Track.Source.ScreenShare,
          name: 'stapp-screen',
          stream: streamName,
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
          simulcast: false,
          screenShareEncoding: {
            maxBitrate: quality.maxBitrate,
            maxFramerate: quality.frameRate,
          },
        })
      } catch (error) {
        this.browserScreenCapture = null
        await capture.stop()
        throw error
      }
      let hasAudio = false
      if (capture.audioTrack) {
        try {
          await room.localParticipant.publishTrack(capture.audioTrack, {
            source: sdk.Track.Source.ScreenShareAudio,
            name: 'stapp-screen-audio',
            stream: streamName,
            audioPreset: sdk.AudioPresets.musicHighQualityStereo,
            forceStereo: true,
            dtx: false,
            red: false,
          })
          hasAudio = true
        } catch (error) {
          await room.localParticipant.unpublishTrack(capture.audioTrack).catch(() => undefined)
          capture.audioTrack.stop()
          this.options.onError(mediaError(
            error,
            'A tela continua ao vivo, mas nao consegui publicar o audio.',
          ))
        }
      }
      void capture.ended.then((reason) => {
        if (this.browserScreenCapture !== capture) return
        this.options.onError(`O compartilhamento terminou: ${reason}.`)
        void this.setScreenShareEnabled(false)
      })
      this.finishScreenShareStart(preset, includeAudio, hasAudio)
      if (includeAudio && this.config.screen_audio && !hasAudio) {
        this.options.onError(`A tela continua ao vivo sem som: ${capture.audioError
          ?? 'a fonte escolhida nao forneceu audio'}.`)
      }
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return false
      this.fail(mediaError(error, 'Nao consegui iniciar o compartilhamento.'))
      return false
    }
  }

  listScreenSources(): Promise<ScreenSource[]> {
    return listScreenSources()
  }

  captureScreenSourceThumbnail(sourceId: string) {
    return captureScreenSourceThumbnail(sourceId)
  }

  async setInputDevice(deviceId: string) {
    this.preferences = { ...this.preferences, inputDeviceId: deviceId }
    saveVoicePreferences(this.preferences)
    // Reiniciar recria tambem o processador. Se RNNoise caiu para o fallback
    // nesta sessao, uma troca de microfone faz uma tentativa limpa sem apagar
    // a preferencia "Aprimorada" escolhida pela pessoa.
    if (this.room) await this.restartMicrophone()
  }

  async setOutputDevice(deviceId: string) {
    this.preferences = { ...this.preferences, outputDeviceId: deviceId }
    saveVoicePreferences(this.preferences)
    if (this.room && deviceId) await this.room.switchActiveDevice('audiooutput', deviceId, true)
  }

  async setCameraDevice(deviceId: string) {
    this.preferences = { ...this.preferences, cameraDeviceId: deviceId }
    saveVoicePreferences(this.preferences)
    if (this.room && deviceId && this.state.cameraEnabled) {
      await this.room.switchActiveDevice('videoinput', deviceId, true)
    }
  }

  async enumerateDevices(): Promise<MediaDeviceLists> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { inputs: [], outputs: [], cameras: [] }
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      inputs: devices.filter((device) => device.kind === 'audioinput'),
      outputs: devices.filter((device) => device.kind === 'audiooutput'),
      cameras: devices.filter((device) => device.kind === 'videoinput'),
    }
  }

  async startMicrophoneTest(onLevel: (level: number) => void) {
    const { startMicrophoneTest } = await import('./testMicrophone')
    return startMicrophoneTest(this.audioCaptureOptions(), onLevel)
  }

  async startCameraPreview(element: HTMLVideoElement) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('A câmera exige conexão segura (HTTPS) ou o aplicativo Desktop.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: this.preferences.cameraDeviceId || undefined,
        width: this.preferences.cameraQuality === '1080p' ? 1920 : 1280,
        height: this.preferences.cameraQuality === '1080p' ? 1080 : 720,
        frameRate: 30,
      },
    })
    element.srcObject = stream
    await element.play().catch(() => {})
    return () => {
      for (const track of stream.getTracks()) track.stop()
      if (element.srcObject === stream) element.srcObject = null
    }
  }

  setPublicationSubscribed(publicationId: string, subscribed: boolean) {
    const publication = this.findRemotePublication(publicationId)
    if (!publication) return
    const sdk = this.sdk
    const owner = this.publicationOwners.get(publicationId)
    if (sdk && owner && publication.source === sdk.Track.Source.ScreenShare) {
      const participant = this.room?.remoteParticipants.get(owner)
      if (subscribed) {
        this.watchedScreenPeers.add(owner)
        this.startAudioHealthMonitor()
      } else {
        this.watchedScreenPeers.delete(owner)
      }
      for (const related of participant?.trackPublications.values() ?? []) {
        if (related.source === sdk.Track.Source.ScreenShare
          || related.source === sdk.Track.Source.ScreenShareAudio) {
          // Do not wait for LiveKit's TrackUnsubscribed event to silence the
          // screen audio. A delayed event used to leave an invisible player
          // feeding back the call after "Parar de assistir".
          if (!subscribed && related.source === sdk.Track.Source.ScreenShareAudio) {
            this.detachAudio(related.trackSid)
          }
          related.setSubscribed(subscribed)
        }
      }
      if (!subscribed) {
        this.refreshMicrophonePlayers()
        this.recoverDegradedMicrophones()
        if (this.watchedScreenPeers.size === 0) this.stopAudioHealthMonitor()
      }
    } else {
      publication.setSubscribed(subscribed)
    }
    this.sync()
  }

  getVoiceVolume(peerId: PeerId) {
    return this.voiceVolumes.get(peerId) ?? 100
  }

  setVoiceVolume(peerId: PeerId, volume: number) {
    const normalized = clamp(volume, 0, 200)
    this.voiceVolumes.set(peerId, normalized)
    if (normalized > 0) this.lastVoiceVolumes.set(peerId, normalized)
    this.applyOwnerVolume(peerId)
  }

  setVoiceMuted(peerId: PeerId, muted: boolean) {
    this.setVoiceVolume(peerId, muted ? 0 : (this.lastVoiceVolumes.get(peerId) ?? 100))
  }

  getScreenShareVolume(peerId: PeerId) {
    return this.screenShareVolumes.get(peerId) ?? 100
  }

  setScreenShareVolume(peerId: PeerId, volume: number) {
    const normalized = clamp(volume, 0, 200)
    this.screenShareVolumes.set(peerId, normalized)
    if (normalized > 0) this.lastScreenShareVolumes.set(peerId, normalized)
    this.applyOwnerVolume(peerId)
  }

  setScreenShareMuted(peerId: PeerId, muted: boolean) {
    this.setScreenShareVolume(peerId, muted ? 0 : (this.lastScreenShareVolumes.get(peerId) ?? 100))
  }

  attachMedia(publicationId: string, element: HTMLMediaElement) {
    const publication = this.findPublication(publicationId)
    const track = publication?.videoTrack
    if (!track) return () => {}
    track.attach(element)
    return () => { track.detach(element) }
  }

  snapshot() { return this.state }

  subscribe(listener: (snapshot: VoiceSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getPreferences() { return { ...this.preferences } }

  async updatePreferences(patch: Partial<VoicePreferences>) {
    const previous = this.preferences
    this.preferences = { ...this.preferences, ...patch }
    saveVoicePreferences(this.preferences)

    if (patch.inputDeviceId !== undefined && patch.inputDeviceId !== previous.inputDeviceId) {
      await this.setInputDevice(patch.inputDeviceId)
    }
    if (patch.outputDeviceId !== undefined && patch.outputDeviceId !== previous.outputDeviceId) {
      await this.setOutputDevice(patch.outputDeviceId)
    }
    if (patch.cameraDeviceId !== undefined && patch.cameraDeviceId !== previous.cameraDeviceId) {
      await this.setCameraDevice(patch.cameraDeviceId)
    }
    if (patch.cameraQuality !== undefined && this.state.cameraEnabled) {
      await this.setCameraEnabled(false)
      await this.setCameraEnabled(true)
    }
    if (patch.outputVolume !== undefined) {
      for (const publicationId of this.audioElements.keys()) this.applyVolume(publicationId)
    }
    if (this.room && patch.noiseMode === 'enhanced') {
      const track = this.localMicrophoneTrack()
      if (track) await this.enableAudioProcessor(track)
    } else if (
      this.room
      && (patch.noiseMode !== undefined
        || patch.echoCancellation !== undefined
        || patch.autoGainControl !== undefined)
    ) {
      await this.restartMicrophone()
    } else if (
      patch.inputVolume !== undefined
      || patch.inputMode !== undefined
      || patch.automaticSensitivity !== undefined
      || patch.sensitivity !== undefined
    ) {
      this.audioProcessor?.update(this.processorSettings())
    }
  }

  async diagnosticReport(): Promise<DiagnosticReport> {
    await this.collectInboundAudioDiagnostics()
    const browserAudio = this.browserScreenAudioDiagnostic
    const report: DiagnosticReport = {
      generatedAt: new Date().toISOString(),
      backend: 'livekit',
      status: this.state.status,
      quality: this.room?.localParticipant.connectionQuality ?? 'unknown',
      audioProcessor: this.audioProcessorName,
      audioSampleRate: this.audioProcessorSampleRate,
      audioProcessorError: this.audioProcessorError,
      screenAudioMode: this.screenAudioDiagnostic ? 'exclude_stapp_process_tree' : undefined,
      screenAudioProcessId: this.screenAudioDiagnostic?.processId,
      screenAudioWindowsBuild: this.screenAudioDiagnostic?.windowsBuild,
      screenAudioValidation: browserAudio?.reason ?? this.screenAudioDiagnostic?.reason,
      screenAudioRuntime: browserAudio ? 'web' : this.screenAudioDiagnostic ? 'tauri' : undefined,
      screenAudioSurface: browserAudio?.displaySurface,
      screenAudioOwnAudioSupported: browserAudio?.supported,
      screenAudioOwnAudioApplied: browserAudio?.applied,
      screenAudioProbeControlLevel: browserAudio?.controlLevel,
      screenAudioProbeCaptureLevel: browserAudio?.captureLevel,
      screenAudioBufferedMs: this.nativeScreenCapture?.audioPlaybackStats
        ? round(this.nativeScreenCapture.audioPlaybackStats.bufferedFrames / 48)
        : undefined,
      screenAudioPlaybackRate: this.nativeScreenCapture?.audioPlaybackStats?.playbackRate,
      screenAudioUnderruns: this.nativeScreenCapture?.audioPlaybackStats?.underruns,
      screenAudioDroppedFrames: this.nativeScreenCapture?.audioPlaybackStats?.droppedFrames,
      audioPlayerCount: this.audioElements.size,
      inboundAudio: [...this.inboundAudioDiagnostics],
    }
    const publications = this.room?.localParticipant.getTrackPublications() ?? []
    for (const publication of publications) {
      const track = publication.track
      const stats = await track?.getRTCStatsReport().catch(() => undefined)
      if (!stats) continue
      stats.forEach((entry) => {
        if (entry.type === 'codec' && typeof entry.mimeType === 'string') report.codec = entry.mimeType
        if (entry.type === 'outbound-rtp') {
          if (entry.frameWidth && entry.frameHeight) report.resolution = `${entry.frameWidth}x${entry.frameHeight}`
          if (typeof entry.framesPerSecond === 'number') report.fps = entry.framesPerSecond
          if (typeof entry.packetsLost === 'number' && typeof entry.packetsSent === 'number') {
            report.packetLossPercent = round((entry.packetsLost / Math.max(1, entry.packetsSent)) * 100)
          }
        }
        if (entry.type === 'remote-inbound-rtp') {
          if (typeof entry.roundTripTime === 'number') report.rttMs = round(entry.roundTripTime * 1000)
          if (typeof entry.jitter === 'number') report.jitterMs = round(entry.jitter * 1000)
        }
      })
      if (track && track.currentBitrate > 0) report.bitrateKbps = round(track.currentBitrate / 1000)
    }
    return report
  }

  leave() {
    this.endSession(true)
    this.state = {
      status: 'idle', channel: null, muted: false, deafened: false,
      cameraEnabled: false, screenSharing: false, screenHasAudio: null,
      participants: [], media: [], audioProcessor: { status: 'idle', effective: 'none' }, error: null,
    }
    this.emit()
  }

  destroy() {
    this.leave()
    this.clearLocalPlaybackPreferences()
    this.listeners.clear()
  }

  async resumeAudio() {
    const room = this.room
    if (!room) return false
    try {
      await room.startAudio()
      const played = await Promise.all(
        [...this.audioElements.values()].map((audio) => audio.play().then(() => true).catch(() => false)),
      )
      this.applyPlaybackState()
      const ready = room.canPlaybackAudio && played.every(Boolean)
      if (ready) this.audioPlaybackWarningShown = false
      return ready
    } catch {
      return false
    }
  }

  private async connect(url: string, token: string, expiresAt: number, channel: string, generation: number) {
    if (Date.now() >= expiresAt || !this.isCurrentSession(channel, generation)) {
      if (generation !== this.sessionGeneration) return
      this.requestedChannel = null
      this.state = { ...this.state, status: 'idle', channel: null }
      this.fail('A autorizacao de midia expirou; tente entrar novamente.')
      return
    }
    this.state = { ...this.state, status: 'connecting' }
    this.emit()
    let connectingRoom: Room | null = null
    try {
      const sdk = await import('livekit-client')
      if (!this.isCurrentSession(channel, generation)) return
      this.sdk = sdk
      const room = new sdk.Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
          simulcast: true,
          scalabilityMode: 'L3T3_KEY',
          stopMicTrackOnMute: false,
        },
      })
      connectingRoom = room
      this.room = room
      this.bindEvents(room, sdk, generation)
      await room.connect(mediaUrlForThisDevice(url), token, { autoSubscribe: false })
      if (!this.isCurrentRoom(room, channel, generation)) {
        await room.disconnect(true)
        return
      }
      this.configureExistingSubscriptions(room, sdk)
      void this.resumeAudio().then((ready) => {
        if (!ready && this.isCurrentRoom(room, channel, generation)) this.warnAudioPlaybackBlocked()
      })
      if (this.preferences.outputDeviceId) {
        await room.switchActiveDevice('audiooutput', this.preferences.outputDeviceId, true).catch(() => false)
      }
      await this.enableMicrophone()
      if (!this.isCurrentRoom(room, channel, generation)) return
      this.state = { ...this.state, status: 'connected', channel, error: null }
      this.options.send({ t: 'voice.connected', channel })
      this.sync()
    } catch (error) {
      if (!this.isCurrentSession(channel, generation)) {
        if (connectingRoom) await connectingRoom.disconnect(true).catch(() => {})
        return
      }
      this.endSession(false)
      this.fail(mediaError(error, 'Midia temporariamente indisponivel.'))
    }
  }

  private bindEvents(room: Room, sdk: LiveKitModule, generation: number) {
    const current = () => this.room === room && this.sessionGeneration === generation
    room.on(sdk.RoomEvent.ParticipantConnected, () => { if (current()) this.sync() })
    room.on(sdk.RoomEvent.ParticipantDisconnected, (participant: Participant) => {
      if (!current()) return
      this.detachOwnerAudio(participant.identity)
      this.watchedScreenPeers.delete(participant.identity)
      this.sync()
    })
    room.on(sdk.RoomEvent.TrackPublished, (publication: RemoteTrackPublication, participant: Participant) => {
      if (!current()) return
      this.publicationOwners.set(publication.trackSid, participant.identity)
      this.configureSubscription(publication, sdk)
      this.sync()
    })
    room.on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (!current()) return
      this.publicationOwners.set(publication.trackSid, participant.identity)
      if (track.kind === sdk.Track.Kind.Audio) this.attachAudio(publication, participant.identity)
      this.sync()
    })
    room.on(sdk.RoomEvent.TrackUnsubscribed, (_track, publication) => {
      if (!current()) return
      this.detachAudio(publication.trackSid)
      this.sync()
    })
    room.on(sdk.RoomEvent.TrackUnpublished, (publication) => {
      if (!current()) return
      this.detachAudio(publication.trackSid)
      this.sync()
    })
    room.on(sdk.RoomEvent.TrackMuted, () => { if (current()) this.sync() })
    room.on(sdk.RoomEvent.TrackUnmuted, () => { if (current()) this.sync() })
    room.on(sdk.RoomEvent.LocalTrackPublished, () => { if (current()) this.sync() })
    room.on(sdk.RoomEvent.LocalTrackUnpublished, (publication) => {
      if (!current()) return
      if (publication.source === sdk.Track.Source.ScreenShare) {
        this.state = { ...this.state, screenSharing: false, screenHasAudio: null }
        this.publishState()
      }
      this.sync()
    })
    room.on(sdk.RoomEvent.ActiveSpeakersChanged, (participants: Participant[]) => {
      if (!current()) return
      const active = new Set(participants.map((participant) => participant.identity))
      for (const participant of this.allParticipants()) {
        this.options.onSpeaking(participant.identity, active.has(participant.identity))
      }
      this.sync()
    })
    room.on(sdk.RoomEvent.ConnectionQualityChanged, () => { if (current()) this.sync() })
    room.on(sdk.RoomEvent.Reconnecting, () => {
      if (!current()) return
      this.state = { ...this.state, status: 'reconnecting' }
      this.emit()
    })
    room.on(sdk.RoomEvent.Reconnected, () => {
      if (!current()) return
      this.state = { ...this.state, status: 'connected' }
      this.sync()
    })
    room.on(sdk.RoomEvent.MediaDevicesError, (error) => {
      if (current()) this.fail(mediaError(error, 'Falha em um dispositivo de midia.'))
    })
    room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => {
      if (current() && !room.canPlaybackAudio) this.warnAudioPlaybackBlocked()
    })
    room.on(sdk.RoomEvent.Disconnected, () => {
      if (current() && this.requestedChannel) {
        this.endSession(true)
        this.state = {
          ...this.state,
          status: 'idle', channel: null, participants: [], media: [],
          cameraEnabled: false, screenSharing: false, screenHasAudio: null,
          error: 'A conexao de midia foi encerrada.',
        }
        this.emit()
        this.options.onError('A conexao de midia foi encerrada.')
      }
    })
  }

  private configureExistingSubscriptions(room: Room, sdk: LiveKitModule) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.publicationOwners.set(publication.trackSid, participant.identity)
        this.configureSubscription(publication, sdk)
      }
    }
  }

  private configureSubscription(publication: RemoteTrackPublication, sdk: LiveKitModule) {
    const owner = this.publicationOwners.get(publication.trackSid)
    const subscribe = publication.source === sdk.Track.Source.Microphone
      || publication.source === sdk.Track.Source.Camera
      || Boolean(owner && this.watchedScreenPeers.has(owner)
        && (publication.source === sdk.Track.Source.ScreenShare
          || publication.source === sdk.Track.Source.ScreenShareAudio))
    publication.setSubscribed(subscribe)
  }

  private async enableMicrophone() {
    const room = this.room
    if (!room) return
    try {
      const publication = await room.localParticipant.setMicrophoneEnabled(
        !this.state.muted && !this.state.deafened,
        this.audioCaptureOptions(),
      )
      if (publication?.audioTrack) await this.enableAudioProcessor(publication.audioTrack)
    } catch (error) {
      this.state = { ...this.state, muted: true }
      this.options.onError(mediaError(error, 'Microfone indisponivel; voce entrou apenas ouvindo.'))
    }
  }

  private async enableAudioProcessor(track: LocalAudioTrack) {
    const processor = this.preferences.noiseMode === 'enhanced'
      ? new RnnoiseTrackProcessor(this.processorSettings())
      : new VoiceAudioProcessor(this.processorSettings())
    this.audioProcessorError = undefined
    this.state = {
      ...this.state,
      audioProcessor: {
        status: 'starting',
        effective: this.preferences.noiseMode === 'standard' ? 'standard' : 'none',
      },
    }
    this.emit()
    try {
      if (this.preferences.noiseMode === 'enhanced') {
        await (track.mediaStreamTrack as MediaStreamTrack | undefined)
          ?.applyConstraints({ noiseSuppression: false }).catch(() => {})
      }
      await track.setProcessor(processor)
      this.audioProcessor = processor
      this.audioProcessorName = processor.name
      this.audioProcessorSampleRate = processor instanceof RnnoiseTrackProcessor
        ? processor.sampleRate
        : undefined
      this.state = {
        ...this.state,
        audioProcessor: {
          status: 'active',
          effective: processor instanceof RnnoiseTrackProcessor
            ? 'rnnoise'
            : this.preferences.noiseMode === 'standard' ? 'standard' : 'none',
        },
      }
      this.emit()
    } catch (error) {
      await processor.destroy().catch(() => {})
      this.audioProcessor = null
      this.audioProcessorError = error instanceof Error ? error.message : String(error)
      if (this.preferences.noiseMode === 'enhanced') {
        await (track.mediaStreamTrack as MediaStreamTrack | undefined)
          ?.applyConstraints({ noiseSuppression: true }).catch(() => {})
        const fallback = new VoiceAudioProcessor(this.processorSettings())
        await track.setProcessor(fallback).then(() => {
          this.audioProcessor = fallback
          this.audioProcessorName = fallback.name
          this.audioProcessorSampleRate = undefined
          this.state = {
            ...this.state,
            audioProcessor: {
              status: 'fallback', effective: 'standard', error: this.audioProcessorError,
            },
          }
        }).catch(() => {
          this.audioProcessorName = 'none'
          this.state = {
            ...this.state,
            audioProcessor: {
              status: 'fallback', effective: 'none', error: this.audioProcessorError,
            },
          }
        })
      } else {
        this.audioProcessorName = 'none'
        this.state = {
          ...this.state,
          audioProcessor: {
            status: 'fallback', effective: 'none', error: this.audioProcessorError,
          },
        }
      }
      this.emit()
    }
  }

  private localMicrophoneTrack() {
    const sdk = this.sdk
    if (!sdk) return undefined
    return this.room?.localParticipant
      .getTrackPublication(sdk.Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined
  }

  private processorSettings(): VoiceProcessorSettings {
    return {
      inputVolume: this.preferences.inputVolume,
      inputMode: this.preferences.inputMode,
      automaticSensitivity: this.preferences.automaticSensitivity,
      sensitivity: this.preferences.sensitivity,
    }
  }

  private audioCaptureOptions() {
    return {
      deviceId: this.preferences.inputDeviceId || undefined,
      echoCancellation: this.preferences.echoCancellation,
      autoGainControl: this.preferences.autoGainControl,
      noiseSuppression: this.preferences.noiseMode === 'standard',
      channelCount: 1,
      sampleRate: 48_000,
    }
  }

  private async applyMicrophoneState() {
    const room = this.room
    if (!room) return
    await room.localParticipant
      .setMicrophoneEnabled(!this.state.muted && !this.state.deafened, this.audioCaptureOptions())
      .catch((error) => this.fail(mediaError(error, 'Nao consegui alterar o microfone.')))
  }

  private async restartMicrophone() {
    const room = this.room
    if (!room) return
    await this.audioProcessor?.destroy().catch(() => {})
    this.audioProcessor = null
    await room.localParticipant.setMicrophoneEnabled(false)
    await this.enableMicrophone()
    this.sync()
  }

  private publishState() {
    if (!this.requestedChannel || this.state.status !== 'connected') return
    this.options.send({
      t: 'voice.state',
      muted: this.state.muted,
      deafened: this.state.deafened,
      camera_enabled: this.state.cameraEnabled,
      screen_sharing: this.state.screenSharing,
    })
  }

  private finishScreenShareStart(preset: ScreenPreset, shareAudio: boolean, hasAudio: boolean) {
    this.preferences = { ...this.preferences, screenPreset: preset, shareAudio }
    saveVoicePreferences(this.preferences)
    this.state = { ...this.state, screenSharing: true, screenHasAudio: hasAudio }
    this.publishState()
    this.sync()
  }

  private async stopScreenShare(room: Room) {
    const capture = this.nativeScreenCapture
    const browserCapture = this.browserScreenCapture
    this.nativeScreenCapture = null
    this.browserScreenCapture = null
    this.screenAudioDiagnostic = null
    this.browserScreenAudioDiagnostic = null
    if (!capture && !browserCapture) {
      await room.localParticipant.setScreenShareEnabled(false)
      return
    }
    const activeCapture = capture ?? browserCapture
    if (!activeCapture) return
    if (activeCapture.audioTrack) {
      await room.localParticipant.unpublishTrack(activeCapture.audioTrack).catch(() => undefined)
    }
    await room.localParticipant.unpublishTrack(activeCapture.track).catch(() => undefined)
    await activeCapture.stop()
  }

  private syncStappState(msg: Extract<ServerMsg, { t: 'voice.state' }>) {
    if (msg.peer_id !== this.options.selfPeerId) return
    this.state = {
      ...this.state,
      muted: msg.muted,
      deafened: msg.deafened,
      cameraEnabled: msg.camera_enabled,
      screenSharing: msg.screen_sharing,
    }
    this.applyPlaybackState()
    this.emit()
  }

  private sync() {
    const room = this.room
    const sdk = this.sdk
    if (!room || !sdk) {
      this.emit()
      return
    }
    const participants: VoiceParticipantState[] = this.allParticipants().map((participant) => ({
      peerId: participant.identity,
      name: participant.isLocal ? (participant.name || 'Voce') : (participant.name || 'Pessoa'),
      local: participant.isLocal,
      speaking: participant.isSpeaking,
      microphone: participant.isMicrophoneEnabled,
      camera: participant.isCameraEnabled,
      screen: participant.isScreenShareEnabled,
      quality: participant.connectionQuality,
    }))
    const media = this.allParticipants().flatMap((participant) =>
      participant.getTrackPublications()
        .filter((publication) =>
          publication.kind === sdk.Track.Kind.Video
          && (publication.source === sdk.Track.Source.Camera
            || publication.source === sdk.Track.Source.ScreenShare)
          && (publication.source !== sdk.Track.Source.Camera || !publication.isMuted),
        )
        .map((publication) => ({
          id: publication.trackSid,
          peerId: participant.identity,
          name: participant.name || (participant.isLocal ? 'Voce' : 'Pessoa'),
          kind: publication.source === sdk.Track.Source.ScreenShare ? 'screen' as const : 'camera' as const,
          local: participant.isLocal,
          subscribed: participant.isLocal || publication.isSubscribed,
          muted: publication.isMuted,
          width: publication.dimensions?.width,
          height: publication.dimensions?.height,
        })),
    )
    this.state = { ...this.state, participants, media }
    // O LiveKit pode recriar/reativar elementos durante mudancas de topologia.
    // Toda sincronizacao e tambem uma barreira de politica de reproducao.
    this.applyPlaybackState()
    this.emit()
  }

  private allParticipants(): Participant[] {
    if (!this.room) return []
    return [this.room.localParticipant, ...this.room.remoteParticipants.values()]
  }

  private findPublication(id: string): TrackPublication | undefined {
    return this.allParticipants()
      .flatMap((participant) => participant.getTrackPublications())
      .find((publication) => publication.trackSid === id)
  }

  private findRemotePublication(id: string): RemoteTrackPublication | undefined {
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      const publication = participant.trackPublications.get(id)
      if (publication) return publication
    }
    return undefined
  }

  private startAudioHealthMonitor() {
    if (this.audioHealthTimer !== null) return
    void this.collectInboundAudioDiagnostics()
    this.audioHealthTimer = window.setInterval(() => {
      void this.collectInboundAudioDiagnostics()
    }, 2_000)
  }

  private stopAudioHealthMonitor() {
    if (this.audioHealthTimer === null) return
    window.clearInterval(this.audioHealthTimer)
    this.audioHealthTimer = null
  }

  private async collectInboundAudioDiagnostics() {
    const room = this.room
    const sdk = this.sdk
    if (!room || !sdk || this.audioHealthCollecting) return
    this.audioHealthCollecting = true
    try {
      const diagnostics: InboundAudioDiagnostic[] = []
      const now = performance.now()
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== sdk.Track.Kind.Audio || !publication.isSubscribed) continue
          const track = publication.audioTrack
          const stats = await track?.getRTCStatsReport().catch(() => undefined)
          let inbound: Record<string, unknown> | undefined
          stats?.forEach((entry) => {
            if (entry.type === 'inbound-rtp' && (!entry.kind || entry.kind === 'audio')) {
              inbound = entry as unknown as Record<string, unknown>
            }
          })
          const source = publication.source === sdk.Track.Source.Microphone
            ? 'voice' as const
            : publication.source === sdk.Track.Source.ScreenShareAudio
              ? 'screen' as const
              : 'unknown' as const
          const diagnostic: InboundAudioDiagnostic = {
            publicationId: publication.trackSid,
            peerId: participant.identity,
            source,
            playerAttached: this.audioElements.has(publication.trackSid),
          }
          if (inbound) {
            const current: InboundAudioBaseline = {
              sampledAt: now,
              bytesReceived: statNumber(inbound, 'bytesReceived'),
              packetsReceived: statNumber(inbound, 'packetsReceived'),
              packetsLost: statNumber(inbound, 'packetsLost'),
              totalSamplesReceived: statNumber(inbound, 'totalSamplesReceived'),
              concealedSamples: statNumber(inbound, 'concealedSamples'),
              jitterBufferDelay: statNumber(inbound, 'jitterBufferDelay'),
              jitterBufferEmittedCount: statNumber(inbound, 'jitterBufferEmittedCount'),
            }
            const previous = this.inboundAudioBaselines.get(publication.trackSid)
            diagnostic.jitterMs = round(statNumber(inbound, 'jitter') * 1_000)
            if (previous && now > previous.sampledAt) {
              const elapsedSeconds = (now - previous.sampledAt) / 1_000
              diagnostic.bitrateKbps = round(
                Math.max(0, current.bytesReceived - previous.bytesReceived) * 8 / elapsedSeconds / 1_000,
              )
              const received = Math.max(0, current.packetsReceived - previous.packetsReceived)
              const lost = Math.max(0, current.packetsLost - previous.packetsLost)
              diagnostic.packetLossPercent = round((lost / Math.max(1, received + lost)) * 100)
              const emitted = Math.max(0, current.jitterBufferEmittedCount - previous.jitterBufferEmittedCount)
              const bufferDelay = Math.max(0, current.jitterBufferDelay - previous.jitterBufferDelay)
              diagnostic.jitterBufferMs = emitted > 0 ? round((bufferDelay / emitted) * 1_000) : 0
              const samples = Math.max(0, current.totalSamplesReceived - previous.totalSamplesReceived)
              const concealed = Math.max(0, current.concealedSamples - previous.concealedSamples)
              diagnostic.concealedSamplesPercent = round((concealed / Math.max(1, samples)) * 100)
              const degraded = (diagnostic.packetLossPercent ?? 0) >= 5
                || (diagnostic.jitterBufferMs ?? 0) >= 200
                || (diagnostic.concealedSamplesPercent ?? 0) >= 5
              const failures = this.inboundAudioHealthFailures.get(publication.trackSid) ?? 0
              this.inboundAudioHealthFailures.set(
                publication.trackSid,
                degraded ? failures + 1 : Math.max(0, failures - 1),
              )
            }
            this.inboundAudioBaselines.set(publication.trackSid, current)
          }
          diagnostics.push(diagnostic)
        }
      }
      this.inboundAudioDiagnostics = diagnostics
    } finally {
      this.audioHealthCollecting = false
    }
  }

  private refreshMicrophonePlayers() {
    const sdk = this.sdk
    if (!sdk) return
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.source !== sdk.Track.Source.Microphone
          || !publication.isSubscribed
          || !publication.audioTrack) continue
        this.detachAudio(publication.trackSid)
        this.attachAudio(publication, participant.identity)
      }
    }
  }

  private recoverDegradedMicrophones() {
    const sdk = this.sdk
    if (!sdk) return
    const now = Date.now()
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.source !== sdk.Track.Source.Microphone || !publication.isSubscribed) continue
        if ((this.inboundAudioHealthFailures.get(publication.trackSid) ?? 0) < 3) continue
        const cooldownKey = `${participant.identity}:microphone`
        if ((this.audioRepairCooldowns.get(cooldownKey) ?? 0) > now) continue
        this.audioRepairCooldowns.set(cooldownKey, now + 30_000)
        this.inboundAudioHealthFailures.set(publication.trackSid, 0)
        this.inboundAudioBaselines.delete(publication.trackSid)
        publication.setSubscribed(false)
        window.setTimeout(() => {
          if (this.room?.remoteParticipants.get(participant.identity)
            ?.trackPublications.get(publication.trackSid) === publication) {
            publication.setSubscribed(true)
          }
        }, 150)
      }
    }
  }

  private attachAudio(publication: TrackPublication, owner: PeerId) {
    const track = publication.audioTrack
    if (!track || this.audioElements.has(publication.trackSid)) return
    // LiveKit may replace a publication during reconnect/device restart before
    // delivering every teardown event. Never play two copies of the same source.
    for (const [publicationId, existingOwner] of this.publicationOwners) {
      if (existingOwner === owner && this.audioSources.get(publicationId) === publication.source) {
        this.detachAudio(publicationId)
      }
    }
    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.muted = this.state.deafened
    audio.dataset.stappVoice = publication.trackSid
    audio.hidden = true
    document.body.append(audio)
    track.attach(audio)
    this.audioElements.set(publication.trackSid, audio)
    this.publicationOwners.set(publication.trackSid, owner)
    this.audioSources.set(publication.trackSid, String(publication.source))
    this.applyPlaybackState(publication.trackSid)
    audio.addEventListener('play', () => this.applyPlaybackState(publication.trackSid))
    void audio.play()
      .then(() => this.applyPlaybackState(publication.trackSid))
      .catch(() => this.warnAudioPlaybackBlocked())
  }

  private detachAudio(publicationId: string) {
    const audio = this.audioElements.get(publicationId)
    const publication = this.findPublication(publicationId)
    if (audio) publication?.audioTrack?.detach(audio)
    audio?.remove()
    this.audioElements.delete(publicationId)
    this.publicationOwners.delete(publicationId)
    this.audioSources.delete(publicationId)
  }

  private detachOwnerAudio(peerId: PeerId) {
    for (const [publicationId, owner] of [...this.publicationOwners]) {
      if (owner === peerId && this.audioElements.has(publicationId)) this.detachAudio(publicationId)
    }
  }

  private applyVolume(publicationId: string) {
    const audio = this.audioElements.get(publicationId)
    if (!audio) return
    const owner = this.publicationOwners.get(publicationId)
    const source = this.findPublication(publicationId)?.source
    const sdk = this.sdk
    const trackVolume = owner && sdk && source === sdk.Track.Source.Microphone
      ? this.getVoiceVolume(owner)
      : owner && sdk && source === sdk.Track.Source.ScreenShareAudio
        ? this.getScreenShareVolume(owner)
        : 100
    const master = this.preferences.outputVolume
    audio.muted = this.state.deafened
    audio.volume = clamp((trackVolume / 100) * (master / 100), 0, 1)
  }

  private applyOwnerVolume(peerId: PeerId) {
    for (const [publicationId, owner] of this.publicationOwners) {
      if (owner === peerId) this.applyVolume(publicationId)
    }
  }

  private applyPlaybackState(publicationId?: string) {
    if (publicationId) {
      this.applyVolume(publicationId)
      return
    }
    for (const id of this.audioElements.keys()) this.applyVolume(id)
  }

  private endSession(sendLeave: boolean) {
    const hadSession = Boolean(this.requestedChannel || this.room)
    this.sessionGeneration += 1
    this.requestedChannel = null
    this.state = { ...this.state, audioProcessor: { status: 'idle', effective: 'none' } }
    this.audioProcessorName = 'none'
    this.audioProcessorSampleRate = undefined
    this.audioProcessorError = undefined
    if (sendLeave && hadSession) this.options.send({ t: 'voice.leave' })

    const processor = this.audioProcessor
    this.audioProcessor = null
    const screenCapture = this.nativeScreenCapture
    const browserScreenCapture = this.browserScreenCapture
    this.nativeScreenCapture = null
    this.browserScreenCapture = null
    this.screenAudioDiagnostic = null
    this.browserScreenAudioDiagnostic = null
    this.stopAudioHealthMonitor()
    this.inboundAudioBaselines.clear()
    this.inboundAudioHealthFailures.clear()
    this.audioRepairCooldowns.clear()
    this.inboundAudioDiagnostics = []
    for (const publicationId of [...this.audioElements.keys()]) this.detachAudio(publicationId)
    const room = this.room
    this.room = null
    this.sdk = null
    this.publicationOwners.clear()
    this.audioSources.clear()
    this.watchedScreenPeers.clear()
    void this.disposeSession(room, processor, screenCapture, browserScreenCapture)
  }

  private clearLocalPlaybackPreferences() {
    this.voiceVolumes.clear()
    this.lastVoiceVolumes.clear()
    this.screenShareVolumes.clear()
    this.lastScreenShareVolumes.clear()
  }

  private async disposeSession(
    room: Room | null,
    processor: ConfigurableAudioProcessor | null,
    screenCapture: NativeScreenCapture | null,
    browserScreenCapture: BrowserScreenCapture | null,
  ) {
    await screenCapture?.stop().catch(() => {})
    await browserScreenCapture?.stop().catch(() => {})
    await processor?.destroy().catch(() => {})
    if (room) await room.disconnect(true).catch(() => {})
  }

  private isCurrentSession(channel: string, generation: number) {
    return this.requestedChannel === channel && this.sessionGeneration === generation
  }

  private isCurrentRoom(room: Room, channel: string, generation: number) {
    return this.room === room && this.isCurrentSession(channel, generation)
  }

  private warnAudioPlaybackBlocked() {
    if (this.audioPlaybackWarningShown) return
    this.audioPlaybackWarningShown = true
    this.options.onError('O navegador bloqueou o audio automatico. Clique em qualquer controle da chamada para liberar o som.')
  }

  private fail(message: string) {
    this.state = { ...this.state, error: message }
    this.emit()
    this.options.onError(message)
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state)
  }
}

function mediaError(error: unknown, fallback: string) {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'O microfone e a câmera exigem conexão segura (HTTPS) ou o aplicativo Desktop.'
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'A permissão de mídia foi negada pelo navegador.'
    if (error.name === 'NotFoundError') return 'Nenhum dispositivo compatível foi encontrado.'
    if (error.name === 'NotReadableError') return 'O dispositivo está ocupado por outro aplicativo.'
  }
  if (error instanceof Error && error.message) {
    // O SDK costuma trazer aqui a causa de rede/codec. Redigimos qualquer JWT
    // ou parametro de autenticacao antes de mostrar o diagnostico local.
    const detail = error.message
      .replace(/eyJ[A-Za-z0-9._-]+/g, '[token]')
      .replace(/([?&](?:access_token|token)=)[^&\s]+/gi, '$1[redigido]')
      .slice(0, 220)
    return `${fallback} ${detail}`
  }
  return fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

function statNumber(stats: Record<string, unknown>, key: string) {
  const value = stats[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * No computador que hospeda o Stapp, o loopback e a rota correta e direta para o navegador.
 * Redireciona enderecos ws: para localhost quando o app roda no host local no navegador.
 * Clientes Desktop (Tauri), conexoes seguras (wss:) e acessos de outras maquinas mantem o host original.
 */
export function mediaUrlForThisDevice(raw: string) {
  try {
    const url = new URL(raw)
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    const localPage = !isTauri && typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    if (localPage && url.protocol === 'ws:') {
      url.hostname = location.hostname
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}
