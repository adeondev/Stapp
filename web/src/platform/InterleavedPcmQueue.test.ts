import { describe, expect, it } from 'vitest'
import { AdaptiveStereoPcmPlayout, InterleavedPcmQueue } from './InterleavedPcmQueue'

describe('InterleavedPcmQueue', () => {
  it('descarta audio antigo ao atrasar e preserva os canais stereo', () => {
    const queue = new InterleavedPcmQueue(12, 4)
    queue.push(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]))
    queue.push(new Float32Array([8, 9, 10, 11, 12, 13, 14, 15]))

    expect(queue.length).toBe(4)
    expect([queue.read(), queue.read(), queue.read(), queue.read()]).toEqual([12, 13, 14, 15])
  })

  it('le continuamente entre blocos e retorna silencio em underrun', () => {
    const queue = new InterleavedPcmQueue(20, 8)
    queue.push(new Float32Array([1, 2]))
    queue.push(new Float32Array([3, 4]))

    expect([queue.read(), queue.read(), queue.read(), queue.read(), queue.read()])
      .toEqual([1, 2, 3, 4, 0])
    expect(queue.length).toBe(0)
  })
})

describe('AdaptiveStereoPcmPlayout', () => {
  it('faz pre-buffer e preserva os canais durante a reproducao', () => {
    const playout = new AdaptiveStereoPcmPlayout(4, 4, 16)
    const left = new Float32Array(2)
    const right = new Float32Array(2)
    playout.push(new Float32Array([1, -1, 2, -2]))
    expect(playout.render(left, right).buffering).toBe(true)
    expect([...left]).toEqual([0, 0])

    playout.push(new Float32Array([3, -3, 4, -4, 5, -5]))
    expect(playout.render(left, right).buffering).toBe(false)
    expect(left[0]).toBeCloseTo(1)
    expect(left[1]).toBeCloseTo(2, 2)
    expect(right[0]).toBeCloseTo(-1)
    expect(right[1]).toBeCloseTo(-2, 2)
  })

  it('corrige deriva por vinte minutos logicos sem acumular atraso', () => {
    const playout = new AdaptiveStereoPcmPlayout(60, 60, 200)
    const left = new Float32Array(20)
    const right = new Float32Array(20)
    let sourceFrames = 0
    let expectedSourceFrames = 0

    // 60 mil blocos de 20 ms representam vinte minutos a 1 kHz. A fonte
    // alterna entre relogios 0,1% mais rapido/lento e o playout deve convergir.
    for (let block = 0; block < 60_000; block += 1) {
      expectedSourceFrames += block < 30_000 ? 20.02 : 19.98
      const frames = Math.floor(expectedSourceFrames) - sourceFrames
      sourceFrames += frames
      const chunk = new Float32Array(frames * 2)
      for (let frame = 0; frame < frames; frame += 1) {
        chunk[frame * 2] = 0.25
        chunk[frame * 2 + 1] = -0.25
      }
      playout.push(chunk)
      playout.render(left, right)
    }

    const stats = playout.stats()
    expect(stats.bufferedFrames).toBeLessThan(120)
    expect(stats.droppedFrames).toBe(0)
    expect(stats.underruns).toBeLessThanOrEqual(1)
  })

  it('rebufferiza uma lacuna sem deixar o atraso crescer depois', () => {
    const playout = new AdaptiveStereoPcmPlayout(60, 60, 200)
    const output = new Float32Array(20)
    playout.push(new Float32Array(80 * 2).fill(0.2))
    for (let index = 0; index < 6; index += 1) playout.render(output)
    expect(playout.stats().buffering).toBe(true)

    playout.push(new Float32Array(100 * 2).fill(0.2))
    for (let index = 0; index < 20; index += 1) {
      playout.push(new Float32Array(20 * 2).fill(0.2))
      playout.render(output)
    }
    expect(playout.stats().bufferedFrames).toBeLessThan(120)
  })
})
