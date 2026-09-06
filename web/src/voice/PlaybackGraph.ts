/**
 * PlaybackGraph.ts
 *
 * Abstração de grafo de reprodução via Web Audio API.
 * Para cada track de áudio recebida, cria um AudioContext contendo um
 * MediaStreamAudioSourceNode conectado a um GainNode, este ligado ao destination.
 *
 * Elementos <audio> do HTML5 limitam estritamente a propriedade .volume a 1.0.
 * O GainNode viabiliza multiplicadores de ganho de até 2.0 (200%), suportando
 * o boost real configurado nos sliders de participantes e volume master.
 *
 * Todas as referências aos nós criados são retidas em memória para impedir
 * coleta indevida de lixo pelo garbage collector do motor V8.
 */

export interface PlaybackTrackNodes {
  readonly id: string
  readonly context: AudioContext
  readonly source: MediaStreamAudioSourceNode
  readonly gainNode: GainNode
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
   * Conecta uma track ou stream de áudio ao grafo de reprodução Web Audio API.
   * Cria um AudioContext dedicado com MediaStreamAudioSourceNode e GainNode conectado ao destination.
   */
  attach(id: string, trackOrStream: MediaStreamTrack | MediaStream): PlaybackTrackNodes | null {
    this.detach(id)

    if (typeof AudioContext === 'undefined') {
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

      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const gainNode = context.createGain()

      source.connect(gainNode)
      gainNode.connect(context.destination)

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
      void nodes.context.close().catch(() => {})
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
   * Redireciona a saída de áudio de todos os contextos ativos para o dispositivo selecionado.
   */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId
    const promises: Promise<void>[] = []
    for (const nodes of this.tracks.values()) {
      if ('setSinkId' in nodes.context) {
        promises.push(
          (nodes.context as AudioContext & { setSinkId(id: string): Promise<void> })
            .setSinkId(deviceId)
            .catch(() => {}),
        )
      }
    }
    await Promise.all(promises)
  }

  /**
   * Retoma todos os AudioContexts suspensos pela política de autoplay do navegador.
   */
  async resume(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const nodes of this.tracks.values()) {
      if (nodes.context.state === 'suspended') {
        promises.push(nodes.context.resume().catch(() => {}))
      }
    }
    await Promise.all(promises)
  }

  /**
   * Destrói todos os grafos de reprodução e libera todos os AudioContexts.
   */
  destroy(): void {
    for (const id of [...this.tracks.keys()]) {
      this.detach(id)
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
