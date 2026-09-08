import type { IngestMetrics, ScreenCapturePacket } from './screenCapture'

export interface CaptureCanvasRenderer {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  width: number
  height: number
  resize(width: number, height: number): void
  captureStream(fps: number): MediaStream
}

export function createCaptureCanvas(initialWidth: number, initialHeight: number): CaptureCanvasRenderer {
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

export interface CanvasFallbackIngestOptions {
  maxWidth: number
  maxHeight: number
  fps: number
  ingest: IngestMetrics
  onFirstFrame: () => void
}

export interface CanvasFallbackIngest {
  readonly track: MediaStreamTrack
  readonly stream: MediaStream
  feed(packet: ScreenCapturePacket): boolean
  stop(): void
}

export function createCanvasFallbackIngest(options: CanvasFallbackIngestOptions): CanvasFallbackIngest {
  const renderer = createCaptureCanvas(options.maxWidth, options.maxHeight)
  const stream = renderer.captureStream(Math.min(options.fps, 60))
  const track = stream.getVideoTracks()[0]
  if (!track) {
    throw new Error('nao foi possivel criar a faixa de video da captura no canvas')
  }

  let stopped = false
  let firstFrameDone = false
  let decoding = false
  let latestFrame: { width: number; height: number; bytes: Uint8Array } | null = null

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
        renderer.context.drawImage(bitmap, 0, 0, frame.width, frame.height)
        bitmap.close()
        options.ingest.drawn(decodedAt - decodeStarted, performance.now() - decodedAt)
        if (!firstFrameDone) {
          firstFrameDone = true
          options.onFirstFrame()
        }
      }
    } finally {
      decoding = false
    }
  }

  return {
    track,
    stream,
    feed(packet: ScreenCapturePacket): boolean {
      if (stopped) return false
      options.ingest.received(packet.payload.byteLength, latestFrame !== null)
      latestFrame = {
        width: packet.width,
        height: packet.height,
        bytes: packet.payload,
      }
      void drawLatest()
      return true
    },
    stop() {
      if (stopped) return
      stopped = true
      for (const t of stream.getTracks()) t.stop()
    },
  }
}
