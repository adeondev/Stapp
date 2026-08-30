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
  ended: Promise<string>
  stop(): Promise<void>
}

type CaptureEvent =
  | {
      event: 'frame'
      capture_id: number
      width: number
      height: number
      jpeg_base64: string
    }
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

export async function startNativeScreenCapture(options: {
  sourceId: string
  maxWidth: number
  maxHeight: number
  fps: number
}): Promise<NativeScreenCapture> {
  if (!isTauriRuntime()) throw new Error('captura nativa disponivel somente no aplicativo')

  const canvas = document.createElement('canvas')
  canvas.width = options.maxWidth
  canvas.height = options.maxHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('o renderizador de captura nao esta disponivel')

  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const channel = new Channel<CaptureEvent>()
  let captureId = 0
  let stopped = false
  let latestFrame: Extract<CaptureEvent, { event: 'frame' }> | null = null
  let decoding = false
  let firstFrameDone = false
  let resolveFirstFrame!: () => void
  let rejectFirstFrame!: (error: Error) => void
  let resolveEnded!: (reason: string) => void
  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirstFrame = resolve
    rejectFirstFrame = reject
  })
  const ended = new Promise<string>((resolve) => { resolveEnded = resolve })

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
    latestFrame = event
    void drawLatest()
  }

  captureId = await invoke<number>('start_screen_capture', {
    sourceId: options.sourceId,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    fps: options.fps,
    channel,
  })

  const timeout = window.setTimeout(() => {
    rejectFirstFrame(new Error('a primeira imagem da captura demorou demais'))
  }, 3_000)
  try {
    await firstFrame
  } catch (error) {
    await invoke('stop_screen_capture', { captureId }).catch(() => {})
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  const stream = canvas.captureStream(Math.min(options.fps, 30))
  const track = stream.getVideoTracks()[0]
  if (!track) {
    await invoke('stop_screen_capture', { captureId }).catch(() => {})
    throw new Error('nao foi possivel criar a faixa de video da captura')
  }
  track.contentHint = 'detail'

  return {
    stream,
    track,
    ended,
    async stop() {
      if (stopped) return
      stopped = true
      await invoke('stop_screen_capture', { captureId }).catch(() => {})
      for (const mediaTrack of stream.getTracks()) mediaTrack.stop()
    },
  }
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
