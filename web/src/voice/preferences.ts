export type NoiseMode = 'off' | 'standard' | 'enhanced'
export type InputMode = 'voice_activity' | 'push_to_talk'
export type CameraQuality = '720p' | '1080p'
export type ScreenPreset = 'economy' | 'balanced' | 'fluid' | 'original'
export type StreamQuality = 'auto' | 'low' | 'high' | 'original'

export interface VoicePreferences {
  inputDeviceId: string
  outputDeviceId: string
  cameraDeviceId: string
  inputVolume: number
  outputVolume: number
  attenuation: number
  inputMode: InputMode
  pttShortcut: string
  pttReleaseDelay: number
  automaticSensitivity: boolean
  sensitivity: number
  echoCancellation: boolean
  autoGainControl: boolean
  noiseMode: NoiseMode
  cameraQuality: CameraQuality
  mirrorPreview: boolean
  showSelf: boolean
  showVideoOffParticipants: boolean
  screenPreset: ScreenPreset
  streamQuality: StreamQuality
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  inputDeviceId: '',
  outputDeviceId: '',
  cameraDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  attenuation: 0,
  inputMode: 'voice_activity',
  pttShortcut: 'Control+Space',
  pttReleaseDelay: 120,
  automaticSensitivity: true,
  sensitivity: -50,
  echoCancellation: true,
  autoGainControl: true,
  noiseMode: 'standard',
  cameraQuality: '720p',
  mirrorPreview: true,
  showSelf: true,
  showVideoOffParticipants: true,
  screenPreset: 'balanced',
  streamQuality: 'auto',
}

const STORAGE_KEY = 'stapp.voice.preferences.v1'

export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_VOICE_PREFERENCES }
    const value = JSON.parse(raw) as Partial<VoicePreferences>
    return sanitize({ ...DEFAULT_VOICE_PREFERENCES, ...value })
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES }
  }
}

export function saveVoicePreferences(preferences: VoicePreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(preferences)))
}

export function resetVoicePreferences(): VoicePreferences {
  localStorage.removeItem(STORAGE_KEY)
  return { ...DEFAULT_VOICE_PREFERENCES }
}

function sanitize(value: VoicePreferences): VoicePreferences {
  return {
    inputDeviceId: stringValue(value.inputDeviceId),
    outputDeviceId: stringValue(value.outputDeviceId),
    cameraDeviceId: stringValue(value.cameraDeviceId),
    inputVolume: clamp(value.inputVolume, 0, 200),
    outputVolume: clamp(value.outputVolume, 0, 200),
    attenuation: clamp(value.attenuation, 0, 100),
    inputMode: oneOf(value.inputMode, ['voice_activity', 'push_to_talk'], DEFAULT_VOICE_PREFERENCES.inputMode),
    pttShortcut: stringValue(value.pttShortcut) || DEFAULT_VOICE_PREFERENCES.pttShortcut,
    pttReleaseDelay: clamp(value.pttReleaseDelay, 0, 2000),
    automaticSensitivity: booleanValue(value.automaticSensitivity, true),
    sensitivity: clamp(value.sensitivity, -100, 0),
    echoCancellation: booleanValue(value.echoCancellation, true),
    autoGainControl: booleanValue(value.autoGainControl, true),
    noiseMode: oneOf(value.noiseMode, ['off', 'standard', 'enhanced'], DEFAULT_VOICE_PREFERENCES.noiseMode),
    cameraQuality: oneOf(value.cameraQuality, ['720p', '1080p'], DEFAULT_VOICE_PREFERENCES.cameraQuality),
    mirrorPreview: booleanValue(value.mirrorPreview, true),
    showSelf: booleanValue(value.showSelf, true),
    showVideoOffParticipants: booleanValue(value.showVideoOffParticipants, true),
    screenPreset: oneOf(value.screenPreset, ['economy', 'balanced', 'fluid', 'original'], DEFAULT_VOICE_PREFERENCES.screenPreset),
    streamQuality: oneOf(value.streamQuality, ['auto', 'low', 'high', 'original'], DEFAULT_VOICE_PREFERENCES.streamQuality),
  }
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 160) : ''
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  const number = Number.isFinite(value) ? value : min
  return Math.min(max, Math.max(min, number))
}
