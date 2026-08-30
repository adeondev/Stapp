import createRnnoiseModule from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js'

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor
  new (): AudioWorkletProcessor
}
declare interface AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

const FRAME = 480
const BYTES = FRAME * Float32Array.BYTES_PER_ELEMENT

interface Settings {
  inputVolume: number
  inputMode: 'voice_activity' | 'push_to_talk'
  automaticSensitivity: boolean
  sensitivity: number
}

class StappRnnoiseProcessor extends AudioWorkletProcessor {
  private readonly module = createRnnoiseModule({})
  private state = 0
  private inputPointer = 0
  private outputPointer = 0
  private input = new Float32Array(FRAME)
  private inputOffset = 0
  private output = new Float32Array(FRAME * 4)
  private outputRead = 0
  private outputWrite = 0
  private outputCount = 0
  private ready = false
  private settings: Settings = {
    inputVolume: 100,
    inputMode: 'voice_activity',
    automaticSensitivity: true,
    sensitivity: -50,
  }
  private noiseFloor = -72
  private gate = 1
  private holdFrames = 0

  constructor() {
    super()
    void this.module.ready.then(() => {
      this.inputPointer = this.module._malloc(BYTES)
      this.outputPointer = this.module._malloc(BYTES)
      this.state = this.module._rnnoise_create(0)
      this.ready = Boolean(this.state && this.inputPointer && this.outputPointer)
      this.port.postMessage({ t: this.ready ? 'ready' : 'error' })
    }).catch(() => this.port.postMessage({ t: 'error' }))
    this.port.addEventListener('message', (event) => {
      if (event.data?.t === 'destroy') this.destroy()
      if (event.data?.t === 'config') this.settings = event.data.settings as Settings
    })
    this.port.start()
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const source = inputs[0]?.[0]
    const target = outputs[0]?.[0]
    if (!target) return true
    if (!source || !this.ready) {
      if (source) target.set(source)
      else target.fill(0)
      return true
    }

    for (const sample of source) {
      this.input[this.inputOffset++] = sample
      if (this.inputOffset === FRAME) {
        const heapOffset = this.inputPointer / Float32Array.BYTES_PER_ELEMENT
        for (let index = 0; index < FRAME; index += 1) {
          this.module.HEAPF32[heapOffset + index] = this.input[index] * 32768
        }
        this.module._rnnoise_process_frame(this.state, this.outputPointer, this.inputPointer)
        const outputOffset = this.outputPointer / Float32Array.BYTES_PER_ELEMENT
        for (let index = 0; index < FRAME; index += 1) {
          this.output[this.outputWrite] = this.module.HEAPF32[outputOffset + index] / 32768
          this.outputWrite = (this.outputWrite + 1) % this.output.length
          this.outputCount = Math.min(this.output.length, this.outputCount + 1)
        }
        this.inputOffset = 0
      }
    }

    let energy = 0
    for (let index = 0; index < target.length; index += 1) {
      if (this.outputCount > 0) {
        target[index] = this.output[this.outputRead]
        this.outputRead = (this.outputRead + 1) % this.output.length
        this.outputCount -= 1
      } else {
        target[index] = 0
      }
      energy += target[index] * target[index]
    }
    const rms = Math.sqrt(energy / Math.max(1, target.length))
    const db = 20 * Math.log10(Math.max(rms, 0.00001))
    const automaticThreshold = Math.max(-65, Math.min(-25, this.noiseFloor + 12))
    const threshold = this.settings.automaticSensitivity ? automaticThreshold : this.settings.sensitivity
    const speaking = this.settings.inputMode !== 'voice_activity' || db >= threshold
    if (!speaking) this.noiseFloor = this.noiseFloor * 0.995 + db * 0.005
    this.holdFrames = speaking ? 75 : Math.max(0, this.holdFrames - 1)
    const desired = speaking || this.holdFrames > 0 ? 1 : 0
    this.gate += (desired - this.gate) * (desired > this.gate ? 0.45 : 0.08)
    const gain = Math.max(0, Math.min(2, this.settings.inputVolume / 100)) * this.gate
    for (let index = 0; index < target.length; index += 1) {
      target[index] = Math.max(-1, Math.min(1, target[index] * gain))
    }
    return true
  }

  private destroy() {
    if (this.state) this.module._rnnoise_destroy(this.state)
    if (this.inputPointer) this.module._free(this.inputPointer)
    if (this.outputPointer) this.module._free(this.outputPointer)
    this.ready = false
    this.state = 0
  }
}

registerProcessor('stapp-rnnoise', StappRnnoiseProcessor)
