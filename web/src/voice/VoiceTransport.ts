import type { ClientMsg, PeerId, ServerMsg, VoiceConfig } from '../protocol'
import type { ScreenSource } from '../platform/screenCapture'
import { LiveKitTransport } from './LiveKitTransport'
import { MeshTransport } from './MeshTransport'
import type { ScreenPreset, StreamQuality, VoicePreferences } from './preferences'

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
  error: string | null
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
}

export interface VoiceTransport {
  join(channel: string): Promise<boolean>
  leave(): void
  resumeAudio(): Promise<boolean>
  setMuted(muted: boolean): void
  setDeafened(deafened: boolean): void
  setCameraEnabled(enabled: boolean): Promise<boolean>
  setScreenShareEnabled(enabled: boolean, preset?: ScreenPreset, sourceId?: string): Promise<boolean>
  listScreenSources(): Promise<ScreenSource[]>
  captureScreenSourceThumbnail(sourceId: string): Promise<string | null>
  setInputDevice(deviceId: string): Promise<void>
  setOutputDevice(deviceId: string): Promise<void>
  setCameraDevice(deviceId: string): Promise<void>
  enumerateDevices(): Promise<MediaDeviceLists>
  startMicrophoneTest(onLevel: (level: number) => void): Promise<() => void>
  startCameraPreview(element: HTMLVideoElement): Promise<() => void>
  setPublicationSubscribed(publicationId: string, subscribed: boolean): void
  setPublicationQuality(publicationId: string, quality: StreamQuality): void
  setParticipantVolume(peerId: PeerId, volume: number): void
  setPublicationVolume(publicationId: string, volume: number): void
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
  switch (config.backend) {
    case 'mesh':
      return new MeshTransport(config, options)
    case 'livekit':
      return new LiveKitTransport(config, options)
  }
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
    error: null,
  }
}
