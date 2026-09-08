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
  videoStats?: ScreenVideoStats
  ended: Promise<string>
  stop(): Promise<void>
}

/**
 * Retrato do laco nativo. Os nomes sao `snake_case` porque vem direto do serde
 * de `screen_capture/metrics.rs` — nao "arrume" isso.
 */
export interface ScreenVideoNativeStats {
  fps: number
  target_fps: number
  frames: number
  failures: number
  capture_ms: number
  cursor_ms: number
  resize_ms: number
  encode_ms: number
  dispatch_ms: number
  frame_ms: number
  idle_ms: number
  bytes_per_second: number
  width: number
  height: number
}

/**
 * O que acontece com o quadro depois que ele cruza o IPC.
 *
 * `droppedFrames` e acumulado desde o inicio da captura, e nao por janela: e o
 * numero que responde "quantos quadros o pipeline perdeu nesta transmissao".
 * Ele conta o descarte silencioso do slot unico `latestFrame` — quando a
 * decodificacao nao acompanha a chegada, o quadro anterior morre sem nunca ter
 * sido desenhado, e ate agora isso sumia sem deixar rastro.
 */
export interface ScreenVideoIngestStats {
  receivedFps: number
  drawnFps: number
  droppedFps: number
  droppedFrames: number
  decodeMs: number
  drawMs: number
  bytesPerSecond: number
}

export interface ScreenVideoStats {
  native: ScreenVideoNativeStats | null
  ingest: ScreenVideoIngestStats
}

export interface IngestMetrics {
  readonly stats: ScreenVideoIngestStats
  received(bytes: number, replacedUndrawn: boolean): void
  drawn(decodeMs: number, drawMs: number): void
  /** Fecha a janela quando ela ja completou. `true` quando publicou. */
  flush(): boolean
}

/**
 * Acumulador da ingestao no WebView, espelho do `MetricsAccumulator` do Rust.
 *
 * `now` e `windowMs` sao injetaveis para o teste nao depender de relogio real —
 * a conta que precisa de cobertura e a media por janela, nao o `performance.now`.
 */
export function createIngestMetrics(
  now: () => number = () => performance.now(),
  windowMs = 1_000,
): IngestMetrics {
  const stats: ScreenVideoIngestStats = {
    receivedFps: 0, drawnFps: 0, droppedFps: 0, droppedFrames: 0,
    decodeMs: 0, drawMs: 0, bytesPerSecond: 0,
  }
  let windowStart = now()
  let received = 0
  let drawn = 0
  let dropped = 0
  let bytes = 0
  let decodeTotal = 0
  let drawTotal = 0

  const flush = () => {
    const elapsed = now() - windowStart
    if (elapsed < windowMs) return false
    const seconds = elapsed / 1_000
    stats.receivedFps = round2(received / seconds)
    stats.drawnFps = round2(drawn / seconds)
    stats.droppedFps = round2(dropped / seconds)
    stats.decodeMs = drawn > 0 ? round2(decodeTotal / drawn) : 0
    stats.drawMs = drawn > 0 ? round2(drawTotal / drawn) : 0
    stats.bytesPerSecond = round2(bytes / seconds)
    windowStart = now()
    received = 0
    drawn = 0
    dropped = 0
    bytes = 0
    decodeTotal = 0
    drawTotal = 0
    return true
  }

  return {
    stats,
    received(byteLength: number, replacedUndrawn: boolean) {
      received += 1
      bytes += byteLength
      if (replacedUndrawn) {
        dropped += 1
        stats.droppedFrames += 1
      }
      flush()
    },
    drawn(decodeMs: number, drawMs: number) {
      drawn += 1
      decodeTotal += decodeMs
      drawTotal += drawMs
      flush()
    },
    flush,
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

export interface ScreenCapturePacket {
  codec: number // 0 = JPEG, 1 = H.264
  isKeyframe: boolean
  captureId: number
  width: number
  height: number
  sequence: number
  timestampUs: bigint
  payload: Uint8Array
}

/**
 * Interpreta pacotes binarios recebidos pelo canal de quadros da captura nativa.
 * Suporta tanto o cabecalho moderno 'STAP' (32 bytes) com codec H.264/JPEG quanto
 * o cabecalho legado de 12 bytes (width, height, capture_id) para retrocompatibilidade.
 */
export function parseScreenCapturePacket(rawBytes: Uint8Array): ScreenCapturePacket | null {
  if (rawBytes.byteLength < 12) return null

  // Verifica magic "STAP" (0x53, 0x54, 0x41, 0x50)
  if (
    rawBytes.byteLength >= 32 &&
    rawBytes[0] === 0x53 &&
    rawBytes[1] === 0x54 &&
    rawBytes[2] === 0x41 &&
    rawBytes[3] === 0x50
  ) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
    const codec = rawBytes[5]
    const flags = rawBytes[6]
    const isKeyframe = (flags & 1) !== 0
    const captureId = view.getUint32(8, true)
    const width = view.getUint32(12, true)
    const height = view.getUint32(16, true)
    const sequence = view.getUint32(20, true)
    const timestampUs = view.getBigUint64(24, true)
    const payload = rawBytes.subarray(32)
    return {
      codec,
      isKeyframe,
      captureId,
      width,
      height,
      sequence,
      timestampUs,
      payload,
    }
  }

  // Fallback para cabecalho legado de 12 bytes (width, height, capture_id) com JPEG
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
  const width = view.getUint32(0, true)
  const height = view.getUint32(4, true)
  const captureId = view.getUint32(8, true)
  const payload = rawBytes.subarray(12)
  return {
    codec: 0,
    isKeyframe: true,
    captureId,
    width,
    height,
    sequence: 0,
    timestampUs: 0n,
    payload,
  }
}

/**
 * Extrai a string de codec RFC 6381 (ex: avc1.42001f ou avc1.64002a) a partir
 * do NAL unit de SPS em formato Annex B.
 */
export function extractH264CodecString(payload: Uint8Array): string {
  for (let i = 0; i + 4 < payload.length; i++) {
    if (payload[i] === 0 && payload[i + 1] === 0) {
      let offset = -1
      if (payload[i + 2] === 1) {
        offset = i + 3
      } else if (i + 3 < payload.length && payload[i + 2] === 0 && payload[i + 3] === 1) {
        offset = i + 4
      }
      if (offset !== -1 && offset + 3 < payload.length) {
        const nalType = payload[offset] & 0x1F
        if (nalType === 7) {
          const profile = payload[offset + 1].toString(16).padStart(2, '0')
          const constraints = payload[offset + 2].toString(16).padStart(2, '0')
          const level = payload[offset + 3].toString(16).padStart(2, '0')
          return `avc1.${profile}${constraints}${level}`
        }
      }
    }
  }
  return 'avc1.420028'
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
      event: 'audio_format'
      capture_id: number
      sample_rate: number
      channels: number
    }
  | {
      event: 'audio_chunk'
      capture_id: number
      pcm: Uint8Array | ArrayBuffer | number[]
    }
  | { event: 'audio_unavailable'; capture_id: number; reason: string }
  | { event: 'video_stats'; capture_id: number; stats: ScreenVideoNativeStats }
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
  video?: boolean | (MediaTrackConstraints & {
    cursor?: 'always' | 'motion' | 'never'
  })
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
      cursor: 'always',
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

interface CaptureCanvasRenderer {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  width: number
  height: number
  resize(width: number, height: number): void
  captureStream(fps: number): MediaStream
}

function createCaptureCanvas(initialWidth: number, initialHeight: number): CaptureCanvasRenderer {
  const supportsOffscreenCapture = typeof OffscreenCanvas !== 'undefined'
    && typeof (OffscreenCanvas.prototype as { captureStream?: unknown }).captureStream === 'function'

  if (supportsOffscreenCapture) {
    const offscreen = new OffscreenCanvas(initialWidth, initialHeight)
    const context = (offscreen.getContext('2d', { alpha: false, desynchronized: true })
      ?? offscreen.getContext('2d', { alpha: false })) as OffscreenCanvasRenderingContext2D | null
    if (context) {
      return {
        context,
        get width() { return offscreen.width },
        get height() { return offscreen.height },
        resize(width: number, height: number) {
          offscreen.width = width
          offscreen.height = height
        },
        captureStream: (fps: number) => (offscreen as unknown as HTMLCanvasElement).captureStream(fps),
      }
    }
  }

  const htmlCanvas = document.createElement('canvas')
  htmlCanvas.width = initialWidth
  htmlCanvas.height = initialHeight
  const context = (htmlCanvas.getContext('2d', { alpha: false, desynchronized: true })
    ?? htmlCanvas.getContext('2d', { alpha: false })) as CanvasRenderingContext2D | null
  if (!context) throw new Error('o renderizador de captura nao esta disponivel')
  return {
    context,
    get width() { return htmlCanvas.width },
    get height() { return htmlCanvas.height },
    resize(width: number, height: number) {
      htmlCanvas.width = width
      htmlCanvas.height = height
    },
    captureStream: (fps: number) => htmlCanvas.captureStream(fps),
  }
}

export async function startNativeScreenCapture(options: {
  sourceId: string
  maxWidth: number
  maxHeight: number
  fps: number
  includeAudio: boolean
  contentHint?: 'detail' | 'motion'
}): Promise<NativeScreenCapture> {
  if (!isTauriRuntime()) throw new Error('captura nativa disponivel somente no aplicativo')

  const renderer = createCaptureCanvas(options.maxWidth, options.maxHeight)
  const { context } = renderer

  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const fullScreenAudio = options.includeAudio && options.sourceId.startsWith('screen:')
  const audioValidation = fullScreenAudio
    ? await validateAudioExclusion(Channel, invoke)
    : undefined
  const includeAudio = options.includeAudio && (!fullScreenAudio || audioValidation?.safe === true)
  const channel = new Channel<CaptureEvent>()
  const frameChannel = new Channel<ArrayBuffer | Uint8Array>()
  let captureId = 0
  let stopped = false
  let latestFrame: { width: number; height: number; bytes: Uint8Array } | null = null
  let decoding = false
  const ingest = createIngestMetrics()
  const videoStats: ScreenVideoStats = { native: null, ingest: ingest.stats }
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

  let videoDecoder: VideoDecoder | null = null
  let decoderConfigured = false
  const pendingDecodeTimes = new Map<number, number>()
  let chunkIndex = 0

  if (typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined') {
    try {
      videoDecoder = new VideoDecoder({
        output(frame: VideoFrame) {
          if (stopped) {
            frame.close()
            return
          }
          const frameTimestamp = frame.timestamp ?? 0
          const startedAt = pendingDecodeTimes.get(frameTimestamp) ?? performance.now()
          pendingDecodeTimes.delete(frameTimestamp)
          const decodedAt = performance.now()
          const decodeMs = decodedAt - startedAt

          const drawStart = performance.now()
          if (renderer.width !== frame.displayWidth || renderer.height !== frame.displayHeight) {
            renderer.resize(frame.displayWidth, frame.displayHeight)
          }
          context.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight)
          frame.close()
          ingest.drawn(decodeMs, performance.now() - drawStart)

          if (!firstFrameDone) {
            firstFrameDone = true
            resolveFirstFrame()
          }
        },
        error(err) {
          console.error('[screen-capture] erro no VideoDecoder:', err)
        },
      })
    } catch (e) {
      console.warn('[screen-capture] falha ao instanciar VideoDecoder, usando fallback JPEG:', e)
      videoDecoder = null
    }
  }

  const drawLatest = async () => {
    if (decoding) return
    decoding = true
    try {
      while (latestFrame && !stopped) {
        const frame = latestFrame
        latestFrame = null
        const decodeStarted = performance.now()
        const blob = new Blob([frame.bytes as BlobPart], { type: 'image/jpeg' })
        const bitmap = await createImageBitmap(
          blob,
          { imageOrientation: 'none', premultiplyAlpha: 'none' },
        )
        const decodedAt = performance.now()
        if (renderer.width !== frame.width || renderer.height !== frame.height) {
          renderer.resize(frame.width, frame.height)
        }
        context.drawImage(bitmap, 0, 0, frame.width, frame.height)
        bitmap.close()
        ingest.drawn(decodedAt - decodeStarted, performance.now() - decodedAt)
        if (!firstFrameDone) {
          firstFrameDone = true
          resolveFirstFrame()
        }
      }
    } finally {
      decoding = false
    }
  }

  frameChannel.onmessage = (message) => {
    if (stopped) return
    const rawBytes = message instanceof Uint8Array
      ? message
      : new Uint8Array(message instanceof ArrayBuffer ? message : (message as ArrayBufferView).buffer)

    const packet = parseScreenCapturePacket(rawBytes)
    if (!packet) return
    if (captureId > 0 && packet.captureId !== captureId) return

    if (packet.codec === 1 && videoDecoder) {
      if (!decoderConfigured) {
        if (!packet.isKeyframe) {
          // Descarta delta-frames ate o primeiro keyframe com SPS/PPS
          return
        }
        const codecStr = extractH264CodecString(packet.payload)
        videoDecoder.configure({
          codec: codecStr,
          optimizeForLatency: true,
        })
        decoderConfigured = true
      }

      ingest.received(rawBytes.byteLength, false)
      const ts = chunkIndex++
      pendingDecodeTimes.set(ts, performance.now())
      if (pendingDecodeTimes.size > 60) {
        const oldest = pendingDecodeTimes.keys().next().value
        if (oldest !== undefined) pendingDecodeTimes.delete(oldest)
      }

      try {
        videoDecoder.decode(new EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp: ts,
          data: packet.payload,
        }))
      } catch (err) {
        console.error('[screen-capture] erro ao decodificar chunk H.264:', err)
      }
      return
    }

    // Antes de sobrescrever: se ainda havia quadro no slot, ele morreu sem
    // nunca ter sido desenhado. E esse o descarte que sumia sem rastro.
    ingest.received(rawBytes.byteLength, latestFrame !== null)
    latestFrame = {
      width: packet.width,
      height: packet.height,
      bytes: packet.payload,
    }
    void drawLatest()
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
    if (event.event === 'video_stats') {
      videoStats.native = event.stats
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
      const bytes = toUint8Array(event.pcm)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      audioPipeline.node.port.postMessage({ t: 'pcm', buffer }, [buffer])
      return
    }
  }

  try {
    captureId = await invoke<number>('start_screen_capture', {
      sourceId: options.sourceId,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      fps: options.fps,
      includeAudio: includeAudio && Boolean(audioPipeline),
      channel,
      frameChannel,
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

  const stream = renderer.captureStream(Math.min(options.fps, 60))
  const track = stream.getVideoTracks()[0]
  if (!track) {
    await invoke('stop_screen_capture', { captureId }).catch(() => {})
    await audioPipeline?.close()
    throw new Error('nao foi possivel criar a faixa de video da captura')
  }
  track.contentHint = options.contentHint ?? (options.fps >= 60 ? 'motion' : 'detail')

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
    videoStats,
    ended,
    async stop() {
      if (stopped) return
      stopped = true
      if (videoDecoder) {
        try {
          if (videoDecoder.state !== 'closed') videoDecoder.close()
        } catch {}
        videoDecoder = null
      }
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

function toUint8Array(data: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
}
