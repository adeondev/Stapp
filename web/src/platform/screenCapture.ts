import screenAudioWorkletUrl from './screen-audio-worklet.ts?worker&url'

export type ScreenSourceKind = 'screen' | 'window'

export interface ScreenSource {
  id: string
  name: string
  kind: ScreenSourceKind
  width: number
  height: number
}

export interface NativeScreenCapture {
  stream: MediaStream
  track: MediaStreamTrack
  audioTrack?: MediaStreamTrack
  hasAudio: boolean
  audioError?: string
  audioValidation?: AudioExclusionValidation
  audioPlaybackStats?: ScreenAudioPlaybackStats
  ended: Promise<string>
  stop(): Promise<void>
}

export interface ScreenAudioPlaybackStats {
  bufferedFrames: number
  playbackRate: number
  buffering: boolean
  underruns: number
  droppedFrames: number
}

export interface BrowserScreenCapture {
  stream: MediaStream
  track: MediaStreamTrack
  audioTrack?: MediaStreamTrack
  hasAudio: boolean
  audioError?: string
  audioValidation?: BrowserAudioExclusionValidation
  ended: Promise<string>
  stop(): Promise<void>
}

export interface BrowserAudioExclusionValidation {
  safe: boolean
  supported: boolean
  applied: boolean
  displaySurface?: string
  controlLevel: number
  captureLevel: number
  reason: string
}

export interface AudioExclusionValidation {
  safe: boolean
  processId: number
  windowsBuild?: number
  includeLevel: number
  excludeLevel: number
  reason: string
}

type AudioValidationEvent =
  | { event: 'ready' }
  | { event: 'failed'; reason: string }

let cachedAudioExclusionValidation: Promise<AudioExclusionValidation> | null = null

export function resetAudioExclusionValidationCache() {
  cachedAudioExclusionValidation = null
}

type CaptureEvent =
  | {
      event: 'frame'
      capture_id: number
      width: number
      height: number
      jpeg_base64: string
    }
  | {
      event: 'audio_format'
      capture_id: number
      sample_rate: number
      channels: number
    }
  | { event: 'audio_chunk'; capture_id: number; pcm_base64: string }
  | { event: 'audio_unavailable'; capture_id: number; reason: string }
  | { event: 'ended'; capture_id: number; reason: string }

export function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window
}

export async function listScreenSources(): Promise<ScreenSource[]> {
  if (!isTauriRuntime()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<ScreenSource[]>('list_screen_sources')
}

export async function captureScreenSourceThumbnail(sourceId: string): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('capture_screen_source_thumbnail', { sourceId })
}

export function thumbnailDataUrl(base64: string | null) {
  return base64 ? `data:image/png;base64,${base64}` : null
}

interface DisplayAudioConstraints extends MediaTrackConstraints {
  restrictOwnAudio?: ConstrainBoolean
}

interface StappDisplayMediaOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface?: 'include' | 'exclude'
  surfaceSwitching?: 'include' | 'exclude'
  systemAudio?: 'include' | 'exclude'
  windowAudio?: 'exclude' | 'system' | 'window'
}

interface DisplayAudioSettings extends MediaTrackSettings {
  restrictOwnAudio?: boolean
}

interface DisplayVideoSettings extends MediaTrackSettings {
  displaySurface?: string
}

export async function startBrowserScreenCapture(options: {
  maxWidth: number
  maxHeight: number
  fps: number
  includeAudio: boolean
  contentHint: 'detail' | 'motion'
}): Promise<BrowserScreenCapture> {
  if (isTauriRuntime()) throw new Error('captura web indisponivel dentro do aplicativo')
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('este navegador nao oferece compartilhamento de tela')
  }

  const audio: false | DisplayAudioConstraints = options.includeAudio
    ? {
        restrictOwnAudio: true,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48_000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false
  const constraints: StappDisplayMediaOptions = {
    audio,
    video: {
      width: { ideal: options.maxWidth },
      height: { ideal: options.maxHeight },
      frameRate: { ideal: options.fps },
    },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: options.includeAudio ? 'include' : 'exclude',
    windowAudio: options.includeAudio ? 'window' : 'exclude',
  }
  const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
  const track = stream.getVideoTracks()[0]
  if (!track) {
    for (const mediaTrack of stream.getTracks()) mediaTrack.stop()
    throw new Error('a fonte escolhida nao forneceu video')
  }
  track.contentHint = options.contentHint

  let stopped = false
  let resolveEnded!: (reason: string) => void
  const ended = new Promise<string>((resolve) => { resolveEnded = resolve })
  track.addEventListener('ended', () => resolveEnded('a fonte compartilhada foi encerrada'), { once: true })

  let audioTrack = options.includeAudio ? stream.getAudioTracks()[0] : undefined
  let audioValidation: BrowserAudioExclusionValidation | undefined
  let audioError: string | undefined
  if (audioTrack) {
    audioTrack.contentHint = 'music'
    const supported = Boolean(
      (navigator.mediaDevices.getSupportedConstraints?.() as MediaTrackSupportedConstraints & {
        restrictOwnAudio?: boolean
      } | undefined)?.restrictOwnAudio,
    )
    try {
      await audioTrack.applyConstraints({
        restrictOwnAudio: { exact: true },
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48_000 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as DisplayAudioConstraints)
    } catch (error) {
      audioError = mediaErrorMessage(error, 'o navegador nao aplicou a exclusao do audio do Stapp')
    }
    const applied = (audioTrack.getSettings() as DisplayAudioSettings).restrictOwnAudio === true
    const displaySurface = (track.getSettings() as DisplayVideoSettings).displaySurface
    audioValidation = audioError
      ? {
          safe: false, supported, applied, displaySurface,
          controlLevel: 0, captureLevel: 0, reason: audioError,
        }
      : await validateBrowserAudioExclusion(audioTrack, supported, applied, displaySurface)
    if (!audioValidation.safe) {
      audioError = audioValidation.reason
      stream.removeTrack(audioTrack)
      audioTrack.stop()
      audioTrack = undefined
    }
  } else if (options.includeAudio) {
    audioError = 'a fonte escolhida nao forneceu audio'
  }

  return {
    stream,
    track,
    audioTrack,
    hasAudio: Boolean(audioTrack),
    audioError,
    audioValidation,
    ended,
    async stop() {
      if (stopped) return
      stopped = true
      for (const mediaTrack of stream.getTracks()) mediaTrack.stop()
    },
  }
}

export function browserAudioExclusionIsSafe(
  supported: boolean,
  applied: boolean,
  controlLevel: number,
  captureLevel: number,
) {
  return supported
    && applied
    && controlLevel >= 0.002
    && captureLevel <= Math.max(0.0007, controlLevel * 0.18)
}

async function validateBrowserAudioExclusion(
  _track: MediaStreamTrack,
  supported: boolean,
  applied: boolean,
  displaySurface?: string,
): Promise<BrowserAudioExclusionValidation> {
  if (!supported || !applied) {
    return {
      safe: false, supported, applied, displaySurface,
      controlLevel: 0, captureLevel: 0,
      reason: 'o navegador nao confirmou restrictOwnAudio; atualize Chrome/Edge ou use o aplicativo',
    }
  }

  // Com restrictOwnAudio suportado e aplicado pelo navegador,
  // a exclusao de audio e garantida nativamente pela plataforma sem probe sonoro intrusivo.
  return {
    safe: true,
    supported,
    applied,
    displaySurface,
    controlLevel: 1.0,
    captureLevel: 0.0,
    reason: 'restrictOwnAudio aplicado com sucesso',
  }
}

export async function startNativeScreenCapture(options: {
  sourceId: string
  maxWidth: number
  maxHeight: number
  fps: number
  includeAudio: boolean
}): Promise<NativeScreenCapture> {
  if (!isTauriRuntime()) throw new Error('captura nativa disponivel somente no aplicativo')

  const canvas = document.createElement('canvas')
  canvas.width = options.maxWidth
  canvas.height = options.maxHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('o renderizador de captura nao esta disponivel')

  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const fullScreenAudio = options.includeAudio && options.sourceId.startsWith('screen:')
  const audioValidation = fullScreenAudio
    ? await validateAudioExclusion(Channel, invoke)
    : undefined
  const includeAudio = options.includeAudio && (!fullScreenAudio || audioValidation?.safe === true)
  const channel = new Channel<CaptureEvent>()
  let captureId = 0
  let stopped = false
  let latestFrame: Extract<CaptureEvent, { event: 'frame' }> | null = null
  let decoding = false
  let firstFrameDone = false
  let resolveFirstFrame!: () => void
  let rejectFirstFrame!: (error: Error) => void
  let resolveEnded!: (reason: string) => void
  let audioPipeline: Awaited<ReturnType<typeof createAudioPipeline>> | null = null
  let audioConfirmed = false
  let audioError: string | undefined = fullScreenAudio && audioValidation && !audioValidation.safe
    ? `o Windows nao confirmou a exclusao do Stapp: ${audioValidation.reason}`
    : undefined
  let resolveAudioReady!: (available: boolean) => void
  let audioReadySettled = false
  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirstFrame = resolve
    rejectFirstFrame = reject
  })
  const ended = new Promise<string>((resolve) => { resolveEnded = resolve })
  const audioReady = new Promise<boolean>((resolve) => { resolveAudioReady = resolve })

  if (includeAudio) {
    try {
      audioPipeline = await createAudioPipeline()
    } catch (error) {
      audioError = mediaErrorMessage(error, 'o WebView nao conseguiu reconstruir o audio')
      audioReadySettled = true
      resolveAudioReady(false)
    }
  } else {
    audioReadySettled = true
    resolveAudioReady(false)
  }

  const finishAudioReady = (available: boolean) => {
    if (audioReadySettled) return
    audioReadySettled = true
    resolveAudioReady(available)
  }

  const drawLatest = async () => {
    if (decoding) return
    decoding = true
    try {
      while (latestFrame && !stopped) {
        const frame = latestFrame
        latestFrame = null
        const bytes = decodeBase64(frame.jpeg_base64)
        const bitmap = await createImageBitmap(
          new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
        )
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width
          canvas.height = frame.height
        }
        context.drawImage(bitmap, 0, 0, frame.width, frame.height)
        bitmap.close()
        if (!firstFrameDone) {
          firstFrameDone = true
          resolveFirstFrame()
        }
      }
    } finally {
      decoding = false
    }
  }

  channel.onmessage = (event) => {
    if (event.event === 'ended') {
      const error = new Error(event.reason)
      if (!firstFrameDone) rejectFirstFrame(error)
      resolveEnded(event.reason)
      return
    }
    if (event.event === 'audio_unavailable') {
      audioError = event.reason
      finishAudioReady(false)
      return
    }
    if (event.event === 'audio_format') {
      if (!audioPipeline) {
        audioError ??= 'o processador de audio do WebView nao esta disponivel'
        finishAudioReady(false)
        return
      }
      if (event.sample_rate !== audioPipeline.context.sampleRate || event.channels !== 2) {
        audioError = `formato nativo inesperado (${event.sample_rate} Hz, ${event.channels} canais)`
        finishAudioReady(false)
        return
      }
      audioConfirmed = true
      finishAudioReady(true)
      return
    }
    if (event.event === 'audio_chunk') {
      if (!audioConfirmed || !audioPipeline) return
      const bytes = decodeBase64(event.pcm_base64)
      const buffer = bytes.buffer as ArrayBuffer
      audioPipeline.node.port.postMessage({ t: 'pcm', buffer }, [buffer])
      return
    }
    latestFrame = event
    void drawLatest()
  }

  try {
    captureId = await invoke<number>('start_screen_capture', {
      sourceId: options.sourceId,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      fps: options.fps,
      includeAudio: includeAudio && Boolean(audioPipeline),
      channel,
    })
  } catch (error) {
    await audioPipeline?.close()
    throw error
  }

  const timeout = window.setTimeout(() => {
    rejectFirstFrame(new Error('a primeira imagem da captura demorou demais'))
  }, 3_000)
  try {
    await firstFrame
  } catch (error) {
    await invoke('stop_screen_capture', { captureId }).catch(() => {})
    await audioPipeline?.close()
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  const stream = canvas.captureStream(Math.min(options.fps, 30))
  const track = stream.getVideoTracks()[0]
  if (!track) {
    await invoke('stop_screen_capture', { captureId }).catch(() => {})
    await audioPipeline?.close()
    throw new Error('nao foi possivel criar a faixa de video da captura')
  }
  track.contentHint = 'detail'

  let hasAudio = false
  if (includeAudio && audioPipeline) {
    hasAudio = await Promise.race([
      audioReady,
      new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 1_500)),
    ])
    if (!hasAudio) {
      audioError ??= 'a captura nativa de audio nao respondeu'
      await audioPipeline.close()
      audioPipeline = null
    }
  }
  const audioTrack = hasAudio ? audioPipeline?.track : undefined
  if (audioTrack) stream.addTrack(audioTrack)

  return {
    stream,
    track,
    audioTrack,
    hasAudio,
    audioError,
    audioValidation,
    audioPlaybackStats: audioPipeline?.stats,
    ended,
    async stop() {
      if (stopped) return
      stopped = true
      await invoke('stop_screen_capture', { captureId }).catch(() => {})
      for (const mediaTrack of stream.getTracks()) mediaTrack.stop()
      await audioPipeline?.close()
      audioPipeline = null
    },
  }
}

export async function validateAudioExclusion(
  Channel: typeof import('@tauri-apps/api/core')['Channel'],
  invoke: typeof import('@tauri-apps/api/core')['invoke'],
) {
  cachedAudioExclusionValidation ??= (async () => {
    const channel = new Channel<AudioValidationEvent>()
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    channel.onmessage = (event) => {
      if (event.event === 'ready') {
        resolveReady()
      } else if (event.event === 'failed') {
        rejectReady(new Error(event.reason))
      }
    }
    const validation = invoke<AudioExclusionValidation>('validate_screen_audio_exclusion', { channel })
    const earlyFailure = validation.then((result) => {
      if (!result.safe) {
        throw new Error(result.reason)
      }
      return new Promise<never>(() => {})
    })
    await Promise.race([
      ready,
      earlyFailure,
      new Promise<never>((_, reject) => window.setTimeout(
        () => reject(new Error('a validacao nativa de audio nao ficou pronta')),
        5_000,
      )),
    ])
    return await validation
  })().catch((error) => ({
    safe: false,
    processId: 0,
    includeLevel: 0,
    excludeLevel: 0,
    reason: mediaErrorMessage(error, 'a validacao de exclusao falhou'),
  }))
  const result = await cachedAudioExclusionValidation
  if (!result.safe) {
    cachedAudioExclusionValidation = null
  }
  console.info('[screen-audio] validacao de exclusao', result)
  return result
}

async function createAudioPipeline() {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
  try {
    await context.audioWorklet.addModule(screenAudioWorkletUrl)
    const node = new AudioWorkletNode(context, 'stapp-screen-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    })
    const destination = context.createMediaStreamDestination()
    const stats: ScreenAudioPlaybackStats = {
      bufferedFrames: 0,
      playbackRate: 1,
      buffering: true,
      underruns: 0,
      droppedFrames: 0,
    }
    node.port.addEventListener('message', (event: MessageEvent<ScreenAudioPlaybackStats & { t?: string }>) => {
      if (event.data.t !== 'stats') return
      stats.bufferedFrames = event.data.bufferedFrames
      stats.playbackRate = event.data.playbackRate
      stats.buffering = event.data.buffering
      stats.underruns = event.data.underruns
      stats.droppedFrames = event.data.droppedFrames
    })
    node.port.start()
    node.connect(destination)
    const track = destination.stream.getAudioTracks()[0]
    if (!track) throw new Error('o processador nao criou uma faixa de audio')
    await context.resume()
    return {
      context,
      node,
      track,
      stats,
      async close() {
        node.port.postMessage({ t: 'destroy' })
        node.disconnect()
        destination.disconnect()
        track.stop()
        await context.close().catch(() => {})
      },
    }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

function mediaErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
