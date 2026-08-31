import { Avatar, ProfileName } from './Avatar'
import { useState } from 'react'
import type { SocialMember, UserId } from '../protocol'
import { useUserMenu } from './UserMenu'
import './members.css'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  selfUserId: UserId | null
  selfUsername: string
  onEditSelf(): void
  onMessage(userId: UserId): void
  onAction(action: 'request' | 'accept' | 'cancel' | 'block' | 'unblock', userId: UserId): void
}

export function MembersPanel({ members, onlineIds, selfUserId, selfUsername, onEditSelf, onMessage, onAction }: Props) {
  const userMenu = useUserMenu()
  const [selected, setSelected] = useState<UserId | null>(null)
  const ordered = members
    .filter((member) => member.user_id !== selfUserId)
    .sort((a, b) => Number(onlineIds.has(b.user_id)) - Number(onlineIds.has(a.user_id)))
  const count = ordered.length + (selfUserId ? 1 : 0)
  return (
    <aside className="members" aria-label="Membros do servidor">
      <h2>Membros — {count}</h2>
      {selfUserId && (
        <div className="members__entry members__entry--self">
          <button className="members__row" type="button" onClick={onEditSelf}
            onContextMenu={(event) => userMenu.open(event, { userId: selfUserId, name: selfUsername })}>
            <Avatar userId={selfUserId} className="members__avatar is-online" fallbackName={selfUsername} />
            <span className="members__name">
              <strong><ProfileName userId={selfUserId} fallbackName={selfUsername} /></strong>
              <small>Você · Online</small>
            </span>
          </button>
        </div>
      )}
      {ordered.map((member) => {
        const online = onlineIds.has(member.user_id)
        return (
          <div className="members__entry" key={member.user_id}>
            <button className="members__row" type="button" aria-expanded={selected === member.user_id}
              onClick={() => setSelected((current) => current === member.user_id ? null : member.user_id)}
              onContextMenu={(event) => userMenu.open(event, { userId: member.user_id, name: member.username })}>
              <Avatar userId={member.user_id} className={`members__avatar ${online ? 'is-online' : ''}`} fallbackName={member.username} />
              <span className="members__name"><strong><ProfileName userId={member.user_id} fallbackName={member.username} /></strong><small>{online ? 'Online' : 'Offline'}</small></span>
            </button>
            {selected === member.user_id && (
              <div className="members__profile">
                {member.can_start_dm && <button type="button" onClick={() => onMessage(member.user_id)}>Mensagem</button>}
                {member.relationship === 'none' && <button type="button" onClick={() => onAction('request', member.user_id)}>Adicionar amigo</button>}
                {member.relationship === 'incoming' && <button type="button" onClick={() => onAction('accept', member.user_id)}>Aceitar pedido</button>}
                {member.relationship === 'outgoing' && <button type="button" onClick={() => onAction('cancel', member.user_id)}>Cancelar pedido</button>}
                {member.relationship === 'blocked'
                  ? <button type="button" onClick={() => onAction('unblock', member.user_id)}>Desbloquear</button>
                  : <button className="is-danger" type="button" onClick={() => onAction('block', member.user_id)}>Bloquear</button>}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
