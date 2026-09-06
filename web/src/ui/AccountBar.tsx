import { Avatar, useProfile } from './Avatar'
import { IconHeadphones, IconHeadphonesOff, IconMic, IconMicOff, IconSettings } from './Icons'
import { useUserMenu } from './UserMenu'
import { useVoiceStore } from '../stores'
import './accountbar.css'

interface Props {
  userId: string | null
  username: string
  muted?: boolean
  deafened?: boolean
  onToggleMute?(): void
  onToggleDeafen?(): void
  onOpenVoiceSettings?(): void
  onOpenSettings?(): void
  onOpenProfile(): void
}

export function AccountBar({
  userId,
  username,
  muted: propMuted,
  deafened: propDeafened,
  onToggleMute: propToggleMute,
  onToggleDeafen: propToggleDeafen,
  onOpenVoiceSettings,
  onOpenSettings,
  onOpenProfile,
}: Props) {
  const storeMuted = useVoiceStore((s) => s.muted)
  const storeDeafened = useVoiceStore((s) => s.deafened)
  const storeToggleMute = useVoiceStore((s) => s.toggleMute)
  const storeToggleDeafen = useVoiceStore((s) => s.toggleDeafen)

  const muted = propMuted ?? storeMuted
  const deafened = propDeafened ?? storeDeafened
  const onToggleMute = propToggleMute ?? storeToggleMute
  const onToggleDeafen = propToggleDeafen ?? storeToggleDeafen

  const perfil = useProfile(userId, username)
  const userMenu = useUserMenu()
  // Ensurdecer tambem corta o microfone, entao o botao de mudo reflete os dois.
  const micOff = muted || deafened
  const mostrarHandle = perfil.display_name !== username

  return (
    <div className="accountbar">
      <button className="accountbar__identity" type="button" onClick={onOpenProfile}
        onContextMenu={(event) => userMenu.open(event, { userId: userId ?? undefined, name: username })}
        title="Editar seu perfil">
        <Avatar userId={userId} className="accountbar__avatar" fallbackName={username} />
        <span className="accountbar__text">
          <span className="accountbar__username">{perfil.display_name}</span>
          {mostrarHandle && <span className="accountbar__handle">@{username}</span>}
        </span>
      </button>

      <div className="accountbar__actions">
        <button className={`accountbar__btn ${micOff ? 'is-off' : ''}`} type="button"
          onClick={onToggleMute} disabled={deafened}
          title={micOff ? 'Ligar microfone' : 'Desligar microfone'}
          aria-label={micOff ? 'Ligar microfone' : 'Desligar microfone'}>
          {micOff ? <IconMicOff size={18} /> : <IconMic size={18} />}
        </button>

        <button className={`accountbar__btn ${deafened ? 'is-off' : ''}`} type="button"
          onClick={onToggleDeafen}
          title={deafened ? 'Voltar a ouvir' : 'Não ouvir ninguém'}
          aria-label={deafened ? 'Voltar a ouvir' : 'Não ouvir ninguém'}>
          {deafened ? <IconHeadphonesOff size={18} /> : <IconHeadphones size={18} />}
        </button>

        <button className="accountbar__btn" type="button" onClick={onOpenSettings ?? onOpenVoiceSettings}
          title="Configurações" aria-label="Configurações">
          <IconSettings size={18} className="accountbar__gear" />
        </button>
      </div>
    </div>
  )
}
