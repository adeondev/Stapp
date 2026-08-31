// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browserAudioExclusionIsSafe, startBrowserScreenCapture } from './screenCapture'

describe('captura web segura', () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('aceita somente probe baixo com restrictOwnAudio confirmado', () => {
    expect(browserAudioExclusionIsSafe(true, true, 0.01, 0.0005)).toBe(true)
    expect(browserAudioExclusionIsSafe(false, true, 0.01, 0)).toBe(false)
    expect(browserAudioExclusionIsSafe(true, false, 0.01, 0)).toBe(false)
    expect(browserAudioExclusionIsSafe(true, true, 0.01, 0.004)).toBe(false)
  })

  it('mantem o video e encerra somente o audio quando a constraint falha', async () => {
    const videoTrack = {
      kind: 'video', contentHint: '', stop: vi.fn(), addEventListener: vi.fn(),
      getSettings: vi.fn(() => ({ displaySurface: 'monitor' })),
    }
    const audioTrack = {
      kind: 'audio', contentHint: '', stop: vi.fn(),
      applyConstraints: vi.fn(async () => { throw new Error('constraint recusada') }),
      getSettings: vi.fn(() => ({ restrictOwnAudio: false })),
    }
    const stream = {
      id: 'display-stream',
      getVideoTracks: () => [videoTrack], getAudioTracks: () => [audioTrack],
      getTracks: () => [videoTrack], removeTrack: vi.fn(),
    }
    const getDisplayMedia = vi.fn(async () => stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia, getSupportedConstraints: () => ({ restrictOwnAudio: true }) },
    })

    const capture = await startBrowserScreenCapture({
      maxWidth: 1920, maxHeight: 1080, fps: 30, includeAudio: true, contentHint: 'detail',
    })

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({
        restrictOwnAudio: true, channelCount: { ideal: 2 }, sampleRate: { ideal: 48_000 },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      }),
      systemAudio: 'include', windowAudio: 'window',
    }))
    expect(audioTrack.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({
      restrictOwnAudio: { exact: true },
    }))
    expect(capture.track).toBe(videoTrack)
    expect(capture.audioTrack).toBeUndefined()
    expect(capture.hasAudio).toBe(false)
    expect(stream.removeTrack).toHaveBeenCalledWith(audioTrack)
    expect(audioTrack.stop).toHaveBeenCalledOnce()
  })
})
