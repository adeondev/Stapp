import type { ClientMsg, PeerId, ServerMsg, VoiceConfig } from '../protocol'
import type { ScreenSource } from '../platform/screenCapture'
import { LiveKitTransport } from './LiveKitTransport'
import { MeshTransport } from './MeshTransport'
import type { ScreenPreset, VoicePreferences } from './preferences'

export type VoiceConnectionStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'

export interface VoiceParticipantState {
  peerId: PeerId
  name: string
  local: boolean
  speaking: boolean
  microphone: boolean
  camera: boolean
  screen: boolean
  quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
}

export interface VoiceMediaState {
  id: string
  peerId: PeerId
  name: string
  kind: 'camera' | 'screen'
  local: boolean
  subscribed: boolean
  muted: boolean
  width?: number
  height?: number
}

export interface VoiceSnapshot {
  status: VoiceConnectionStatus
  channel: string | null
  muted: boolean
  deafened: boolean
  cameraEnabled: boolean
  screenSharing: boolean
  screenHasAudio: boolean | null
  participants: VoiceParticipantState[]
  media: VoiceMediaState[]
  audioProcessor: AudioProcessorState
  error: string | null
}

export interface AudioProcessorState {
  status: 'idle' | 'starting' | 'active' | 'fallback'
  effective: 'none' | 'standard' | 'rnnoise'
  error?: string
}

export interface MediaDeviceLists {
  inputs: MediaDeviceInfo[]
  outputs: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
}

export interface DiagnosticReport {
  generatedAt: string
  backend: string
  status: VoiceConnectionStatus
  codec?: string
  resolution?: string
  fps?: number
  bitrateKbps?: number
  rttMs?: number
  packetLossPercent?: number
  jitterMs?: number
  quality?: string
  audioProcessor?: string
  audioSampleRate?: number
  audioProcessorError?: string
  screenAudioMode?: string
  screenAudioProcessId?: number
  screenAudioWindowsBuild?: number
  screenAudioValidation?: string
  screenAudioRuntime?: 'web' | 'tauri'
  screenAudioSurface?: string
  screenAudioOwnAudioSupported?: boolean
  screenAudioOwnAudioApplied?: boolean
  screenAudioProbeControlLevel?: number
  screenAudioProbeCaptureLevel?: number
  screenAudioBufferedMs?: number
  screenAudioPlaybackRate?: number
  screenAudioUnderruns?: number
  screenAudioDroppedFrames?: number
  audioPlayerCount?: number
  inboundAudio?: InboundAudioDiagnostic[]
}

export interface InboundAudioDiagnostic {
  publicationId: string
  peerId?: PeerId
  source: 'voice' | 'screen' | 'unknown'
  bitrateKbps?: number
  packetLossPercent?: number
  jitterMs?: number
  jitterBufferMs?: number
  concealedSamplesPercent?: number
  playerAttached: boolean
}

export interface ScreenShareOptions {
  preset?: ScreenPreset
  sourceId?: string
  includeAudio?: boolean
}

export interface VoiceTransport {
  join(channel: string): Promise<boolean>
  leave(): void
  resumeAudio(): Promise<boolean>
  setMuted(muted: boolean): void
  setDeafened(deafened: boolean): void
  setCameraEnabled(enabled: boolean): Promise<boolean>
  setScreenShareEnabled(enabled: boolean, options?: ScreenShareOptions): Promise<boolean>
  listScreenSources(): Promise<ScreenSource[]>
  captureScreenSourceThumbnail(sourceId: string): Promise<string | null>
  setInputDevice(deviceId: string): Promise<void>
  setOutputDevice(deviceId: string): Promise<void>
  setCameraDevice(deviceId: string): Promise<void>
  enumerateDevices(): Promise<MediaDeviceLists>
  startMicrophoneTest(onLevel: (level: number) => void): Promise<() => void>
  startCameraPreview(element: HTMLVideoElement): Promise<() => void>
  setPublicationSubscribed(publicationId: string, subscribed: boolean): void
  getVoiceVolume(peerId: PeerId): number
  setVoiceVolume(peerId: PeerId, volume: number): void
  setVoiceMuted(peerId: PeerId, muted: boolean): void
  getScreenShareVolume(peerId: PeerId): number
  setScreenShareVolume(peerId: PeerId, volume: number): void
  setScreenShareMuted(peerId: PeerId, muted: boolean): void
  attachMedia(publicationId: string, element: HTMLMediaElement): () => void
  snapshot(): VoiceSnapshot
  subscribe(listener: (snapshot: VoiceSnapshot) => void): () => void
  getPreferences(): VoicePreferences
  updatePreferences(patch: Partial<VoicePreferences>): Promise<void>
  diagnosticReport(): Promise<DiagnosticReport>
  handleServerMessage(msg: ServerMsg): void
  destroy(): void
}

export interface VoiceTransportOptions {
  selfPeerId: PeerId
  send(msg: ClientMsg): void
  onSpeaking(peerId: PeerId, speaking: boolean): void
  onError(message: string): void
}

export function createVoiceTransport(
  config: VoiceConfig,
  options: VoiceTransportOptions,
): VoiceTransport {
  if (config.backend === 'livekit') {
    return new LiveKitTransport(config, options)
  }
  // MeshTransport legado descontinuado; mantido como fallback com aviso no console
  console.warn('[VoiceTransport] O backend mesh P2P esta descontinuado. LiveKit SFU e o padrao definitivo.')
  return new MeshTransport(config, options)
}

export function emptySnapshot(): VoiceSnapshot {
  return {
    status: 'idle',
    channel: null,
    muted: false,
    deafened: false,
    cameraEnabled: false,
    screenSharing: false,
    screenHasAudio: null,
    participants: [],
    media: [],
    audioProcessor: { status: 'idle', effective: 'none' },
    error: null,
  }
}
