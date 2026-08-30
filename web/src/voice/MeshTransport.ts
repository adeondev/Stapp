import type { PeerId, RtcPayload, ServerMsg, VoiceConfig } from '../protocol'
import type {
  DiagnosticReport,
  MediaDeviceLists,
  VoiceSnapshot,
  VoiceTransport,
  VoiceTransportOptions,
} from './VoiceTransport'
import { loadVoicePreferences, saveVoicePreferences } from './preferences'
import type { ScreenPreset, StreamQuality, VoicePreferences } from './preferences'

interface PeerLink {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  /** Candidatos que chegaram antes da descricao remota. */
  pendingIce: RTCIceCandidateInit[]
}

interface Monitor {
  /** Guardados de proposito: sem referencia viva o GC recolhe os nos e o
   *  analyser passa a ler silencio para sempre. */
  source: MediaStreamAudioSourceNode
  sink: GainNode
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  lastLoud: number
  speaking: boolean
}

/** ~43ms de audio por leitura a 48kHz — janela larga o bastante para nao cair
 *  no vao entre duas silabas. */
const FFT_SIZE = 2048
const SPEAKING_LEVEL = 8
/** Segura o indicador aceso um instante para nao piscar entre silabas. */
const SPEAKING_HOLD_MS = 250

/**
 * Voz P2P: cada um manda o proprio audio direto para cada outro. O servidor so
 * repassa offer/answer/ICE.
 *
 * Limite conhecido: ~6 pessoas. Cada participante sobe uma copia do audio para
 * todos os outros, entao o upload cresce junto com a sala.
 */
export class MeshTransport implements VoiceTransport {
  private local: MediaStream | null = null
  private channel: string | null = null
  private muted = false
  private deafened = false

  private readonly peers = new Map<PeerId, PeerLink>()
  private readonly monitors = new Map<PeerId, Monitor>()
  private audioCtx: AudioContext | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<(snapshot: VoiceSnapshot) => void>()
  private preferences = loadVoicePreferences()
  private state: VoiceSnapshot = {
    status: 'idle', channel: null, muted: false, deafened: false,
    cameraEnabled: false, screenSharing: false, screenHasAudio: null,
    participants: [], media: [], error: null,
  }

  constructor(
    private readonly config: Extract<VoiceConfig, { backend: 'mesh' }>,
    private readonly options: VoiceTransportOptions,
  ) {}

  async join(channel: string): Promise<boolean> {
    if (this.channel) this.leave()

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.options.onError(
        'o navegador so libera o microfone em localhost ou HTTPS — pelo IP da rede a voz nao funciona',
      )
      return false
    }

    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(),
        video: false,
      })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      this.options.onError(
        name === 'NotAllowedError'
          ? 'voce negou o acesso ao microfone'
          : name === 'NotFoundError'
            ? 'nenhum microfone encontrado'
            : 'nao consegui abrir o microfone',
      )
      return false
    }

    this.channel = channel
    this.applyLocalState()
    this.watch(this.options.selfPeerId, this.local)
    this.options.send({ t: 'voice.join', channel })
    this.state = {
      ...this.state,
      status: 'connected',
      channel,
      participants: [this.localParticipant()],
      error: null,
    }
    this.emit()
    return true
  }

  handleServerMessage(msg: ServerMsg) {
    if (!this.channel) return

    switch (msg.t) {
      // Chegamos agora: **nos** fazemos a offer para todo mundo que ja estava.
      // Quem estava so responde. E isso que evita glare — ver CLAUDE.md.
      case 'voice.roster':
        if (msg.channel === this.channel) {
          for (const peer of msg.peers) void this.offerTo(peer.peer_id)
          this.state = {
            ...this.state,
            participants: [this.localParticipant(), ...msg.peers.map((peer) => ({
              peerId: peer.peer_id, name: peer.username, local: false, speaking: false,
              microphone: !peer.muted, camera: false, screen: false, quality: 'unknown' as const,
            }))],
          }
          this.emit()
        }
        break

      // Alguem entrou depois de nos: quem chega e que oferece, entao aqui so
      // esperamos a offer aparecer em rtc.signal.
      case 'voice.joined':
        if (msg.peer.channel === this.channel && msg.peer.peer_id !== this.options.selfPeerId) {
          this.state = {
            ...this.state,
            participants: [
              ...this.state.participants.filter((peer) => peer.peerId !== msg.peer.peer_id),
              { peerId: msg.peer.peer_id, name: msg.peer.username, local: false, speaking: false,
                microphone: !msg.peer.muted, camera: false, screen: false, quality: 'unknown' },
            ],
          }
          this.emit()
        }
        break
      case 'voice.left':
        this.dropPeer(msg.peer_id)
        this.state = {
          ...this.state,
          participants: this.state.participants.filter((peer) => peer.peerId !== msg.peer_id),
        }
        this.emit()
        break

      case 'rtc.signal':
        void this.onSignal(msg.from, msg.payload)
        break

      default:
        break
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.applyLocalState()
    this.publishState()
    this.state = { ...this.state, muted, participants: this.withLocalState() }
    this.emit()
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened
    for (const link of this.peers.values()) link.audio.muted = deafened
    // Ensurdecer tambem cala o proprio microfone, como no Discord.
    this.applyLocalState()
    this.publishState()
    this.state = { ...this.state, deafened, muted: this.muted, participants: this.withLocalState() }
    this.emit()
  }

  leave() {
    if (!this.channel) return
    this.options.send({ t: 'voice.leave' })

    for (const id of [...this.peers.keys()]) this.dropPeer(id)

    this.stopWatching(this.options.selfPeerId)
    this.local?.getTracks().forEach((track) => track.stop())
    this.local = null
    this.channel = null
    this.muted = false
    this.deafened = false
    this.state = {
      ...this.state, status: 'idle', channel: null, muted: false, deafened: false,
      participants: [], media: [],
    }
    this.emit()
  }

  destroy() {
    this.leave()
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    void this.audioCtx?.close()
    this.audioCtx = null
    this.listeners.clear()
  }

  async resumeAudio() {
    await this.audioCtx?.resume().catch(() => {})
    const results = await Promise.all(
      [...this.peers.values()].map((link) => link.audio.play().then(() => true).catch(() => false)),
    )
    return results.every(Boolean)
  }

  async setCameraEnabled(_enabled: boolean) {
    this.options.onError('camera e compartilhamento exigem o backend LiveKit')
    return false
  }

  async setScreenShareEnabled(_enabled: boolean, _preset?: ScreenPreset, _sourceId?: string) {
    this.options.onError('camera e compartilhamento exigem o backend LiveKit')
    return false
  }

  async listScreenSources() {
    return []
  }

  async captureScreenSourceThumbnail(_sourceId: string) {
    return null
  }

  async setInputDevice(deviceId: string) {
    this.preferences.inputDeviceId = deviceId
    saveVoicePreferences(this.preferences)
    if (!this.channel) return
    const replacement = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints() })
    const track = replacement.getAudioTracks()[0]
    if (!track) return
    for (const link of this.peers.values()) {
      const sender = link.pc.getSenders().find((candidate) => candidate.track?.kind === 'audio')
      await sender?.replaceTrack(track)
    }
    this.local?.getTracks().forEach((old) => old.stop())
    this.local = replacement
    this.applyLocalState()
  }

  async setOutputDevice(deviceId: string) {
    this.preferences.outputDeviceId = deviceId
    saveVoicePreferences(this.preferences)
    for (const link of this.peers.values()) {
      if ('setSinkId' in link.audio) {
        await (link.audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId)
      }
    }
  }

  async setCameraDevice(deviceId: string) {
    this.preferences.cameraDeviceId = deviceId
    saveVoicePreferences(this.preferences)
  }

  async enumerateDevices(): Promise<MediaDeviceLists> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      inputs: devices.filter((device) => device.kind === 'audioinput'),
      outputs: devices.filter((device) => device.kind === 'audiooutput'),
      cameras: devices.filter((device) => device.kind === 'videoinput'),
    }
  }

  async startMicrophoneTest(onLevel: (level: number) => void) {
    const { startMicrophoneTest } = await import('./testMicrophone')
    return startMicrophoneTest(this.audioConstraints(), onLevel)
  }

  async startCameraPreview(element: HTMLVideoElement) {
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

  setPublicationSubscribed(_publicationId: string, _subscribed: boolean) {}
  setPublicationQuality(_publicationId: string, _quality: StreamQuality) {}

  setParticipantVolume(peerId: PeerId, volume: number) {
    const link = this.peers.get(peerId)
    if (link) link.audio.volume = Math.min(1, Math.max(0, volume / 100))
  }

  setPublicationVolume(_publicationId: string, _volume: number) {}
  attachMedia(_publicationId: string, _element: HTMLMediaElement) { return () => {} }
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
    if (patch.outputDeviceId !== undefined && patch.outputDeviceId !== previous.outputDeviceId) {
      await this.setOutputDevice(patch.outputDeviceId)
    }
    if (patch.inputDeviceId !== undefined && patch.inputDeviceId !== previous.inputDeviceId) {
      await this.setInputDevice(patch.inputDeviceId)
    }
  }
  async diagnosticReport(): Promise<DiagnosticReport> {
    return {
      generatedAt: new Date().toISOString(), backend: 'mesh', status: this.state.status,
      quality: this.peers.size ? 'conectado' : 'sem pares',
    }
  }

  // ------------------------------------------------------------------ pares

  private ensurePeer(peerId: PeerId): PeerLink {
    const existing = this.peers.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({
      iceServers: this.config.ice_servers.length ? [{ urls: this.config.ice_servers }] : [],
    })

    for (const track of this.local?.getTracks() ?? []) {
      pc.addTrack(track, this.local!)
    }

    const audio = document.createElement('audio')
    audio.autoplay = true
    audio.muted = this.deafened
    // Fora do DOM alguns navegadores nao tocam o stream.
    audio.style.display = 'none'
    document.body.append(audio)

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.signal(peerId, { kind: 'ice', candidate: event.candidate.toJSON() })
      }
    })

    pc.addEventListener('track', (event) => {
      const stream = event.streams[0]
      if (!stream) return
      audio.srcObject = stream
      void audio.play().catch(() => {})
      this.watch(peerId, stream)
    })

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        this.options.onError('a conexao de voz com alguem caiu')
      }
    })

    const link: PeerLink = { pc, audio, pendingIce: [] }
    this.peers.set(peerId, link)
    return link
  }

  private async offerTo(peerId: PeerId) {
    const link = this.ensurePeer(peerId)
    const offer = await link.pc.createOffer()
    await link.pc.setLocalDescription(offer)
    this.signal(peerId, { kind: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
  }

  private async onSignal(from: PeerId, payload: RtcPayload) {
    switch (payload.kind) {
      case 'offer': {
        const link = this.ensurePeer(from)
        await link.pc.setRemoteDescription(payload.sdp)
        await this.flushIce(link)
        const answer = await link.pc.createAnswer()
        await link.pc.setLocalDescription(answer)
        this.signal(from, { kind: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
        break
      }
      case 'answer': {
        const link = this.peers.get(from)
        if (!link) return
        await link.pc.setRemoteDescription(payload.sdp)
        await this.flushIce(link)
        break
      }
      case 'ice': {
        const link = this.peers.get(from)
        if (!link) return
        if (link.pc.remoteDescription) {
          await link.pc.addIceCandidate(payload.candidate).catch(() => {})
        } else {
          link.pendingIce.push(payload.candidate)
        }
        break
      }
    }
  }

  private async flushIce(link: PeerLink) {
    const queued = link.pendingIce.splice(0)
    for (const candidate of queued) {
      await link.pc.addIceCandidate(candidate).catch(() => {})
    }
  }

  private dropPeer(peerId: PeerId) {
    const link = this.peers.get(peerId)
    if (!link) return
    link.pc.close()
    link.audio.srcObject = null
    link.audio.remove()
    this.peers.delete(peerId)
    this.stopWatching(peerId)
  }

  private signal(to: PeerId, payload: RtcPayload) {
    this.options.send({ t: 'rtc.signal', to, payload })
  }

  private applyLocalState() {
    const live = !this.muted && !this.deafened
    for (const track of this.local?.getAudioTracks() ?? []) {
      track.enabled = live
    }
  }

  private publishState() {
    if (!this.channel) return
    this.options.send({
      t: 'voice.state', muted: this.muted, deafened: this.deafened,
      camera_enabled: false, screen_sharing: false,
    })
  }

  // ------------------------------------------------------- quem esta falando

  private watch(peerId: PeerId, stream: MediaStream) {
    this.audioCtx ??= new AudioContext()
    void this.audioCtx.resume().catch(() => {})

    const analyser = this.audioCtx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    const source = this.audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)

    // O Chrome so processa o grafo que chega ate a saida. Sem este trecho o
    // analyser fica num ramo solto e le silencio. O ganho zero mantem o grafo
    // vivo sem tocar nada — o audio dos outros sai pelos <audio>, nao por aqui.
    const sink = this.audioCtx.createGain()
    sink.gain.value = 0
    analyser.connect(sink)
    sink.connect(this.audioCtx.destination)

    this.monitors.set(peerId, {
      source,
      sink,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      lastLoud: 0,
      speaking: false,
    })

    this.ticker ??= setInterval(this.tick, 100)
  }

  private stopWatching(peerId: PeerId) {
    const monitor = this.monitors.get(peerId)
    if (!monitor) return
    monitor.source.disconnect()
    monitor.analyser.disconnect()
    monitor.sink.disconnect()
    this.monitors.delete(peerId)
    if (monitor.speaking) this.options.onSpeaking(peerId, false)
  }

  private readonly tick = () => {
    const now = performance.now()
    for (const [peerId, monitor] of this.monitors) {
      monitor.analyser.getByteTimeDomainData(monitor.data)

      let sum = 0
      for (const sample of monitor.data) {
        const delta = sample - 128
        sum += delta * delta
      }
      const level = Math.sqrt(sum / monitor.data.length)
      if (level > SPEAKING_LEVEL) monitor.lastLoud = now

      const speaking = now - monitor.lastLoud < SPEAKING_HOLD_MS
      if (speaking !== monitor.speaking) {
        monitor.speaking = speaking
        this.options.onSpeaking(peerId, speaking)
        this.state = {
          ...this.state,
          participants: this.state.participants.map((peer) =>
            peer.peerId === peerId ? { ...peer, speaking } : peer,
          ),
        }
        this.emit()
      }
    }
  }

  private audioConstraints(): MediaTrackConstraints {
    return {
      deviceId: this.preferences.inputDeviceId || undefined,
      echoCancellation: this.preferences.echoCancellation,
      noiseSuppression: this.preferences.noiseMode !== 'off',
      autoGainControl: this.preferences.autoGainControl,
      channelCount: 1,
      sampleRate: 48_000,
    }
  }

  private localParticipant() {
    return {
      peerId: this.options.selfPeerId,
      name: 'Voce',
      local: true,
      speaking: this.monitors.get(this.options.selfPeerId)?.speaking ?? false,
      microphone: !this.muted && !this.deafened,
      camera: false,
      screen: false,
      quality: 'unknown' as const,
    }
  }

  private withLocalState() {
    return this.state.participants.map((peer) =>
      peer.local ? { ...peer, microphone: !this.muted && !this.deafened } : peer,
    )
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state)
  }
}
