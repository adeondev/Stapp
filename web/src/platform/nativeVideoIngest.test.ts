// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNativeVideoDecoder,
  createNativeVideoIngest,
  createVideoTrackWriter,
  extractH264CodecString,
  isInsertableStreamsSupported,
  isWebCodecsIngestSupported,
  isWebCodecsSupported,
} from './nativeVideoIngest'
import { createIngestMetrics, type ScreenCapturePacket } from './screenCapture'

const target = globalThis as unknown as Record<string, unknown>

describe('nativeVideoIngest - deteccao de recursos', () => {
  const originalVideoDecoder = target.VideoDecoder
  const originalEncodedVideoChunk = target.EncodedVideoChunk
  const originalMediaStreamTrackGenerator = target.MediaStreamTrackGenerator
  const originalVideoTrackGenerator = (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator

  afterEach(() => {
    target.VideoDecoder = originalVideoDecoder
    target.EncodedVideoChunk = originalEncodedVideoChunk
    target.MediaStreamTrackGenerator = originalMediaStreamTrackGenerator
    ;(window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator = originalVideoTrackGenerator
  })

  it('detecta suporte a WebCodecs quando VideoDecoder e EncodedVideoChunk estao presentes', () => {
    target.VideoDecoder = class {}
    target.EncodedVideoChunk = class {}
    expect(isWebCodecsSupported()).toBe(true)

    delete target.VideoDecoder
    expect(isWebCodecsSupported()).toBe(false)
  })

  it('detecta suporte a Insertable Streams via MediaStreamTrackGenerator ou window.VideoTrackGenerator', () => {
    delete target.MediaStreamTrackGenerator
    delete (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator
    expect(isInsertableStreamsSupported()).toBe(false)

    target.MediaStreamTrackGenerator = class {}
    expect(isInsertableStreamsSupported()).toBe(true)

    delete target.MediaStreamTrackGenerator
    ;(window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator = class {}
    expect(isInsertableStreamsSupported()).toBe(true)
  })

  it('isWebCodecsIngestSupported requer ambos os componentes', () => {
    target.VideoDecoder = class {}
    target.EncodedVideoChunk = class {}
    delete target.MediaStreamTrackGenerator
    delete (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator

    expect(isWebCodecsIngestSupported()).toBe(false)

    target.MediaStreamTrackGenerator = class {}
    expect(isWebCodecsIngestSupported()).toBe(true)
  })
})

describe('nativeVideoIngest - extracao de codec H.264 Annex B', () => {
  it('extrai codec avc1 a partir de SPS com start code de 4 bytes', () => {
    const payload = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0, 0x1e, 0x90])
    expect(extractH264CodecString(payload)).toBe('avc1.42c01e')
  })

  it('extrai codec avc1 a partir de SPS com start code de 3 bytes', () => {
    const payload = new Uint8Array([0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1f, 0x90])
    expect(extractH264CodecString(payload)).toBe('avc1.64001f')
  })

  it('retorna valor padrao quando nao ha NAL type 7 ou esta truncado', () => {
    expect(extractH264CodecString(new Uint8Array([0x00, 0x00, 0x01, 0x65, 0x01]))).toBe('avc1.420028')
    expect(extractH264CodecString(new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42]))).toBe('avc1.420028')
  })
})

describe('createNativeVideoDecoder - decodificador nativo e politica de descarte', () => {
  let mockDecoderInstance: {
    configure: ReturnType<typeof vi.fn>
    decode: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    decodeQueueSize: number
    state: string
    outputCallback: (frame: VideoFrame) => void
    errorCallback: (error: Error) => void
  }

  beforeEach(() => {
    // Mock VideoDecoder and EncodedVideoChunk
    target.EncodedVideoChunk = class {
      type: string
      timestamp: number
      duration?: number
      data: Uint8Array
      constructor(init: { type: string; timestamp: number; duration?: number; data: Uint8Array }) {
        this.type = init.type
        this.timestamp = init.timestamp
        this.duration = init.duration
        this.data = init.data
      }
    }

    target.VideoDecoder = class {
      configure = vi.fn()
      decode = vi.fn()
      reset = vi.fn()
      close = vi.fn(() => { this.state = 'closed' })
      decodeQueueSize = 0
      state = 'configured'
      outputCallback: (frame: VideoFrame) => void
      errorCallback: (error: Error) => void

      constructor(init: { output: (frame: VideoFrame) => void; error: (err: unknown) => void }) {
        this.outputCallback = init.output
        this.errorCallback = (err: unknown) => init.error(err)
        mockDecoderInstance = this as unknown as typeof mockDecoderInstance
      }
    }
  })

  afterEach(() => {
    delete target.VideoDecoder
    delete target.EncodedVideoChunk
  })

  const makePacket = (opts: {
    isKeyframe: boolean
    payload?: Uint8Array
    width?: number
    height?: number
    timestampUs?: bigint
  }): ScreenCapturePacket => ({
    codec: 1,
    isKeyframe: opts.isKeyframe,
    timestampUs: opts.timestampUs ?? 0n,
    sequence: 0,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    captureId: 1,
    payload: opts.payload ?? new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xe0, 0x1f, 0x00]),
  })

  it('retorna null quando WebCodecs nao esta presente', () => {
    delete target.VideoDecoder
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
    })
    expect(decoder).toBeNull()
  })

  it('descarta delta frames antes do primeiro keyframe e solicita keyframe', () => {
    const onRequestKeyframe = vi.fn()
    const onDrop = vi.fn()
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
      onRequestKeyframe,
      onDrop,
    })!

    expect(decoder.isConfigured).toBe(false)
    expect(decoder.isWaitingForKeyframe).toBe(false)

    // Envia delta frame inicial
    const deltaPacket = makePacket({ isKeyframe: false, payload: new Uint8Array([1, 2, 3]) })
    const accepted = decoder.feed(deltaPacket)

    expect(accepted).toBe(false)
    expect(decoder.isConfigured).toBe(false)
    expect(decoder.isWaitingForKeyframe).toBe(true)
    expect(onDrop).toHaveBeenCalledWith(3)
    expect(onRequestKeyframe).toHaveBeenCalledOnce()
    expect(mockDecoderInstance.configure).not.toHaveBeenCalled()
  })

  it('configura o decoder no primeiro keyframe e comeca a decodificar', () => {
    const onRequestKeyframe = vi.fn()
    const onDrop = vi.fn()
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
      onRequestKeyframe,
      onDrop,
    })!

    const spsPayload = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0x00])
    const keyPacket = makePacket({ isKeyframe: true, payload: spsPayload })

    const accepted = decoder.feed(keyPacket)
    expect(accepted).toBe(true)
    expect(decoder.isConfigured).toBe(true)
    expect(decoder.isWaitingForKeyframe).toBe(false)
    expect(mockDecoderInstance.configure).toHaveBeenCalledWith({
      codec: 'avc1.640028',
      optimizeForLatency: true,
    })
    expect(mockDecoderInstance.decode).toHaveBeenCalledOnce()
    const chunk = mockDecoderInstance.decode.mock.calls[0][0]
    expect(chunk.type).toBe('key')

    // Proximo delta frame agora deve ser aceito
    const deltaPacket = makePacket({ isKeyframe: false, payload: new Uint8Array([4, 5, 6]) })
    const acceptedDelta = decoder.feed(deltaPacket)
    expect(acceptedDelta).toBe(true)
    expect(mockDecoderInstance.decode).toHaveBeenCalledTimes(2)
  })

  it('repassa frame decodificado para onFrame com tempo de decodificacao medido', () => {
    const onFrame = vi.fn()
    const decoder = createNativeVideoDecoder({ onFrame })!

    const keyPacket = makePacket({ isKeyframe: true })
    decoder.feed(keyPacket)

    const mockFrame = {
      timestamp: 0,
      close: vi.fn(),
    } as unknown as VideoFrame

    mockDecoderInstance.outputCallback(mockFrame)
    expect(onFrame).toHaveBeenCalledOnce()
    expect(onFrame.mock.calls[0][0]).toBe(mockFrame)
    expect(typeof onFrame.mock.calls[0][1]).toBe('number')
  })

  it('aplica politica de contrapressao quando decodeQueueSize >= maxQueueSize', () => {
    const onRequestKeyframe = vi.fn()
    const onDrop = vi.fn()
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
      onRequestKeyframe,
      onDrop,
      maxQueueSize: 3,
    })!

    decoder.feed(makePacket({ isKeyframe: true }))
    expect(decoder.isConfigured).toBe(true)
    expect(onRequestKeyframe).not.toHaveBeenCalled()

    // Simula fila do decodificador cheia (backpressure)
    mockDecoderInstance.decodeQueueSize = 3

    const delta1 = makePacket({ isKeyframe: false, payload: new Uint8Array(50) })
    const accepted = decoder.feed(delta1)

    expect(accepted).toBe(false)
    expect(decoder.isWaitingForKeyframe).toBe(true)
    expect(onDrop).toHaveBeenCalledWith(50)
    expect(onRequestKeyframe).toHaveBeenCalledOnce()

    // Enquanto esperando por keyframe, novos deltas sao descartados mesmo se queue abaixar
    mockDecoderInstance.decodeQueueSize = 0
    const delta2 = makePacket({ isKeyframe: false, payload: new Uint8Array(60) })
    expect(decoder.feed(delta2)).toBe(false)
    expect(onDrop).toHaveBeenCalledWith(60)

    // Chegada de novo keyframe recupera a decodificacao
    const key2 = makePacket({ isKeyframe: true, payload: new Uint8Array(100) })
    expect(decoder.feed(key2)).toBe(true)
    expect(decoder.isWaitingForKeyframe).toBe(false)
  })

  it('trata erro no VideoDecoder disparando onError e solicitando keyframe', () => {
    const onRequestKeyframe = vi.fn()
    const onError = vi.fn()
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
      onRequestKeyframe,
      onError,
    })!

    mockDecoderInstance.errorCallback(new Error('GPU device reset'))
    expect(decoder.isWaitingForKeyframe).toBe(true)
    expect(onRequestKeyframe).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'GPU device reset' }))
  })

  it('trata excecao em decode() descartando pacote e entrando em waitingForKeyframe', () => {
    const onRequestKeyframe = vi.fn()
    const onDrop = vi.fn()
    const onError = vi.fn()
    const decoder = createNativeVideoDecoder({
      onFrame: vi.fn(),
      onRequestKeyframe,
      onDrop,
      onError,
    })!

    decoder.feed(makePacket({ isKeyframe: true }))

    mockDecoderInstance.decode.mockImplementationOnce(() => {
      throw new Error('decode buffer error')
    })

    const delta = makePacket({ isKeyframe: false, payload: new Uint8Array(40) })
    const accepted = decoder.feed(delta)

    expect(accepted).toBe(false)
    expect(decoder.isWaitingForKeyframe).toBe(true)
    expect(onDrop).toHaveBeenCalledWith(40)
    expect(onRequestKeyframe).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalled()
  })

  it('reset() reinicia o estado de configuracao e close() encerra o decoder', () => {
    const decoder = createNativeVideoDecoder({ onFrame: vi.fn() })!

    decoder.feed(makePacket({ isKeyframe: true }))
    expect(decoder.isConfigured).toBe(true)

    decoder.reset()
    expect(mockDecoderInstance.reset).toHaveBeenCalledOnce()
    expect(decoder.isConfigured).toBe(false)

    decoder.close()
    expect(mockDecoderInstance.close).toHaveBeenCalledOnce()
    expect(decoder.feed(makePacket({ isKeyframe: true }))).toBe(false)
  })

  it('preserva o relogio do produtor, rebaseado no primeiro quadro', () => {
    const decoder = createNativeVideoDecoder({ onFrame: vi.fn(), fps: 60 })!

    // O produtor conta de capture_started.elapsed(): comeca com o atraso de
    // partida, e o primeiro quadro precisa virar a origem da linha do tempo.
    decoder.feed(makePacket({ isKeyframe: true, timestampUs: 5_000_000n }))
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 5_016_666n }))
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 5_033_332n }))

    const chunks = mockDecoderInstance.decode.mock.calls.map((call) => call[0])
    expect(chunks.map((chunk) => chunk.timestamp)).toEqual([0, 16_666, 33_332])
    // 60 quadros tem que ocupar 1 segundo, nao 60 microssegundos.
    expect(chunks[2].timestamp - chunks[0].timestamp).toBe(33_332)
  })

  it('declara a duracao do quadro a partir do fps alvo', () => {
    const decoder = createNativeVideoDecoder({ onFrame: vi.fn(), fps: 30 })!

    decoder.feed(makePacket({ isKeyframe: true, timestampUs: 1_000n }))

    expect(mockDecoderInstance.decode.mock.calls[0][0].duration).toBe(33_333)
  })

  it('sintetiza uma linha do tempo quando o produtor nao manda relogio', () => {
    // Cabecalho legado de 12 bytes: timestamp_us chega sempre 0. Sem sintetizar,
    // todos os quadros cairiam no mesmo instante.
    const decoder = createNativeVideoDecoder({ onFrame: vi.fn(), fps: 60 })!

    decoder.feed(makePacket({ isKeyframe: true, timestampUs: 0n }))
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 0n }))
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 0n }))

    const timestamps = mockDecoderInstance.decode.mock.calls.map((call) => call[0].timestamp)
    expect(timestamps).toEqual([0, 16_667, 33_334])
  })

  it('nunca entrega timestamp que ande para tras', () => {
    const decoder = createNativeVideoDecoder({ onFrame: vi.fn(), fps: 60 })!

    decoder.feed(makePacket({ isKeyframe: true, timestampUs: 1_000_000n }))
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 1_050_000n }))
    // Produtor repetindo ou regredindo o relogio nao pode rebobinar a faixa.
    decoder.feed(makePacket({ isKeyframe: false, timestampUs: 1_020_000n }))

    const timestamps = mockDecoderInstance.decode.mock.calls.map((call) => call[0].timestamp)
    expect(timestamps[1]).toBeGreaterThan(timestamps[0])
    expect(timestamps[2]).toBeGreaterThan(timestamps[1])
  })
})

describe('createVideoTrackWriter', () => {
  const originalMediaStreamTrackGenerator = target.MediaStreamTrackGenerator

  afterEach(() => {
    target.MediaStreamTrackGenerator = originalMediaStreamTrackGenerator
    delete (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator
  })

  it('retorna null se nenhum gerador de trilha estiver disponivel', () => {
    delete target.MediaStreamTrackGenerator
    delete (window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator
    expect(createVideoTrackWriter()).toBeNull()
  })

  it('utiliza MediaStreamTrackGenerator quando disponivel', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined)
    const releaseLockMock = vi.fn()
    const stopMock = vi.fn()

    target.MediaStreamTrackGenerator = class {
      writable = {
        getWriter: () => ({
          write: writeMock,
          releaseLock: releaseLockMock,
        }),
      }
      stop = stopMock
    }

    const trackWriter = createVideoTrackWriter()
    expect(trackWriter).not.toBeNull()

    const mockFrame = {} as unknown as VideoFrame
    await trackWriter!.write(mockFrame)
    expect(writeMock).toHaveBeenCalledWith(mockFrame)

    trackWriter!.close()
    expect(releaseLockMock).toHaveBeenCalledOnce()
    expect(stopMock).toHaveBeenCalledOnce()
  })

  it('utiliza window.VideoTrackGenerator quando MediaStreamTrackGenerator nao esta disponivel', async () => {
    delete target.MediaStreamTrackGenerator

    const writeMock = vi.fn().mockResolvedValue(undefined)
    const releaseLockMock = vi.fn()
    const stopMock = vi.fn()

    ;(window as unknown as { VideoTrackGenerator?: unknown }).VideoTrackGenerator = class {
      track = {
        stop: stopMock,
      } as unknown as MediaStreamTrack
      writable = {
        getWriter: () => ({
          write: writeMock,
          releaseLock: releaseLockMock,
        }),
      }
    }

    const trackWriter = createVideoTrackWriter()
    expect(trackWriter).not.toBeNull()

    const mockFrame = {} as unknown as VideoFrame
    await trackWriter!.write(mockFrame)
    expect(writeMock).toHaveBeenCalledWith(mockFrame)

    trackWriter!.close()
    expect(releaseLockMock).toHaveBeenCalledOnce()
    expect(stopMock).toHaveBeenCalledOnce()
  })
})

describe('createNativeVideoIngest - integracao ponta a ponta', () => {
  let mockWriterInstance: { write: ReturnType<typeof vi.fn>; releaseLock: ReturnType<typeof vi.fn> }
  let mockGeneratorInstance: { stop: ReturnType<typeof vi.fn> }
  let mockDecoderInstance: {
    configure: ReturnType<typeof vi.fn>
    decode: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    decodeQueueSize: number
    state: string
    outputCallback: (frame: VideoFrame) => void
    errorCallback: (error: Error) => void
  }

  beforeEach(() => {
    mockWriterInstance = {
      write: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    }
    mockGeneratorInstance = {
      stop: vi.fn(),
    }

    target.MediaStreamTrackGenerator = class {
      kind = 'video'
      id = 'mock-generator-track'
      writable = {
        getWriter: () => mockWriterInstance,
      }
      stop = mockGeneratorInstance.stop
      addEventListener = vi.fn()
      removeEventListener = vi.fn()
    }

    target.EncodedVideoChunk = class {
      type: string
      timestamp: number
      duration?: number
      data: Uint8Array
      constructor(init: { type: string; timestamp: number; duration?: number; data: Uint8Array }) {
        this.type = init.type
        this.timestamp = init.timestamp
        this.duration = init.duration
        this.data = init.data
      }
    }

    target.VideoDecoder = class {
      configure = vi.fn()
      decode = vi.fn()
      reset = vi.fn()
      close = vi.fn(() => { this.state = 'closed' })
      decodeQueueSize = 0
      state = 'configured'
      outputCallback: (frame: VideoFrame) => void
      errorCallback: (error: Error) => void

      constructor(init: { output: (frame: VideoFrame) => void; error: (err: unknown) => void }) {
        this.outputCallback = init.output
        this.errorCallback = (err: unknown) => init.error(err)
        mockDecoderInstance = this as unknown as typeof mockDecoderInstance
      }
    }
  })

  afterEach(() => {
    delete target.MediaStreamTrackGenerator
    delete target.VideoDecoder
    delete target.EncodedVideoChunk
  })

  it('alimenta fluxo H.264, entrega VideoFrame ao trackWriter e dispara onFirstFrame', async () => {
    const ingest = createIngestMetrics()
    const drawnSpy = vi.spyOn(ingest, 'drawn')
    const onFirstFrame = vi.fn()
    const onRequestKeyframe = vi.fn()

    const nativeIngest = createNativeVideoIngest({
      ingest,
      onFirstFrame,
      onRequestKeyframe,
    })

    expect(nativeIngest).not.toBeNull()
    expect(nativeIngest!.track).toBeDefined()
    expect(nativeIngest!.stream).toBeDefined()

    // Alimenta keyframe H.264
    const keyPacket: ScreenCapturePacket = {
      codec: 1,
      isKeyframe: true,
      timestampUs: 1000n,
      sequence: 1,
      width: 1920,
      height: 1080,
      captureId: 10,
      payload: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xe0, 0x1f]),
    }

    const fed = nativeIngest!.feed(keyPacket)
    expect(fed).toBe(true)
    expect(mockDecoderInstance.decode).toHaveBeenCalledOnce()

    // Simula saida do frame decodificado
    const frameClose = vi.fn()
    const mockFrame = {
      timestamp: 0,
      close: frameClose,
    } as unknown as VideoFrame

    mockDecoderInstance.outputCallback(mockFrame)

    // Aguarda entrega assincrona ao trackWriter
    await vi.waitFor(() => {
      expect(mockWriterInstance.write).toHaveBeenCalledWith(mockFrame)
      expect(frameClose).toHaveBeenCalledOnce()
      expect(onFirstFrame).toHaveBeenCalledOnce()
      expect(drawnSpy).toHaveBeenCalledOnce()
    })
    expect(ingest.stats.droppedFrames).toBe(0)

    // Stop limpa recursos
    nativeIngest!.stop()
    expect(mockDecoderInstance.close).toHaveBeenCalledOnce()
    expect(mockGeneratorInstance.stop).toHaveBeenCalledOnce()
  })

  it('computa quadros descartados por contrapressao nas metricas de ingest', () => {
    const ingest = createIngestMetrics()
    const receivedSpy = vi.spyOn(ingest, 'received')
    const onRequestKeyframe = vi.fn()

    const nativeIngest = createNativeVideoIngest({
      ingest,
      onFirstFrame: vi.fn(),
      onRequestKeyframe,
      maxQueueSize: 2,
    })!

    // Inicializa
    nativeIngest.feed({
      codec: 1,
      isKeyframe: true,
      timestampUs: 1000n,
      sequence: 1,
      width: 1920,
      height: 1080,
      captureId: 10,
      payload: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xe0, 0x1f]),
    })

    expect(receivedSpy).toHaveBeenCalledWith(expect.any(Number), false)
    expect(ingest.stats.droppedFrames).toBe(0)

    // Simula fila cheia
    mockDecoderInstance.decodeQueueSize = 2

    // Envia delta frame sob contrapressao
    const deltaPacket: ScreenCapturePacket = {
      codec: 1,
      isKeyframe: false,
      timestampUs: 2000n,
      sequence: 2,
      width: 1920,
      height: 1080,
      captureId: 10,
      payload: new Uint8Array(80),
    }

    const fed = nativeIngest.feed(deltaPacket)
    expect(fed).toBe(false)
    expect(onRequestKeyframe).toHaveBeenCalledOnce()
    expect(receivedSpy).toHaveBeenCalledWith(80, true)
    expect(ingest.stats.droppedFrames).toBe(1)
  })

  it('teste de fumaca ponta a ponta: ingestao de stream continuo H.264 (keyframe + deltas) sem descarte e entrega ao track', async () => {
    const ingest = createIngestMetrics()
    const onFirstFrame = vi.fn()

    const nativeIngest = createNativeVideoIngest({
      ingest,
      onFirstFrame,
      maxQueueSize: 4,
    })!

    // 1. Envia Keyframe H.264 inicial com SPS (NAL 7)
    const keyPacket: ScreenCapturePacket = {
      codec: 1,
      isKeyframe: true,
      timestampUs: 1000n,
      sequence: 1,
      width: 1920,
      height: 1080,
      captureId: 42,
      payload: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xe0, 0x1f, 0x05, 0xaa]),
    }
    expect(nativeIngest.feed(keyPacket)).toBe(true)
    expect(mockDecoderInstance.configure).toHaveBeenCalledWith({
      codec: 'avc1.42e01f',
      optimizeForLatency: true,
    })

    // Simula saida do frame 1
    const frame1Close = vi.fn()
    mockDecoderInstance.outputCallback({ timestamp: 0, close: frame1Close } as unknown as VideoFrame)

    await vi.waitFor(() => {
      expect(onFirstFrame).toHaveBeenCalledOnce()
      expect(mockWriterInstance.write).toHaveBeenCalledTimes(1)
      expect(frame1Close).toHaveBeenCalledOnce()
    })

    // 2. Envia sequencia de 4 Delta frames
    for (let seq = 2; seq <= 5; seq++) {
      const deltaPacket: ScreenCapturePacket = {
        codec: 1,
        isKeyframe: false,
        timestampUs: BigInt(seq * 16_666),
        sequence: seq,
        width: 1920,
        height: 1080,
        captureId: 42,
        payload: new Uint8Array([0x00, 0x00, 0x01, 0x41, 0x9a, seq]),
      }
      expect(nativeIngest.feed(deltaPacket)).toBe(true)

      const frameClose = vi.fn()
      mockDecoderInstance.outputCallback({ timestamp: seq - 1, close: frameClose } as unknown as VideoFrame)
      await vi.waitFor(() => {
        expect(mockWriterInstance.write).toHaveBeenCalledTimes(seq)
        expect(frameClose).toHaveBeenCalledOnce()
      })
    }

    // 3. Verifica contadores e estatisticas de ponta a ponta
    expect(mockWriterInstance.write).toHaveBeenCalledTimes(5)
    expect(ingest.stats.droppedFrames).toBe(0)
    expect(nativeIngest.stream.getVideoTracks()).toHaveLength(1)

    // 4. Encerramento limpo
    nativeIngest.stop()
    expect(mockDecoderInstance.close).toHaveBeenCalledOnce()
    expect(mockGeneratorInstance.stop).toHaveBeenCalledOnce()
  })
})
