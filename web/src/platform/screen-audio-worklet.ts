import { AdaptiveStereoPcmPlayout } from './InterleavedPcmQueue'

// Keep the pipeline live. Old samples are less useful than a short discontinuity
// when IPC/WebView scheduling falls behind the 48 kHz capture clock.
const SAMPLE_RATE = 48_000
const TARGET_FRAMES = SAMPLE_RATE * 0.06
const PREBUFFER_FRAMES = SAMPLE_RATE * 0.06
const MAX_BUFFERED_FRAMES = SAMPLE_RATE * 0.2

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor
  new (): AudioWorkletProcessor
}
declare interface AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class ScreenAudioWorklet extends AudioWorkletProcessor {
  private readonly playout = new AdaptiveStereoPcmPlayout(
    TARGET_FRAMES,
    PREBUFFER_FRAMES,
    MAX_BUFFERED_FRAMES,
  )
  private running = true
  private renderedFrames = 0

  constructor() {
    super()
    this.port.addEventListener('message', (event: MessageEvent<{
      t: 'pcm' | 'destroy'
      buffer?: ArrayBuffer
    }>) => {
      if (event.data.t === 'destroy') {
        this.running = false
        this.playout.clear()
        return
      }
      if (event.data.buffer) this.playout.push(new Float32Array(event.data.buffer))
    })
    this.port.start()
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]
    const left = output?.[0]
    if (!left) return this.running
    const right = output[1]
    const stats = this.playout.render(left, right)
    for (let channel = 2; channel < output.length; channel += 1) {
      output[channel]?.fill(0)
    }
    this.renderedFrames += left.length
    if (this.renderedFrames >= SAMPLE_RATE) {
      this.renderedFrames = 0
      this.port.postMessage({ t: 'stats', ...stats })
    }
    return this.running
  }
}

registerProcessor('stapp-screen-audio', ScreenAudioWorklet)
