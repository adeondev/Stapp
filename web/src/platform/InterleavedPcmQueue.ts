export class InterleavedPcmQueue {
  private readonly buffer: Float32Array
  private head = 0
  private queuedSamples = 0
  private droppedSampleCount = 0

  constructor(
    private readonly maxSamples: number,
    private readonly recoverySamples: number,
  ) {
    this.buffer = new Float32Array(Math.max(2, maxSamples))
  }

  push(chunk: Float32Array) {
    if (chunk.length === 0) return
    let sourceOffset = 0
    const total = this.queuedSamples + chunk.length
    if (total > this.maxSamples) {
      let toDrop = total - this.recoverySamples
      const fromQueue = Math.min(toDrop, this.queuedSamples)
      this.consume(fromQueue)
      toDrop -= fromQueue
      sourceOffset = Math.min(toDrop, chunk.length)
      this.droppedSampleCount += fromQueue + sourceOffset
    }
    for (let index = sourceOffset; index < chunk.length; index += 1) {
      const tail = (this.head + this.queuedSamples) % this.buffer.length
      this.buffer[tail] = chunk[index] ?? 0
      this.queuedSamples += 1
    }
  }

  read() {
    const value = this.peek(0)
    this.consume(1)
    return value
  }

  peek(relativeIndex: number) {
    if (relativeIndex < 0 || relativeIndex >= this.queuedSamples) return 0
    return this.buffer[(this.head + relativeIndex) % this.buffer.length] ?? 0
  }

  consume(requestedSamples: number) {
    const samples = Math.min(Math.max(0, requestedSamples), this.queuedSamples)
    this.head = (this.head + samples) % this.buffer.length
    this.queuedSamples -= samples
  }

  clear() {
    this.head = 0
    this.queuedSamples = 0
  }

  get length() { return this.queuedSamples }
  get droppedSamples() { return this.droppedSampleCount }
}

export interface AdaptivePcmStats {
  bufferedFrames: number
  playbackRate: number
  buffering: boolean
  underruns: number
  droppedFrames: number
}

export class AdaptiveStereoPcmPlayout {
  private readonly queue: InterleavedPcmQueue
  private phase = 0
  private buffering = true
  private underrunCount = 0
  private playbackRate = 1

  constructor(
    private readonly targetFrames: number,
    private readonly prebufferFrames: number,
    maxFrames: number,
  ) {
    this.queue = new InterleavedPcmQueue(maxFrames * 2, targetFrames * 2)
  }

  push(interleavedStereo: Float32Array) {
    this.queue.push(interleavedStereo)
  }

  render(left: Float32Array, right?: Float32Array) {
    left.fill(0)
    right?.fill(0)
    if (this.buffering) {
      if (this.bufferedFrames < this.prebufferFrames) return this.stats()
      this.buffering = false
    }

    const fillError = (this.bufferedFrames - this.targetFrames) / Math.max(1, this.targetFrames)
    this.playbackRate = clamp(1 + fillError * 0.01, 0.995, 1.005)
    for (let outputFrame = 0; outputFrame < left.length; outputFrame += 1) {
      if (this.bufferedFrames < 2) {
        this.buffering = true
        this.underrunCount += 1
        this.phase = 0
        break
      }
      const mix = this.phase
      left[outputFrame] = lerp(this.queue.peek(0), this.queue.peek(2), mix)
      if (right) right[outputFrame] = lerp(this.queue.peek(1), this.queue.peek(3), mix)
      this.phase += this.playbackRate
      const consumedFrames = Math.floor(this.phase)
      if (consumedFrames > 0) {
        this.queue.consume(consumedFrames * 2)
        this.phase -= consumedFrames
      }
    }
    return this.stats()
  }

  clear() {
    this.queue.clear()
    this.phase = 0
    this.buffering = true
    this.playbackRate = 1
  }

  stats(): AdaptivePcmStats {
    return {
      bufferedFrames: this.bufferedFrames,
      playbackRate: this.playbackRate,
      buffering: this.buffering,
      underruns: this.underrunCount,
      droppedFrames: Math.floor(this.queue.droppedSamples / 2),
    }
  }

  get bufferedFrames() { return Math.floor(this.queue.length / 2) }
}

function lerp(first: number, second: number, mix: number) {
  return first + (second - first) * mix
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
