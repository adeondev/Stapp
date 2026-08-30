import { Avatar, useProfile } from './Avatar'
import './accountbar.css'

interface Props {
  userId: string | null
  username: string
  onLogout(): void
  onRemoveServer(): void
  onOpenProfile(): void
}

export function AccountBar({ userId, username, onLogout, onRemoveServer, onOpenProfile }: Props) {
  const perfil = useProfile(userId, username)

  return (
    <div className="accountbar">
      <button className="accountbar__identity" type="button" onClick={onOpenProfile}
        title="editar seu perfil">
        <Avatar userId={userId} className="accountbar__avatar" fallbackName={username} />
        <span className="accountbar__username">{perfil.display_name}</span>
      </button>
      <div className="accountbar__actions">
        <button className="accountbar__logout" type="button" onClick={onLogout}>sair</button>
        <button className="accountbar__remove" type="button" onClick={onRemoveServer} title="Remover servidor">×</button>
      </div>
    </div>
  )
}
