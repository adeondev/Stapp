// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RnnoiseTrackProcessor } from './RnnoiseTrackProcessor'

const createdContexts: FakeAudioContext[] = []
let addModuleError: Error | null = null

class FakePort {
  private readonly listeners: Array<(event: MessageEvent) => void> = []
  addEventListener(_event: string, listener: (event: MessageEvent) => void) {
    this.listeners.push(listener)
  }
  start() {}
  postMessage(message: { t?: string }) {
    if (message.t === 'config') {
      queueMicrotask(() => {
        for (const listener of this.listeners) {
          listener({ data: { t: 'ready' } } as MessageEvent)
        }
      })
    }
  }
}

class FakeAudioWorkletNode {
  readonly port = new FakePort()
  addEventListener = vi.fn()
  connect(target: unknown) { return target }
  disconnect = vi.fn()
}

class FakeAudioContext {
  readonly sampleRate: number
  state: AudioContextState = 'suspended'
  readonly audioWorklet = {
    addModule: vi.fn(async () => {
      if (addModuleError) throw addModuleError
    }),
  }
  readonly outputTrack = { stop: vi.fn(), kind: 'audio' }
  readonly close = vi.fn(async () => {})
  readonly resume = vi.fn(async () => { this.state = 'running' })
  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 44_100
    createdContexts.push(this)
  }
  createMediaStreamSource() {
    return { connect: (target: unknown) => target, disconnect: vi.fn() }
  }
  createMediaStreamDestination() {
    return {
      stream: { getAudioTracks: () => [this.outputTrack] },
      disconnect: vi.fn(),
    }
  }
}

describe('RnnoiseTrackProcessor', () => {
  beforeEach(() => {
    createdContexts.length = 0
    addModuleError = null
    Object.defineProperty(window, 'AudioContext', {
      configurable: true, value: FakeAudioContext,
    })
    Object.defineProperty(window, 'AudioWorkletNode', {
      configurable: true, value: FakeAudioWorkletNode,
    })
    Object.defineProperty(window, 'MediaStream', {
      configurable: true, value: class { constructor(_tracks: unknown[]) {} },
    })
  })

  it('usa contexto proprio de 48 kHz mesmo se o contexto do LiveKit for 44,1 kHz', async () => {
    const processor = new RnnoiseTrackProcessor({
      inputVolume: 100, inputMode: 'voice_activity', automaticSensitivity: true, sensitivity: -50,
    })
    await processor.init({
      audioContext: { sampleRate: 44_100 },
      track: { kind: 'audio' },
    } as never)

    expect(createdContexts).toHaveLength(1)
    expect(createdContexts[0]?.sampleRate).toBe(48_000)
    expect(processor.sampleRate).toBe(48_000)
    expect(createdContexts[0]?.resume).toHaveBeenCalledOnce()
    expect(processor.processedTrack).toBe(createdContexts[0]?.outputTrack)
    await processor.destroy()
    expect(createdContexts[0]?.close).toHaveBeenCalledOnce()
    expect(createdContexts[0]?.outputTrack.stop).toHaveBeenCalledOnce()
  })

  it('informa etapa e sample rate quando o WebView rejeita o worklet', async () => {
    addModuleError = new Error('modulo recusado pelo WebView')
    const processor = new RnnoiseTrackProcessor({
      inputVolume: 100, inputMode: 'voice_activity', automaticSensitivity: true, sensitivity: -50,
    })

    await expect(processor.init({
      audioContext: { sampleRate: 44_100 },
      track: { kind: 'audio' },
    } as never)).rejects.toThrow(
      'RNNoise falhou em carregando AudioWorklet (48000 Hz): modulo recusado pelo WebView',
    )
    expect(createdContexts[0]?.close).toHaveBeenCalledOnce()
  })
})
