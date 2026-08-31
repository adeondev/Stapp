import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import workletUrl from './rnnoise-worklet.ts?worker&url'
import type { ConfigurableAudioProcessor, VoiceProcessorSettings } from './VoiceAudioProcessor'

/** RNNoise local: 48 kHz, mono, sem rede e sem enviar amostras para fora. */
export class RnnoiseTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>, ConfigurableAudioProcessor
{
  readonly name = 'stapp-rnnoise'
  processedTrack?: MediaStreamTrack

  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private context: AudioContext | null = null
  sampleRate?: number

  constructor(private settings: VoiceProcessorSettings) {}

  async init(options: AudioProcessorOptions) {
    let stage = 'criando AudioContext'
    const context = new AudioContext({ sampleRate: 48_000 })
    this.sampleRate = context.sampleRate
    if (context.sampleRate !== 48_000) {
      await context.close().catch(() => {})
      throw new Error(`RNNoise recebeu ${context.sampleRate} Hz em vez de 48000 Hz`)
    }
    let source: MediaStreamAudioSourceNode | null = null
    let node: AudioWorkletNode | null = null
    let destination: MediaStreamAudioDestinationNode | null = null
    let processed: MediaStreamTrack | undefined
    let readyTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      stage = 'retomando AudioContext'
      await context.resume()
      if (context.state !== 'running') {
        throw new Error(`RNNoise nao iniciou o AudioContext (estado: ${context.state})`)
      }
      stage = 'carregando AudioWorklet'
      await context.audioWorklet.addModule(workletUrl)
      stage = 'criando nós de áudio'
      source = context.createMediaStreamSource(new MediaStream([options.track]))
      node = new AudioWorkletNode(context, 'stapp-rnnoise', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
      })
      const ready = new Promise<void>((resolve, reject) => {
        readyTimeout = setTimeout(() => reject(new Error('RNNoise nao respondeu')), 8_000)
        node?.port.addEventListener('message', (event) => {
          if (event.data?.t !== 'ready' && event.data?.t !== 'error') return
          clearTimeout(readyTimeout)
          if (event.data.t === 'ready') resolve()
          else reject(new Error(`RNNoise nao inicializou: ${event.data.message || 'erro desconhecido'}`))
        })
        node?.addEventListener('processorerror', () => {
          clearTimeout(readyTimeout)
          reject(new Error('RNNoise encontrou um erro dentro do AudioWorklet'))
        }, { once: true })
        node?.port.start()
      })
      stage = 'inicializando WASM'
      node.port.postMessage({ t: 'config', settings: this.settings })
      destination = context.createMediaStreamDestination()
      source.connect(node).connect(destination)
      processed = destination.stream.getAudioTracks()[0]
      if (!processed) throw new Error('RNNoise nao criou uma faixa de saida')
      await ready
      this.context = context
      this.source = source
      this.node = node
      this.destination = destination
      this.processedTrack = processed
    } catch (error) {
      clearTimeout(readyTimeout)
      source?.disconnect()
      node?.disconnect()
      destination?.disconnect()
      processed?.stop()
      await context.close().catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`RNNoise falhou em ${stage} (${context.sampleRate} Hz): ${message}`, { cause: error })
    }
  }

  update(settings: VoiceProcessorSettings) {
    this.settings = settings
    this.node?.port.postMessage({ t: 'config', settings })
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy()
    await this.init(options)
  }

  async destroy() {
    this.node?.port.postMessage({ t: 'destroy' })
    this.source?.disconnect()
    this.node?.disconnect()
    this.destination?.disconnect()
    this.processedTrack?.stop()
    await this.context?.close().catch(() => {})
    this.source = null
    this.node = null
    this.destination = null
    this.context = null
    this.processedTrack = undefined
  }
}
