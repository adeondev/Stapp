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

  constructor(private readonly source = notificationSoundUrl) {}

  play(): void {
    try {
      const audio = this.audio ?? new Audio(this.source)
      this.audio = audio
      audio.preload = 'auto'
      audio.volume = 0.65
      audio.currentTime = 0
      void audio.play().catch(() => {})
    } catch {
      // O navegador pode bloquear audio antes da primeira interacao do usuario.
    }
  }
}

export const notificationSound = new NotificationSound()
