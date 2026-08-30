import { useState } from 'react'
import type { SocialMember, UserId } from '../protocol'
import './members.css'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  onMessage(userId: UserId): void
  onAction(action: 'request' | 'accept' | 'cancel' | 'block' | 'unblock', userId: UserId): void
}

export function MembersPanel({ members, onlineIds, onMessage, onAction }: Props) {
  const [selected, setSelected] = useState<UserId | null>(null)
  const ordered = [...members].sort((a, b) => Number(onlineIds.has(b.user_id)) - Number(onlineIds.has(a.user_id)))
  return (
    <aside className="members" aria-label="Membros do servidor">
      <h2>Membros — {members.length + 1}</h2>
      {ordered.map((member) => {
        const online = onlineIds.has(member.user_id)
        return (
          <div className="members__entry" key={member.user_id}>
            <button className="members__row" type="button" aria-expanded={selected === member.user_id}
              onClick={() => setSelected((current) => current === member.user_id ? null : member.user_id)}>
              <span className={`members__avatar ${online ? 'is-online' : ''}`}>{member.username.slice(0, 1).toUpperCase()}</span>
              <span className="members__name"><strong>{member.username}</strong><small>{online ? 'Online' : 'Offline'}</small></span>
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
