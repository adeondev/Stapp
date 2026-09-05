import callCallingUrl from '../../assets/audio/call_calling.wav'
import callRingtoneUrl from '../../assets/audio/call_ringtone.wav'
import callJoinUrl from '../../assets/audio/call_join.wav'
import callLeaveUrl from '../../assets/audio/call_leave.wav'

export type CallCue = 'calling' | 'ringtone' | 'join' | 'leave'

const DEBOUNCE_MS = 1000

export class CallSounds {
  private baseVolume = 0.65
  private deafened = false

  private activeLoop: { cue: 'calling' | 'ringtone'; audio: HTMLAudioElement } | null = null
  private joinAudio: HTMLAudioElement | null = null
  private leaveAudio: HTMLAudioElement | null = null

  private lastJoinTime = 0
  private lastLeaveTime = 0

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('stapp:sound_volume')
      if (saved) {
        const parsed = parseFloat(saved)
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.baseVolume = parsed
        }
      }
    }
  }

  setVolume(vol: number): void {
    this.baseVolume = Math.min(1, Math.max(0, vol))
    if (typeof window !== 'undefined') {
      localStorage.setItem('stapp:sound_volume', this.baseVolume.toString())
    }
    this.updateActiveAudioVolumes()
  }

  getVolume(): number {
    return this.baseVolume
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened
    this.updateActiveAudioVolumes()
  }

  isDeafened(): boolean {
    return this.deafened
  }

  /**
   * Toca o efeito de discagem de chamada sainte em loop contínuo.
   */
  playCalling(): void {
    this.startLoop('calling', callCallingUrl)
  }

  /**
   * Toca o ringtone de chamada entrante em loop contínuo.
   */
  playRingtone(): void {
    this.startLoop('ringtone', callRingtoneUrl)
  }

  /**
   * Interrompe qualquer som em loop ativo (calling ou ringtone).
   */
  stopLoop(): void {
    if (!this.activeLoop) return
    try {
      this.activeLoop.audio.pause()
      this.activeLoop.audio.currentTime = 0
    } catch {
      // Ignora erros de reprodução
    }
    this.activeLoop = null
  }

  /**
   * Toca o som de entrada na chamada (com debounce de 1 segundo e respeito a deafened).
   */
  playJoin(): void {
    if (this.deafened) return
    const now = Date.now()
    if (now - this.lastJoinTime < DEBOUNCE_MS) return
    this.lastJoinTime = now

    this.playOneShot(callJoinUrl, (audio) => {
      this.joinAudio = audio
    })
  }

  /**
   * Toca o som de saída da chamada (com debounce de 1 segundo e respeito a deafened).
   */
  playLeave(): void {
    if (this.deafened) return
    const now = Date.now()
    if (now - this.lastLeaveTime < DEBOUNCE_MS) return
    this.lastLeaveTime = now

    this.playOneShot(callLeaveUrl, (audio) => {
      this.leaveAudio = audio
    })
  }

  /**
   * Interrompe todos os sons (loops e one-shots ativos).
   */
  stopAll(): void {
    this.stopLoop()
    if (this.joinAudio) {
      try {
        this.joinAudio.pause()
        this.joinAudio.currentTime = 0
      } catch {}
      this.joinAudio = null
    }
    if (this.leaveAudio) {
      try {
        this.leaveAudio.pause()
        this.leaveAudio.currentTime = 0
      } catch {}
      this.leaveAudio = null
    }
  }

  private effectiveVolume(): number {
    if (this.deafened) return 0
    return this.baseVolume
  }

  private updateActiveAudioVolumes(): void {
    const vol = this.effectiveVolume()
    if (this.activeLoop?.audio) {
      this.activeLoop.audio.volume = vol
    }
    if (this.joinAudio) {
      this.joinAudio.volume = vol
    }
    if (this.leaveAudio) {
      this.leaveAudio.volume = vol
    }
  }

  private startLoop(cue: 'calling' | 'ringtone', src: string): void {
    this.stopLoop()

    if (typeof Audio === 'undefined') return
    try {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.loop = true
      audio.volume = this.effectiveVolume()
      audio.currentTime = 0
      this.activeLoop = { cue, audio }
      void audio.play().catch(() => {})
    } catch {
      // Ignora erro em ambientes sem suporte ou sem interação prévia
    }
  }

  private playOneShot(src: string, onStore?: (audio: HTMLAudioElement) => void): void {
    if (typeof Audio === 'undefined') return
    try {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.loop = false
      audio.volume = this.effectiveVolume()
      audio.currentTime = 0
      onStore?.(audio)
      void audio.play().catch(() => {})
    } catch {
      // Ignora erro em ambientes sem suporte
    }
  }
}

export const callSounds = new CallSounds()
