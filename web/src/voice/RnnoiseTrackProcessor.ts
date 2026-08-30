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

  constructor(private settings: VoiceProcessorSettings) {}

  async init(options: AudioProcessorOptions) {
    if (options.audioContext.sampleRate !== 48_000) {
      throw new Error('RNNoise exige audio a 48 kHz')
    }
    await options.audioContext.audioWorklet.addModule(workletUrl)
    const source = options.audioContext.createMediaStreamSource(new MediaStream([options.track]))
    const node = new AudioWorkletNode(options.audioContext, 'stapp-rnnoise', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
    })
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('RNNoise nao respondeu')), 8_000)
      node.port.addEventListener('message', (event) => {
        if (event.data?.t !== 'ready' && event.data?.t !== 'error') return
        clearTimeout(timeout)
        if (event.data.t === 'ready') resolve()
        else reject(new Error('RNNoise nao inicializou'))
      })
      node.port.start()
    })
    node.port.postMessage({ t: 'config', settings: this.settings })
    const destination = options.audioContext.createMediaStreamDestination()
    source.connect(node).connect(destination)
    const processed = destination.stream.getAudioTracks()[0]
    if (!processed) throw new Error('RNNoise nao criou uma faixa de saida')
    this.source = source
    this.node = node
    this.destination = destination
    this.processedTrack = processed
    await ready
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
    this.source = null
    this.node = null
    this.destination = null
    this.processedTrack = undefined
  }
}
