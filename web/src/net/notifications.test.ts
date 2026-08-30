import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocialMember } from '../protocol'
import { IncomingRequestTracker, NotificationSound } from './notifications'

const member = (relationship: SocialMember['relationship']): SocialMember => ({
  user_id: 'user-2', username: 'ana', relationship, can_start_dm: false, has_conversation: false,
})

describe('IncomingRequestTracker', () => {
  it('ignora o snapshot inicial e avisa somente quando um pedido novo chega', () => {
    const tracker = new IncomingRequestTracker()
    expect(tracker.update([member('none')])).toEqual([])
    expect(tracker.update([member('incoming')])).toEqual(['user-2'])
    expect(tracker.update([member('incoming')])).toEqual([])
    expect(tracker.update([member('none')])).toEqual([])
    expect(tracker.update([member('incoming')])).toEqual(['user-2'])
  })

  it('nao repete pedidos que ja existiam ao entrar', () => {
    const tracker = new IncomingRequestTracker()
    expect(tracker.update([member('incoming')])).toEqual([])
  })
})

describe('NotificationSound', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reutiliza o audio local e reinicia antes de tocar', () => {
    const play = vi.fn(() => Promise.resolve())
    const instances: AudioMock[] = []
    class AudioMock {
      preload = ''
      volume = 0
      currentTime = 9
      play = play
      constructor(readonly src: string) { instances.push(this) }
    }
    vi.stubGlobal('Audio', AudioMock)
    const sound = new NotificationSound('/notification.mp3')

    sound.play()
    sound.play()

    expect(instances).toHaveLength(1)
    expect(instances[0].src).toBe('/notification.mp3')
    expect(instances[0].currentTime).toBe(0)
    expect(instances[0].volume).toBe(0.65)
    expect(play).toHaveBeenCalledTimes(2)
  })
})
