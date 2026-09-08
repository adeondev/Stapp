// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserAudioExclusionIsSafe,
  createIngestMetrics,
  extractH264CodecString,
  parseScreenCapturePacket,
  requestScreenCaptureKeyframe,
  resetAudioExclusionValidationCache,
  startBrowserScreenCapture,
  startNativeScreenCapture,
  validateAudioExclusion,
} from './screenCapture'

describe('captura web segura', () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('aceita somente probe baixo com restrictOwnAudio confirmado', () => {
    expect(browserAudioExclusionIsSafe(true, true, 0.01, 0.0005)).toBe(true)
    expect(browserAudioExclusionIsSafe(false, true, 0.01, 0)).toBe(false)
    expect(browserAudioExclusionIsSafe(true, false, 0.01, 0)).toBe(false)
    expect(browserAudioExclusionIsSafe(true, true, 0.01, 0.004)).toBe(false)
  })

  it('mantem o video e encerra somente o audio quando a constraint falha', async () => {
    const videoTrack = {
      kind: 'video', contentHint: '', stop: vi.fn(), addEventListener: vi.fn(),
      getSettings: vi.fn(() => ({ displaySurface: 'monitor' })),
    }
    const audioTrack = {
      kind: 'audio', contentHint: '', stop: vi.fn(),
      applyConstraints: vi.fn(async () => { throw new Error('constraint recusada') }),
      getSettings: vi.fn(() => ({ restrictOwnAudio: false })),
    }
    const stream = {
      id: 'display-stream',
      getVideoTracks: () => [videoTrack], getAudioTracks: () => [audioTrack],
      getTracks: () => [videoTrack], removeTrack: vi.fn(),
    }
    const getDisplayMedia = vi.fn(async () => stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia, getSupportedConstraints: () => ({ restrictOwnAudio: true }) },
    })

    const capture = await startBrowserScreenCapture({
      maxWidth: 1920, maxHeight: 1080, fps: 30, includeAudio: true, contentHint: 'detail',
    })

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({
        restrictOwnAudio: true, channelCount: { ideal: 2 }, sampleRate: { ideal: 48_000 },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      }),
      systemAudio: 'include', windowAudio: 'window',
    }))
    expect(audioTrack.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({
      restrictOwnAudio: { exact: true },
    }))
    expect(capture.track).toBe(videoTrack)
    expect(capture.audioTrack).toBeUndefined()
    expect(capture.hasAudio).toBe(false)
    expect(stream.removeTrack).toHaveBeenCalledWith(audioTrack)
    expect(audioTrack.stop).toHaveBeenCalledOnce()
  })

  it('solicita cursor sempre visivel na captura via navegador', async () => {
    const videoTrack = {
      kind: 'video', contentHint: '', stop: vi.fn(), addEventListener: vi.fn(),
      getSettings: vi.fn(() => ({ displaySurface: 'monitor' })),
    }
    const stream = {
      id: 'display-stream',
      getVideoTracks: () => [videoTrack], getAudioTracks: () => [],
      getTracks: () => [videoTrack], removeTrack: vi.fn(),
    }
    const getDisplayMedia = vi.fn(async () => stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia, getSupportedConstraints: () => ({}) },
    })

    await startBrowserScreenCapture({
      maxWidth: 1280, maxHeight: 720, fps: 60, includeAudio: false, contentHint: 'motion',
    })

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        cursor: 'always',
      },
    }))
  })
})

describe('validacao nativa de exclusao de audio', () => {
  beforeEach(() => {
    resetAudioExclusionValidationCache()
  })

  it('retorna imediatamente o erro do Rust sem esperar timeout quando safe e false', async () => {
    class MockChannel {
      onmessage?: (event: unknown) => void
    }

    const invoke = vi.fn(async () => ({
      safe: false,
      processId: 1234,
      includeLevel: 0,
      excludeLevel: 0,
      reason: 'controle de loopback indisponivel: dispositivo de saida ausente',
    }))

    const start = performance.now()
    const result = await validateAudioExclusion(
      MockChannel as unknown as typeof import('@tauri-apps/api/core')['Channel'],
      invoke as unknown as typeof import('@tauri-apps/api/core')['invoke'],
    )
    const elapsed = performance.now() - start

    expect(result.safe).toBe(false)
    expect(result.reason).toBe('controle de loopback indisponivel: dispositivo de saida ausente')
    expect(elapsed).toBeLessThan(1000)
  })

  it('trata evento failed do canal e nao bloqueia no cache', async () => {
    class MockChannel {
      onmessage?: (event: { event: string; reason?: string }) => void
      constructor() {
        queueMicrotask(() => {
          this.onmessage?.({ event: 'failed', reason: 'COM de audio indisponivel: init falhou' })
        })
      }
    }

    const invoke = vi.fn(async () => new Promise<never>(() => {}))

    const result = await validateAudioExclusion(
      MockChannel as unknown as typeof import('@tauri-apps/api/core')['Channel'],
      invoke as unknown as typeof import('@tauri-apps/api/core')['invoke'],
    )

    expect(result.safe).toBe(false)
    expect(result.reason).toBe('COM de audio indisponivel: init falhou')

    // Tentar de novo deve chamar o invoke novamente porque a falha nao pode ficar em cache permanente
    const invokeSecond = vi.fn(async () => ({
      safe: false,
      processId: 5678,
      includeLevel: 0,
      excludeLevel: 0,
      reason: 'segunda tentativa',
    }))
    await validateAudioExclusion(
      MockChannel as unknown as typeof import('@tauri-apps/api/core')['Channel'],
      invokeSecond as unknown as typeof import('@tauri-apps/api/core')['invoke'],
    )
    expect(invokeSecond).toHaveBeenCalledOnce()
  })
})

describe('captura nativa de tela no desktop', () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('exige runtime Tauri para iniciar', async () => {
    await expect(startNativeScreenCapture({
      sourceId: 'screen:0',
      maxWidth: 1280,
      maxHeight: 720,
      fps: 60,
      includeAudio: false,
    })).rejects.toThrow('captura nativa disponivel somente no aplicativo')
  })
})

describe('metricas de ingestao do quadro', () => {
  /* Relogio de mentira: a conta que precisa de cobertura e a media por janela,
     nao o `performance.now`. */
  const relogio = () => {
    let agora = 0
    return { ler: () => agora, avancar: (ms: number) => { agora += ms } }
  }

  it('so publica quando a janela fecha', () => {
    const t = relogio()
    const metricas = createIngestMetrics(t.ler, 1_000)

    metricas.received(1_000, false)
    metricas.drawn(5, 1)
    expect(metricas.stats.drawnFps).toBe(0)

    t.avancar(1_000)
    expect(metricas.flush()).toBe(true)
    expect(metricas.stats.drawnFps).toBe(1)
    expect(metricas.stats.receivedFps).toBe(1)
    expect(metricas.stats.bytesPerSecond).toBe(1_000)
  })

  it('conta como perdido o quadro sobrescrito antes de ser desenhado', () => {
    const t = relogio()
    const metricas = createIngestMetrics(t.ler, 1_000)

    metricas.received(100, false)
    metricas.received(100, true)
    metricas.received(100, true)
    metricas.drawn(4, 2)

    t.avancar(1_000)
    metricas.flush()
    expect(metricas.stats.receivedFps).toBe(3)
    expect(metricas.stats.drawnFps).toBe(1)
    expect(metricas.stats.droppedFps).toBe(2)
    expect(metricas.stats.droppedFrames).toBe(2)
  })

  it('mede decode e desenho por quadro desenhado, nao por quadro recebido', () => {
    const t = relogio()
    const metricas = createIngestMetrics(t.ler, 1_000)

    metricas.received(100, false)
    metricas.received(100, true)
    metricas.drawn(10, 2)
    metricas.drawn(20, 4)

    t.avancar(1_000)
    metricas.flush()
    expect(metricas.stats.decodeMs).toBe(15)
    expect(metricas.stats.drawMs).toBe(3)
  })

  it('a perda acumulada sobrevive ao fechamento da janela', () => {
    const t = relogio()
    const metricas = createIngestMetrics(t.ler, 1_000)

    metricas.received(100, true)
    t.avancar(1_000)
    metricas.flush()
    metricas.received(100, true)
    t.avancar(1_000)
    metricas.flush()

    // Por janela zera; o total da transmissao, nao.
    expect(metricas.stats.droppedFps).toBe(1)
    expect(metricas.stats.droppedFrames).toBe(2)
    expect(metricas.stats.receivedFps).toBe(1)
  })

  it('janela sem quadro desenhado nao divide por zero', () => {
    const t = relogio()
    const metricas = createIngestMetrics(t.ler, 1_000)

    metricas.received(500, false)
    t.avancar(1_000)
    metricas.flush()
    expect(metricas.stats.decodeMs).toBe(0)
    expect(metricas.stats.drawMs).toBe(0)
    expect(metricas.stats.drawnFps).toBe(0)
  })
})

describe('protocolo binario STAP e codec H.264', () => {
  it('interpreta pacote STAP moderno de 32 bytes com H.264 e keyframe', () => {
    const payload = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0x05])
    const packetBytes = new Uint8Array(32 + payload.byteLength)

    // Magic "STAP"
    packetBytes[0] = 0x53
    packetBytes[1] = 0x54
    packetBytes[2] = 0x41
    packetBytes[3] = 0x50

    packetBytes[4] = 1 // version
    packetBytes[5] = 1 // codec = H.264
    packetBytes[6] = 1 // flags = keyframe
    packetBytes[7] = 0 // reserved

    const view = new DataView(packetBytes.buffer, packetBytes.byteOffset, packetBytes.byteLength)
    view.setUint32(8, 77, true) // captureId
    view.setUint32(12, 1920, true) // width
    view.setUint32(16, 1080, true) // height
    view.setUint32(20, 15, true) // sequence
    view.setBigUint64(24, 987654321n, true) // timestampUs

    packetBytes.set(payload, 32)

    const parsed = parseScreenCapturePacket(packetBytes)
    expect(parsed).not.toBeNull()
    expect(parsed?.codec).toBe(1)
    expect(parsed?.isKeyframe).toBe(true)
    expect(parsed?.captureId).toBe(77)
    expect(parsed?.width).toBe(1920)
    expect(parsed?.height).toBe(1080)
    expect(parsed?.sequence).toBe(15)
    expect(parsed?.timestampUs).toBe(987654321n)
    expect(parsed?.payload).toEqual(payload)
  })

  it('interpreta pacote STAP com codec JPEG', () => {
    const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
    const packetBytes = new Uint8Array(32 + payload.byteLength)

    packetBytes[0] = 0x53
    packetBytes[1] = 0x54
    packetBytes[2] = 0x41
    packetBytes[3] = 0x50
    packetBytes[4] = 1
    packetBytes[5] = 0 // codec = JPEG
    packetBytes[6] = 0 // delta / non-key

    const view = new DataView(packetBytes.buffer, packetBytes.byteOffset, packetBytes.byteLength)
    view.setUint32(8, 10, true)
    view.setUint32(12, 1280, true)
    view.setUint32(16, 720, true)
    view.setUint32(20, 1, true)
    view.setBigUint64(24, 1000n, true)
    packetBytes.set(payload, 32)

    const parsed = parseScreenCapturePacket(packetBytes)
    expect(parsed).not.toBeNull()
    expect(parsed?.codec).toBe(0)
    expect(parsed?.isKeyframe).toBe(false)
    expect(parsed?.width).toBe(1280)
    expect(parsed?.height).toBe(720)
  })

  it('mantem retrocompatibilidade com o cabecalho legado de 12 bytes', () => {
    const jpegPayload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xDB])
    const legacyBytes = new Uint8Array(12 + jpegPayload.byteLength)
    const view = new DataView(legacyBytes.buffer, legacyBytes.byteOffset, legacyBytes.byteLength)

    view.setUint32(0, 1280, true) // width
    view.setUint32(4, 720, true) // height
    view.setUint32(8, 99, true) // captureId
    legacyBytes.set(jpegPayload, 12)

    const parsed = parseScreenCapturePacket(legacyBytes)
    expect(parsed).not.toBeNull()
    expect(parsed?.codec).toBe(0) // JPEG
    expect(parsed?.isKeyframe).toBe(true)
    expect(parsed?.width).toBe(1280)
    expect(parsed?.height).toBe(720)
    expect(parsed?.captureId).toBe(99)
    expect(parsed?.payload).toEqual(jpegPayload)
  })

  it('rejeita pacotes truncados menores que 12 bytes', () => {
    expect(parseScreenCapturePacket(new Uint8Array(8))).toBeNull()
    expect(parseScreenCapturePacket(new Uint8Array(0))).toBeNull()
  })

  it('extrai string de codec RFC 6381 a partir de SPS Annex B', () => {
    // 00 00 00 01 followed by NAL 7 (0x67) with profile 0x42 (66), constraints 0xE0, level 0x1F (31)
    const spsPayload = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xE0, 0x1F, 0x8D,
    ])
    expect(extractH264CodecString(spsPayload)).toBe('avc1.42e01f')
  })

  it('extrai string de codec com prefixo de 3 bytes (00 00 01)', () => {
    const spsPayload = new Uint8Array([
      0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xAC,
    ])
    expect(extractH264CodecString(spsPayload)).toBe('avc1.640028')
  })

  it('retorna fallback seguro quando payload nao contem SPS', () => {
    const dummyPayload = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    expect(extractH264CodecString(dummyPayload)).toBe('avc1.420028')
  })
})

describe('solicitacao de keyframe sob demanda', () => {
  it('ignora chamada silenciosamente fora do Tauri ou com captureId invalido', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    await expect(requestScreenCaptureKeyframe(0)).resolves.toBeUndefined()
    await expect(requestScreenCaptureKeyframe(-1)).resolves.toBeUndefined()
  })
})
