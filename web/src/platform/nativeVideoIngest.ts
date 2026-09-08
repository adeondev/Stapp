import type { ScreenCapturePacket } from './screenCapture'

export function isWebCodecsSupported(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined'
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
  onError?: (error: Error) => void
}

export interface NativeVideoDecoder {
  readonly isConfigured: boolean
  readonly decodeQueueSize: number
  feed(packet: ScreenCapturePacket): boolean
  reset(): void
  close(): void
}

export function createNativeVideoDecoder(options: NativeVideoDecoderOptions): NativeVideoDecoder | null {
  if (!isWebCodecsSupported()) return null

  let decoderConfigured = false
  let chunkIndex = 0
  const pendingDecodeTimes = new Map<number, number>()

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
    get decodeQueueSize() {
      return videoDecoder?.decodeQueueSize ?? 0
    },
    feed(packet: ScreenCapturePacket): boolean {
      if (!videoDecoder || videoDecoder.state === 'closed') return false

      if (!decoderConfigured) {
        if (!packet.isKeyframe) {
          // Descarta delta-frames ate o primeiro keyframe com SPS/PPS
          return false
        }
        const codecStr = extractH264CodecString(packet.payload)
        videoDecoder.configure({
          codec: codecStr,
          optimizeForLatency: true,
        })
        decoderConfigured = true
      }

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
        return true
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('[native-video-ingest] erro ao decodificar chunk H.264:', error)
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
      pendingDecodeTimes.clear()
    },
  }
}
