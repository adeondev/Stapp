import type { IngestMetrics, ScreenCapturePacket } from './screenCapture'

declare global {
  interface MediaStreamTrackGeneratorInit {
    kind: 'video' | 'audio'
  }

  interface MediaStreamTrackGenerator extends MediaStreamTrack {
    readonly writable: WritableStream<VideoFrame>
  }

  const MediaStreamTrackGenerator: {
    prototype: MediaStreamTrackGenerator
    new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackGenerator
  } | undefined
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined'
}

export function isInsertableStreamsSupported(): boolean {
  return (
    typeof MediaStreamTrackGenerator !== 'undefined' ||
    typeof (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator !== 'undefined'
  )
}

export function isWebCodecsIngestSupported(): boolean {
  return isWebCodecsSupported() && isInsertableStreamsSupported()
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

export interface NativeVideoDecoderOptions {
  onFrame: (frame: VideoFrame, decodeMs: number) => void
  onRequestKeyframe?: () => Promise<void> | void
  onDrop?: (byteLength: number) => void
  onError?: (error: Error) => void
  maxQueueSize?: number
  /** Fps alvo da captura. Define a duracao declarada de cada quadro. */
  fps?: number
}

export interface NativeVideoDecoder {
  readonly isConfigured: boolean
  readonly isWaitingForKeyframe: boolean
  readonly decodeQueueSize: number
  feed(packet: ScreenCapturePacket): boolean
  reset(): void
  close(): void
}

/**
 * Tamanho maximo calibrado da fila do VideoDecoder.
 * Com tempo de decodificacao de ~1-3ms por quadro em GPU, 4 quadros representam ~66ms
 * de margem de seguranca contra jitter momentaneo do SO em 60fps sem acumular latencia perceptivel.
 */
export const DEFAULT_DECODE_QUEUE_CAPACITY = 4

/** Fps assumido quando o chamador nao informa o alvo da captura. */
export const DEFAULT_TARGET_FPS = 60

export function createNativeVideoDecoder(options: NativeVideoDecoderOptions): NativeVideoDecoder | null {
  if (!isWebCodecsSupported()) return null

  const maxQueueSize = options.maxQueueSize ?? DEFAULT_DECODE_QUEUE_CAPACITY
  const frameDurationUs = Math.max(
    1,
    Math.round(1_000_000 / Math.max(1, options.fps ?? DEFAULT_TARGET_FPS)),
  )
  let decoderConfigured = false
  let waitingForKeyframe = false
  let baseTimestampUs: number | null = null
  let lastTimestampUs = -frameDurationUs
  const pendingDecodeTimes = new Map<number, number>()

  /**
   * Relogio de apresentacao do quadro, em microssegundos, rebaseado no primeiro
   * quadro da sessao.
   *
   * O quadro decodificado vai direto para o `MediaStreamTrackGenerator`, que e a
   * fonte do track publicado no SFU — entao ESTE timestamp e o que vira relogio
   * RTP do outro lado. Um contador de unidade (0, 1, 2 us) fazia 60 quadros
   * caberem em 60 microssegundos: quem assistia via a cadencia errada e o audio
   * da tela, que carrega timestamp real, saia de sincronia.
   *
   * O produtor nativo conta de `capture_started.elapsed()`, ja monotonico e
   * comecando perto de zero; rebasear no primeiro quadro so tira o atraso de
   * partida.
   *
   * PROTOTYPE: o cabecalho legado de 12 bytes nao tem relogio (`timestamp_us`
   * chega 0) e um produtor antigo pode repetir o mesmo valor. Nesses casos a
   * linha do tempo e sintetizada no intervalo do fps alvo. Invariante que nao
   * pode ser quebrado: o timestamp entregue ao decodificador e estritamente
   * crescente e medido na mesma escala do relogio real.
   */
  const presentationTimestamp = (packet: ScreenCapturePacket): number => {
    const raw = Number(packet.timestampUs)
    if (Number.isFinite(raw) && raw > 0) {
      baseTimestampUs ??= raw
      const rebased = raw - baseTimestampUs
      if (rebased > lastTimestampUs) return rebased
    }
    return lastTimestampUs + frameDurationUs
  }

  let videoDecoder: VideoDecoder | null = null

  try {
    videoDecoder = new VideoDecoder({
      output(frame: VideoFrame) {
        const frameTimestamp = frame.timestamp ?? 0
        const startedAt = pendingDecodeTimes.get(frameTimestamp) ?? performance.now()
        pendingDecodeTimes.delete(frameTimestamp)
        const decodeMs = performance.now() - startedAt
        options.onFrame(frame, decodeMs)
      },
      error(err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('[native-video-ingest] erro no VideoDecoder:', error)
        waitingForKeyframe = true
        void options.onRequestKeyframe?.()
        options.onError?.(error)
      },
    })
  } catch (e) {
    console.warn('[native-video-ingest] falha ao instanciar VideoDecoder:', e)
    return null
  }

  return {
    get isConfigured() {
      return decoderConfigured
    },
    get isWaitingForKeyframe() {
      return waitingForKeyframe
    },
    get decodeQueueSize() {
      return videoDecoder?.decodeQueueSize ?? 0
    },
    feed(packet: ScreenCapturePacket): boolean {
      if (!videoDecoder || videoDecoder.state === 'closed') return false

      if (!decoderConfigured) {
        if (!packet.isKeyframe) {
          // Descarta delta-frames ate o primeiro keyframe com SPS/PPS
          options.onDrop?.(packet.payload.byteLength)
          if (!waitingForKeyframe) {
            waitingForKeyframe = true
            void options.onRequestKeyframe?.()
          }
          return false
        }
        const codecStr = extractH264CodecString(packet.payload)
        videoDecoder.configure({
          codec: codecStr,
          optimizeForLatency: true,
        })
        decoderConfigured = true
        waitingForKeyframe = false
      }

      if (waitingForKeyframe) {
        if (!packet.isKeyframe) {
          options.onDrop?.(packet.payload.byteLength)
          return false
        }
        waitingForKeyframe = false
      }

      // Contrapressao explicita: se o decodificador acumulou atraso acima do limite,
      // descarta o quadro e solicita keyframe para restabelecer sincronia sem jitter
      if (videoDecoder.decodeQueueSize >= maxQueueSize) {
        options.onDrop?.(packet.payload.byteLength)
        waitingForKeyframe = true
        void options.onRequestKeyframe?.()
        return false
      }

      const ts = presentationTimestamp(packet)
      lastTimestampUs = ts
      pendingDecodeTimes.set(ts, performance.now())
      if (pendingDecodeTimes.size > 60) {
        const oldest = pendingDecodeTimes.keys().next().value
        if (oldest !== undefined) pendingDecodeTimes.delete(oldest)
      }

      try {
        videoDecoder.decode(new EncodedVideoChunk({
          type: packet.isKeyframe ? 'key' : 'delta',
          timestamp: ts,
          duration: frameDurationUs,
          data: packet.payload,
        }))
        return true
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('[native-video-ingest] erro ao decodificar chunk H.264:', error)
        options.onDrop?.(packet.payload.byteLength)
        waitingForKeyframe = true
        void options.onRequestKeyframe?.()
        options.onError?.(error)
        return false
      }
    },
    reset() {
      if (videoDecoder && videoDecoder.state !== 'closed') {
        try {
          videoDecoder.reset()
        } catch {}
        decoderConfigured = false
        waitingForKeyframe = false
        pendingDecodeTimes.clear()
      }
    },
    close() {
      if (videoDecoder) {
        try {
          if (videoDecoder.state !== 'closed') videoDecoder.close()
        } catch {}
        videoDecoder = null
      }
      decoderConfigured = false
      waitingForKeyframe = false
      pendingDecodeTimes.clear()
    },
  }
}


export interface VideoTrackWriter {
  readonly track: MediaStreamTrack
  write(frame: VideoFrame): Promise<void>
  close(): void
}

export function createVideoTrackWriter(): VideoTrackWriter | null {
  if (typeof MediaStreamTrackGenerator !== 'undefined') {
    try {
      const generator = new MediaStreamTrackGenerator({ kind: 'video' })
      const writer = generator.writable.getWriter()
      return {
        track: generator,
        async write(frame: VideoFrame) {
          await writer.write(frame)
        },
        close() {
          try {
            writer.releaseLock()
          } catch {}
          try {
            generator.stop()
          } catch {}
        },
      }
    } catch (e) {
      console.warn('[native-video-ingest] falha ao instanciar MediaStreamTrackGenerator:', e)
    }
  }

  const win = window as unknown as {
    VideoTrackGenerator?: new () => {
      track: MediaStreamTrack
      writable: WritableStream<VideoFrame>
    }
  }
  if (typeof win.VideoTrackGenerator !== 'undefined') {
    try {
      const generator = new win.VideoTrackGenerator()
      const writer = generator.writable.getWriter()
      return {
        track: generator.track,
        async write(frame: VideoFrame) {
          await writer.write(frame)
        },
        close() {
          try {
            writer.releaseLock()
          } catch {}
          try {
            generator.track.stop()
          } catch {}
        },
      }
    } catch (e) {
      console.warn('[native-video-ingest] falha ao instanciar VideoTrackGenerator:', e)
    }
  }

  return null
}

export interface NativeVideoIngestOptions {
  ingest: IngestMetrics
  onFirstFrame: () => void
  onRequestKeyframe?: () => Promise<void> | void
  onError?: (error: Error) => void
  maxQueueSize?: number
  /** Fps alvo da captura, repassado ao decodificador. */
  fps?: number
}

export interface NativeVideoIngest {
  readonly track: MediaStreamTrack
  readonly stream: MediaStream
  feed(packet: ScreenCapturePacket): boolean
  stop(): void
}

export function createNativeVideoIngest(options: NativeVideoIngestOptions): NativeVideoIngest | null {
  const trackWriter = createVideoTrackWriter()
  if (!trackWriter) return null

  let firstFrameDone = false
  let stopped = false
  let decodingJpeg = false
  let latestJpegBytes: Uint8Array | null = null

  const decoder = createNativeVideoDecoder({
    onFrame(frame, decodeMs) {
      if (stopped) {
        frame.close()
        return
      }
      const deliverStart = performance.now()
      trackWriter.write(frame)
        .then(() => {
          frame.close()
          options.ingest.drawn(decodeMs, performance.now() - deliverStart)
          if (!firstFrameDone) {
            firstFrameDone = true
            options.onFirstFrame()
          }
        })
        .catch((err) => {
          frame.close()
          console.error('[native-video-ingest] erro ao entregar VideoFrame ao track:', err)
        })
    },
    onRequestKeyframe: options.onRequestKeyframe,
    onDrop: (byteLength) => {
      options.ingest.received(byteLength, true)
    },
    maxQueueSize: options.maxQueueSize,
    fps: options.fps,
    onError: options.onError,
  })

  if (!decoder) {
    trackWriter.close()
    return null
  }

  const stream = typeof MediaStream !== 'undefined'
    ? new MediaStream([trackWriter.track])
    : ({
        getVideoTracks: () => [trackWriter.track],
        getAudioTracks: () => [],
        getTracks: () => [trackWriter.track],
        addTrack: () => {},
        removeTrack: () => {},
      } as unknown as MediaStream)

  const drawLatestJpeg = async () => {
    if (decodingJpeg) return
    decodingJpeg = true
    try {
      while (latestJpegBytes && !stopped) {
        const bytes = latestJpegBytes
        latestJpegBytes = null
        const decodeStart = performance.now()
        const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' })
        const bitmap = await createImageBitmap(blob, {
          imageOrientation: 'none',
          premultiplyAlpha: 'none',
        })
        const decodeMs = performance.now() - decodeStart
        const frame = new VideoFrame(bitmap, { timestamp: performance.now() * 1000 })
        bitmap.close()

        const deliverStart = performance.now()
        await trackWriter.write(frame)
        frame.close()
        options.ingest.drawn(decodeMs, performance.now() - deliverStart)
        if (!firstFrameDone) {
          firstFrameDone = true
          options.onFirstFrame()
        }
      }
    } catch (err) {
      console.error('[native-video-ingest] erro no fallback JPEG do trackWriter:', err)
    } finally {
      decodingJpeg = false
    }
  }

  return {
    track: trackWriter.track,
    stream,
    feed(packet: ScreenCapturePacket): boolean {
      if (stopped) return false
      if (packet.codec === 1) {
        const decoded = decoder.feed(packet)
        if (decoded) {
          options.ingest.received(packet.payload.byteLength, false)
        }
        return decoded
      }
      if (packet.codec === 0) {
        options.ingest.received(packet.payload.byteLength, latestJpegBytes !== null)
        latestJpegBytes = packet.payload
        void drawLatestJpeg()
        return true
      }
      return false
    },
    stop() {
      if (stopped) return
      stopped = true
      decoder.close()
      trackWriter.close()
    },
  }
}

