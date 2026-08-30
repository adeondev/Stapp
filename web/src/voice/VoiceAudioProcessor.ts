import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import workletUrl from './voice-audio-worklet.ts?worker&url'
import type { InputMode } from './preferences'

export interface VoiceProcessorSettings {
  inputVolume: number
  inputMode: InputMode
  automaticSensitivity: boolean
  sensitivity: number
}
export interface ConfigurableAudioProcessor {
  update(settings: VoiceProcessorSettings): void
  destroy(): Promise<void>
}

/** Ganho e gate de atividade inteiramente locais para os modos sem RNNoise. */
export class VoiceAudioProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>, ConfigurableAudioProcessor
{
  readonly name = 'stapp-voice-processing'
  processedTrack?: MediaStreamTrack

  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null

  constructor(private settings: VoiceProcessorSettings) {}

  async init(options: AudioProcessorOptions) {
    await options.audioContext.audioWorklet.addModule(workletUrl)
    const source = options.audioContext.createMediaStreamSource(new MediaStream([options.track]))
    const node = new AudioWorkletNode(options.audioContext, 'stapp-voice-processing', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
    })
    const destination = options.audioContext.createMediaStreamDestination()
    node.port.postMessage({ t: 'config', settings: this.settings })
    source.connect(node).connect(destination)
    const processed = destination.stream.getAudioTracks()[0]
    if (!processed) throw new Error('O processamento nao criou uma faixa de saida')
    this.source = source
    this.node = node
    this.destination = destination
    this.processedTrack = processed
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
