// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startMicrophoneTest } from './testMicrophone'

class FakeAudioNode {
  connectedTo: any = null
  connect = vi.fn((target: any) => {
    this.connectedTo = target
    return target
  })
  disconnect = vi.fn(() => {
    this.connectedTo = null
  })
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 }
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 1024
  getByteTimeDomainData = vi.fn((data: Uint8Array) => {
    data.fill(128)
  })
}

let lastContext: FakeAudioContext | null = null

class FakeAudioContext {
  state: AudioContextState = 'running'
  destination = new FakeAudioNode()
  createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode() as unknown as MediaStreamAudioSourceNode)
  createAnalyser = vi.fn(() => new FakeAnalyserNode() as unknown as AnalyserNode)
  createGain = vi.fn(() => new FakeGainNode() as unknown as GainNode)
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  setSinkId = vi.fn(async (_id: string) => {})

  constructor() {
    lastContext = this
  }
}

describe('startMicrophoneTest', () => {
  const fakeTrack = { kind: 'audio', stop: vi.fn() }
  const fakeStream = {
    getTracks: () => [fakeTrack],
  }

  beforeEach(() => {
    lastContext = null
    fakeTrack.stop.mockClear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => fakeStream),
      },
    })
  })

  it('fecha o grafo ligando o microfone capturado ate o destination para loopback audivel', async () => {
    const onLevel = vi.fn()
    const stop = await startMicrophoneTest({}, onLevel, 'output-device-1')

    expect(lastContext).toBeDefined()
    expect(lastContext?.createMediaStreamSource).toHaveBeenCalled()
    expect(lastContext?.createGain).toHaveBeenCalled()
    expect(lastContext?.createAnalyser).toHaveBeenCalled()

    // Verifica que o monitor de ganho foi conectado ao destination
    const gainNodeInstance = lastContext?.createGain.mock.results[0]?.value as FakeGainNode
    expect(gainNodeInstance).toBeDefined()
    expect(gainNodeInstance.connect).toHaveBeenCalledWith(lastContext?.destination)

    // Verifica que o dispositivo de saída foi roteado
    expect(lastContext?.setSinkId).toHaveBeenCalledWith('output-device-1')

    // Parar o teste desconecta nós, para faixas de mídia e fecha o AudioContext
    stop()
    expect(gainNodeInstance.disconnect).toHaveBeenCalled()
    expect(fakeTrack.stop).toHaveBeenCalled()
    expect(lastContext?.close).toHaveBeenCalled()
    expect(onLevel).toHaveBeenCalledWith(0)
  })

  it('lanca erro descritivo quando fora de contexto seguro', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    await expect(startMicrophoneTest({}, vi.fn())).rejects.toThrow(
      'O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.',
    )
  })
})
