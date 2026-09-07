/**
 * PlaybackGraph.ts
 *
 * Abstração de grafo de reprodução via Web Audio API.
 * Para cada track de áudio recebida, cria um AudioContext contendo um
 * MediaStreamAudioSourceNode conectado a um GainNode, este ligado a um
 * DynamicsCompressorNode em modo limiter e só então ao destination.
 *
 * Elementos <audio> do HTML5 limitam estritamente a propriedade .volume a 1.0.
 * O GainNode viabiliza multiplicadores de ganho de até 2.0 (200%), suportando
 * o boost real configurado nos sliders de participantes e volume master.
 *
 * O limiter existe porque ganho acima de 1.0 satura a saída: sem ele, uma voz
 * já alta amplificada a 200% estoura em distorção digital dura. Ele é o último
 * nó antes do destination para pegar o sinal depois de toda amplificação.
 *
 * Todas as referências aos nós criados são retidas em memória para impedir
 * coleta indevida de lixo pelo garbage collector do motor V8.
 */

/** Limiar em dB a partir do qual o limiter começa a segurar o sinal. */
const LIMITER_THRESHOLD_DB = -3
/** Joelho rígido: queremos limiter, não compressão musical suave. */
const LIMITER_KNEE_DB = 0
/** Razão alta o bastante para o nó agir como limiter e não como compressor. */
const LIMITER_RATIO = 20
/** Ataque curto para capturar transientes de voz sem deixar passar o pico. */
const LIMITER_ATTACK_S = 0.003
/** Release moderado para não bombear o volume entre sílabas. */
const LIMITER_RELEASE_S = 0.25

/**
 * Instância singleton global de AudioContext compartilhada por todas as tracks
 * remotas para prevenir exaustão de contextos de hardware no Chromium (BC-2).
 */
let sharedAudioContext: AudioContext | null = null

export function getSharedAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') {
    return null
  }
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContext()
  }
  return sharedAudioContext
}

export function resetSharedAudioContext(): void {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    try {
      void sharedAudioContext.close().catch(() => {})
    } catch {
      // Ignora erro ao fechar contexto já finalizado
    }
  }
  sharedAudioContext = null
}

export interface PlaybackTrackNodes {
  readonly id: string
  readonly context: AudioContext
  readonly source: MediaStreamAudioSourceNode
  readonly gainNode: GainNode
  /** Ausente apenas onde o motor não expõe createDynamicsCompressor. */
  readonly limiter: DynamicsCompressorNode | null
  readonly stream: MediaStream
}

export class PlaybackGraph {
  private readonly tracks = new Map<string, PlaybackTrackNodes>()
  private readonly rawGains = new Map<string, number>()
  private readonly mutedStates = new Map<string, boolean>()
  private attenuated = false
  private attenuationFactor = 0
  private outputDeviceId?: string

  get size(): number {
    return this.tracks.size
  }

  has(id: string): boolean {
    return this.tracks.has(id)
  }

  getTrack(id: string): PlaybackTrackNodes | undefined {
    return this.tracks.get(id)
  }

  /**
   * Informa se o contexto compartilhado está suspenso pela política de autoplay.
   * Com o elemento <audio> mudo, o contexto suspenso passa a ser o único
   * sintoma de áudio bloqueado — quem chama usa isto para avisar o usuário.
   */
  hasSuspendedContext(): boolean {
    return sharedAudioContext?.state === 'suspended'
  }

  /**
   * Conecta uma track ou stream de áudio ao grafo de reprodução Web Audio API.
   * Conecta ao AudioContext compartilhado com MediaStreamAudioSourceNode, GainNode e
   * limiter encadeados até o destination.
   */
  attach(id: string, trackOrStream: MediaStreamTrack | MediaStream): PlaybackTrackNodes | null {
    this.detach(id)

    const context = getSharedAudioContext()
    if (!context) {
      return null
    }

    try {
      let stream: MediaStream
      if (typeof MediaStream !== 'undefined' && trackOrStream instanceof MediaStream) {
        stream = trackOrStream
      } else if (typeof MediaStream !== 'undefined') {
        stream = new MediaStream([trackOrStream as MediaStreamTrack])
      } else {
        stream = trackOrStream as unknown as MediaStream
      }

      const source = context.createMediaStreamSource(stream)
      const gainNode = context.createGain()
      const limiter = this.createLimiter(context)

      source.connect(gainNode)
      if (limiter) {
        gainNode.connect(limiter)
        limiter.connect(context.destination)
      } else {
        gainNode.connect(context.destination)
      }

      if (this.outputDeviceId && 'setSinkId' in context) {
        void (context as AudioContext & { setSinkId(id: string): Promise<void> })
          .setSinkId(this.outputDeviceId)
          .catch(() => {})
      }

      if (context.state === 'suspended') {
        void context.resume().catch(() => {})
      }

      const nodes: PlaybackTrackNodes = {
        id,
        context,
        source,
        gainNode,
        limiter,
        stream,
      }

      // Guarda referências ativas para evitar coleta indevida de lixo pelo GC do V8
      this.tracks.set(id, nodes)
      this.applyGain(id)
      return nodes
    } catch (error) {
      console.warn(`[PlaybackGraph] Falha ao criar grafo Web Audio para track ${id}:`, error)
      return null
    }
  }

  /**
   * Desconecta e destrói o grafo de áudio de uma track específica.
   */
  detach(id: string): void {
    const nodes = this.tracks.get(id)
    if (!nodes) return

    try {
      nodes.source.disconnect()
      nodes.gainNode.disconnect()
      nodes.limiter?.disconnect()
    } catch {
      // Ignora erros de teardown em nós já encerrados
    }

    this.tracks.delete(id)
    this.rawGains.delete(id)
    this.mutedStates.delete(id)
  }

  /**
   * Define o ganho multiplicador (0.0 até 2.0 = 200%).
   */
  setGain(id: string, gain: number): void {
    const clamped = Math.max(0, Math.min(2, Number.isFinite(gain) ? gain : 1))
    this.rawGains.set(id, clamped)
    this.applyGain(id)
  }

  getGain(id: string): number {
    return this.rawGains.get(id) ?? 1
  }

  /**
   * Define o estado de mudo da track.
   */
  setMuted(id: string, muted: boolean): void {
    this.mutedStates.set(id, muted)
    this.applyGain(id)
  }

  isMuted(id: string): boolean {
    return this.mutedStates.get(id) ?? false
  }

  /**
   * Ativa ou desativa a atenuação de todas as tracks (ex: durante teste de microfone).
   * @param factor Fator de ganho durante atenuação (padrão: 0 para silenciar completamente)
   */
  setAttenuated(attenuated: boolean, factor = 0): void {
    this.attenuated = attenuated
    this.attenuationFactor = Math.max(0, Math.min(1, factor))
    for (const id of this.tracks.keys()) {
      this.applyGain(id)
    }
  }

  isAttenuated(): boolean {
    return this.attenuated
  }

  /**
   * Redireciona a saída de áudio do contexto compartilhado para o dispositivo selecionado.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId
    if (sharedAudioContext && 'setSinkId' in sharedAudioContext) {
      await (sharedAudioContext as AudioContext & { setSinkId(id: string): Promise<void> })
        .setSinkId(deviceId)
        .catch(() => {})
    }
  }

  /**
   * Retoma o AudioContext compartilhado se suspenso pela política de autoplay do navegador.
   */
  async resume(): Promise<void> {
    if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
      await sharedAudioContext.resume().catch(() => {})
    }
  }

  /**
   * Destrói todos os grafos de reprodução e libera o AudioContext compartilhado.
   */
  destroy(): void {
    for (const id of [...this.tracks.keys()]) {
      this.detach(id)
    }
    resetSharedAudioContext()
  }

  /**
   * Monta o limiter da saída. Devolve null onde o motor não expõe o nó — nesse
   * caso o grafo segue funcionando ligado direto ao destination, sem proteção
   * contra clipping, que é melhor do que ficar sem áudio.
   */
  private createLimiter(context: AudioContext): DynamicsCompressorNode | null {
    if (typeof context.createDynamicsCompressor !== 'function') return null
    try {
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = LIMITER_THRESHOLD_DB
      limiter.knee.value = LIMITER_KNEE_DB
      limiter.ratio.value = LIMITER_RATIO
      limiter.attack.value = LIMITER_ATTACK_S
      limiter.release.value = LIMITER_RELEASE_S
      return limiter
    } catch {
      return null
    }
  }

  private applyGain(id: string): void {
    const nodes = this.tracks.get(id)
    if (!nodes) return

    const isMuted = this.mutedStates.get(id) ?? false
    if (isMuted) {
      nodes.gainNode.gain.value = 0
      return
    }

    const baseGain = this.rawGains.get(id) ?? 1
    const effectiveGain = this.attenuated ? baseGain * this.attenuationFactor : baseGain
    nodes.gainNode.gain.value = effectiveGain
  }
}
