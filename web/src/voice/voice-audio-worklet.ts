declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor
  new (): AudioWorkletProcessor
}
declare interface AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

interface Settings {
  inputVolume: number
  inputMode: 'voice_activity' | 'push_to_talk'
  automaticSensitivity: boolean
  sensitivity: number
}

class VoiceProcessingWorklet extends AudioWorkletProcessor {
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
    this.port.addEventListener('message', (event) => {
      if (event.data?.t === 'config') this.settings = event.data.settings as Settings
    })
    this.port.start()
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const source = inputs[0]?.[0]
    const target = outputs[0]?.[0]
    if (!target) return true
    if (!source) {
      target.fill(0)
      return true
    }
    const signal = calculateGate(source, this.settings, this.noiseFloor, this.holdFrames)
    this.noiseFloor = signal.noiseFloor
    this.holdFrames = signal.holdFrames
    const desired = signal.open ? 1 : 0
    this.gate += (desired - this.gate) * (desired > this.gate ? 0.45 : 0.08)
    const gain = Math.max(0, Math.min(2, this.settings.inputVolume / 100)) * this.gate
    for (let index = 0; index < target.length; index += 1) {
      target[index] = Math.max(-1, Math.min(1, (source[index] ?? 0) * gain))
    }
    return true
  }
}

function calculateGate(
  samples: Float32Array,
  settings: Settings,
  previousNoiseFloor: number,
  previousHold: number,
) {
  if (settings.inputMode !== 'voice_activity') {
    return { open: true, noiseFloor: previousNoiseFloor, holdFrames: 0 }
  }
  let energy = 0
  for (const sample of samples) energy += sample * sample
  const rms = Math.sqrt(energy / Math.max(1, samples.length))
  const db = 20 * Math.log10(Math.max(rms, 0.00001))
  const automaticThreshold = Math.max(-65, Math.min(-25, previousNoiseFloor + 12))
  const threshold = settings.automaticSensitivity ? automaticThreshold : settings.sensitivity
  const speaking = db >= threshold
  const noiseFloor = !speaking
    ? previousNoiseFloor * 0.995 + db * 0.005
    : previousNoiseFloor
  const holdFrames = speaking ? 75 : Math.max(0, previousHold - 1)
  return { open: speaking || holdFrames > 0, noiseFloor, holdFrames }
}

registerProcessor('stapp-voice-processing', VoiceProcessingWorklet)
