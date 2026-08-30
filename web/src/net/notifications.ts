import notificationSoundUrl from '../../assets/audio/notification_sound.mp3'
import type { SocialMember, UserId } from '../protocol'

export class IncomingRequestTracker {
  private relationships: Map<UserId, SocialMember['relationship']> | null = null

  update(members: readonly SocialMember[]): UserId[] {
    const previous = this.relationships
    this.relationships = new Map(members.map((member) => [member.user_id, member.relationship]))
    if (!previous) return []
    return members
      .filter((member) => member.relationship === 'incoming' && previous.get(member.user_id) !== 'incoming')
      .map((member) => member.user_id)
  }
}

export class NotificationSound {
  private audio: HTMLAudioElement | null = null
  private ringing: ReturnType<typeof setInterval> | null = null
  private attenuation = 0
  private attenuated = false

  constructor(private readonly source = notificationSoundUrl) {}

  play(): void {
    try {
      const audio = this.audio ?? new Audio(this.source)
      this.audio = audio
      audio.preload = 'auto'
      audio.volume = this.volume()
      audio.currentTime = 0
      void audio.play().catch(() => {})
    } catch {
      // O navegador pode bloquear audio antes da primeira interacao do usuario.
    }
  }

  startRinging(): void {
    if (this.ringing) return
    this.play()
    this.ringing = setInterval(() => this.play(), 2600)
  }

  stopRinging(): void {
    if (this.ringing) clearInterval(this.ringing)
    this.ringing = null
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }

  setAttenuated(active: boolean, percentage: number): void {
    this.attenuated = active
    this.attenuation = Math.min(100, Math.max(0, percentage))
    if (this.audio) this.audio.volume = this.volume()
  }

  private volume() {
    return 0.65 * (this.attenuated ? 1 - this.attenuation / 100 : 1)
  }
}

export const notificationSound = new NotificationSound()
