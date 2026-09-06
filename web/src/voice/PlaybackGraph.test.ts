// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackGraph } from './PlaybackGraph'

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

class FakeCompressorNode extends FakeAudioNode {
  threshold = { value: 0 }
  knee = { value: 0 }
  ratio = { value: 0 }
  attack = { value: 0 }
  release = { value: 0 }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  destination = new FakeAudioNode()
  createMediaStreamSource = vi.fn((_stream: MediaStream) => new FakeAudioNode() as unknown as MediaStreamAudioSourceNode)
  createGain = vi.fn(() => new FakeGainNode() as unknown as GainNode)
  createDynamicsCompressor = vi.fn(() => new FakeCompressorNode() as unknown as DynamicsCompressorNode)
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  setSinkId = vi.fn(async (_id: string) => {})
}

class FakeMediaStream {
  tracks: any[]
  constructor(tracks?: any[]) {
    this.tracks = tracks ?? []
  }
}

describe('PlaybackGraph', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(window, 'MediaStream', {
      configurable: true,
      value: FakeMediaStream,
    })
    Object.defineProperty(globalThis, 'MediaStream', {
      configurable: true,
      value: FakeMediaStream,
    })
  })

  it('cria grafo Web Audio conectando source -> gainNode -> limiter -> destination e retem referencias', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-1', stop: vi.fn() } as unknown as MediaStreamTrack

    const nodes = graph.attach('pub-1', track)
    expect(nodes).toBeDefined()
    expect(nodes?.id).toBe('pub-1')
    expect(nodes?.context).toBeInstanceOf(FakeAudioContext)
    expect(nodes?.source).toBeDefined()
    expect(nodes?.gainNode).toBeDefined()
    expect(nodes?.limiter).toBeDefined()
    expect(nodes?.stream).toBeInstanceOf(MediaStream)

    // Verifica conexões do grafo: o limiter fica entre o ganho e a saída, para
    // pegar o sinal depois de toda amplificação.
    expect(nodes?.source.connect).toHaveBeenCalledWith(nodes?.gainNode)
    expect(nodes?.gainNode.connect).toHaveBeenCalledWith(nodes?.limiter)
    expect(nodes?.limiter?.connect).toHaveBeenCalledWith(nodes?.context.destination)
    expect(nodes?.gainNode.connect).not.toHaveBeenCalledWith(nodes?.context.destination)

    // Referências ativas mantidas na instância para blindagem contra GC
    expect(graph.has('pub-1')).toBe(true)
    expect(graph.getTrack('pub-1')).toBe(nodes)
  })

  it('configura o compressor como limiter e nao como compressor musical', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-limiter', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-limiter', track)!

    // Joelho rigido e razao alta caracterizam um limiter: sem isso o ganho de
    // 200% entrega distorcao digital dura em vez de teto de amplitude.
    expect(nodes.limiter?.threshold.value).toBe(-3)
    expect(nodes.limiter?.knee.value).toBe(0)
    expect(nodes.limiter?.ratio.value).toBe(20)
    expect(nodes.limiter?.attack.value).toBeCloseTo(0.003, 4)
    expect(nodes.limiter?.release.value).toBeCloseTo(0.25, 4)
  })

  it('liga o ganho direto ao destination onde o motor nao expoe compressor', () => {
    class ContextSemCompressor extends FakeAudioContext {
      createDynamicsCompressor = undefined as unknown as FakeAudioContext['createDynamicsCompressor']
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: ContextSemCompressor,
    })

    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-sem-limiter', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-sem-limiter', track)!

    // Sem limiter e melhor do que sem audio: o grafo continua completo.
    expect(nodes.limiter).toBeNull()
    expect(nodes.gainNode.connect).toHaveBeenCalledWith(nodes.context.destination)
    expect(graph.has('pub-sem-limiter')).toBe(true)
  })

  it('denuncia contexto suspenso pela politica de autoplay', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-autoplay', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-autoplay', track)!

    ;(nodes.context as any).state = 'running'
    expect(graph.hasSuspendedContext()).toBe(false)

    // Com o elemento <audio> mudo, o contexto suspenso e o unico sintoma de
    // audio bloqueado que sobra para avisar o usuario.
    ;(nodes.context as any).state = 'suspended'
    expect(graph.hasSuspendedContext()).toBe(true)
  })

  it('permite amplificacao real ate 200% (ganho 2.0) superando limite do HTML5 audio', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-boost', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-boost', track)!

    // Volume padrão 100% -> ganho 1.0
    graph.setGain('pub-boost', 1.0)
    expect(nodes.gainNode.gain.value).toBe(1.0)

    // Booster a 150% -> ganho 1.5
    graph.setGain('pub-boost', 1.5)
    expect(nodes.gainNode.gain.value).toBe(1.5)

    // Booster a 200% -> ganho 2.0
    graph.setGain('pub-boost', 2.0)
    expect(nodes.gainNode.gain.value).toBe(2.0)

    // Acima de 2.0 e limitado com seguranca em 2.0
    graph.setGain('pub-boost', 3.0)
    expect(nodes.gainNode.gain.value).toBe(2.0)

    // Valores negativos sao limitados em 0
    graph.setGain('pub-boost', -0.5)
    expect(nodes.gainNode.gain.value).toBe(0)
  })

  it('muta e desmuta preservando o volume configurado', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-mute', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-mute', track)!

    graph.setGain('pub-mute', 1.8)
    expect(nodes.gainNode.gain.value).toBe(1.8)

    // Mutar zera o ganho do GainNode
    graph.setMuted('pub-mute', true)
    expect(nodes.gainNode.gain.value).toBe(0)
    expect(graph.isMuted('pub-mute')).toBe(true)

    // Desmutar restaura o ganho anterior de 1.8 (180%)
    graph.setMuted('pub-mute', false)
    expect(nodes.gainNode.gain.value).toBe(1.8)
  })

  it('atenua o ganho durante transmissao/teste e restaura em seguida', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-duck', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-duck', track)!

    graph.setGain('pub-duck', 1.6)

    // Atenuação total (silêncio)
    graph.setAttenuated(true, 0)
    expect(nodes.gainNode.gain.value).toBe(0)
    expect(graph.isAttenuated()).toBe(true)

    // Restauração do volume normal
    graph.setAttenuated(false)
    expect(nodes.gainNode.gain.value).toBe(1.6)

    // Atenuação parcial (ex: 20% do volume original)
    graph.setAttenuated(true, 0.2)
    expect(nodes.gainNode.gain.value).toBeCloseTo(0.32, 2)
  })

  it('desconecta nos e fecha o AudioContext ao desacoplar track', () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-detach', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-detach', track)!

    graph.detach('pub-detach')
    expect(nodes.source.disconnect).toHaveBeenCalled()
    expect(nodes.gainNode.disconnect).toHaveBeenCalled()
    expect(nodes.context.close).toHaveBeenCalled()
    expect(graph.has('pub-detach')).toBe(false)
    expect(graph.size).toBe(0)
  })

  it('redireciona dispositivos de saida via setSinkId nos contextos ativos', async () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-sink', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-sink', track)!

    await graph.setOutputDevice('device-headphones-123')
    expect((nodes.context as any).setSinkId).toHaveBeenCalledWith('device-headphones-123')
  })

  it('retoma contextos suspensos via resume()', async () => {
    const graph = new PlaybackGraph()
    const track = { kind: 'audio', id: 'track-resume', stop: vi.fn() } as unknown as MediaStreamTrack
    const nodes = graph.attach('pub-resume', track)!

    // Simula transição para suspenso (ex: política de autoplay do navegador ou dispositivo desconectado)
    ;(nodes.context as any).state = 'suspended'
    vi.mocked(nodes.context.resume).mockClear()

    await graph.resume()
    expect(nodes.context.resume).toHaveBeenCalled()
  })

  it('destroy libera todos os grafos ativos', () => {
    const graph = new PlaybackGraph()
    const track1 = { kind: 'audio', id: 'track-1', stop: vi.fn() } as unknown as MediaStreamTrack
    const track2 = { kind: 'audio', id: 'track-2', stop: vi.fn() } as unknown as MediaStreamTrack

    const n1 = graph.attach('p1', track1)!
    const n2 = graph.attach('p2', track2)!

    expect(graph.size).toBe(2)
    graph.destroy()

    expect(graph.size).toBe(0)
    expect(n1.context.close).toHaveBeenCalled()
    expect(n2.context.close).toHaveBeenCalled()
  })
})
