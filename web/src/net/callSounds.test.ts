// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallSounds } from './callSounds'

describe('CallSounds', () => {
  let playMock: ReturnType<typeof vi.fn>
  let pauseMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    playMock = vi.fn(async () => {})
    pauseMock = vi.fn()

    // Mock do construtor Audio
    class MockAudio {
      src = ''
      preload = 'none'
      loop = false
      volume = 1
      currentTime = 0
      play = playMock
      pause = pauseMock
      constructor(src?: string) {
        if (src) this.src = src
      }
    }
    vi.stubGlobal('Audio', MockAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('gerencia volume e persiste no localStorage', () => {
    const sounds = new CallSounds()
    expect(sounds.getVolume()).toBe(0.65)

    sounds.setVolume(0.85)
    expect(sounds.getVolume()).toBe(0.85)
    expect(localStorage.getItem('stapp:sound_volume')).toBe('0.85')

    // Clamping
    sounds.setVolume(1.5)
    expect(sounds.getVolume()).toBe(1)
    sounds.setVolume(-0.2)
    expect(sounds.getVolume()).toBe(0)
  })

  it('inicia e para reprodução de calling em loop', () => {
    const sounds = new CallSounds()
    sounds.playCalling()

    expect(playMock).toHaveBeenCalledTimes(1)

    sounds.stopLoop()
    expect(pauseMock).toHaveBeenCalledTimes(1)
  })

  it('inicia e para reprodução de ringtone em loop', () => {
    const sounds = new CallSounds()
    sounds.playRingtone()

    expect(playMock).toHaveBeenCalledTimes(1)

    sounds.stopLoop()
    expect(pauseMock).toHaveBeenCalledTimes(1)
  })

  it('aplica debounce de 1 segundo para playJoin e playLeave', () => {
    const sounds = new CallSounds()

    sounds.playJoin()
    sounds.playJoin()
    sounds.playJoin()

    // Apenas 1 chamada permitida dentro da janela de debounce
    expect(playMock).toHaveBeenCalledTimes(1)

    sounds.playLeave()
    sounds.playLeave()
    expect(playMock).toHaveBeenCalledTimes(2) // 1 de join + 1 de leave
  })

  it('silencia sons de join e leave quando deafened for verdadeiro', () => {
    const sounds = new CallSounds()
    sounds.setDeafened(true)
    expect(sounds.isDeafened()).toBe(true)

    sounds.playJoin()
    sounds.playLeave()

    expect(playMock).not.toHaveBeenCalled()
  })

  it('stopAll para loops e audios ativos', () => {
    const sounds = new CallSounds()
    sounds.playCalling()
    sounds.playJoin()

    sounds.stopAll()
    expect(pauseMock).toHaveBeenCalled()
  })
})
