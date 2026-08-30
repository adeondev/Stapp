import { useMemo, useState } from 'react'
import type { SocialMember, UserId } from '../protocol'
import { IconAt, IconUsers } from './Icons'
import './friends.css'

type Tab = 'online' | 'all' | 'pending' | 'blocked'
type SocialAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  allowMemberDms: boolean
  onPrivacyChange(value: boolean): void
  onOpenDirect(userId: UserId): void
  onAction(action: SocialAction, userId: UserId): void
}

export function FriendsHome({ members, onlineIds, allowMemberDms, onPrivacyChange, onOpenDirect, onAction }: Props) {
  const [tab, setTab] = useState<Tab>('online')
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const shown = useMemo(() => members.filter((member) => {
    if (tab === 'online') return member.relationship === 'friend' && onlineIds.has(member.user_id)
    if (tab === 'all') return member.relationship === 'friend'
    if (tab === 'pending') return member.relationship === 'incoming' || member.relationship === 'outgoing'
    return member.relationship === 'blocked'
  }), [members, onlineIds, tab])

  function addFriend(event: React.FormEvent) {
    event.preventDefault()
    const target = members.find((member) => member.username.localeCompare(query.trim(), 'pt-BR', { sensitivity: 'base' }) === 0)
    if (!target) return setFeedback('Nenhum membro encontrado com esse username.')
    if (target.relationship !== 'none') return setFeedback('Essa relação já possui um estado ativo.')
    onAction('request', target.user_id)
    setFeedback(`Pedido enviado para ${target.username}.`)
    setQuery('')
  }

  return (
    <section className="friends">
      <header className="friends__head">
        <div className="friends__title"><IconUsers size={19} /><strong>Amigos</strong></div>
        <div className="friends__tabs" role="tablist" aria-label="Filtros de amizade">
          {(['online', 'all', 'pending', 'blocked'] as Tab[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value}
              className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>
              {{ online: 'Online', all: 'Todos', pending: 'Pendentes', blocked: 'Bloqueados' }[value]}
            </button>
          ))}
        </div>
      </header>

      <div className="friends__body">
        <form className="friends__add" onSubmit={addFriend}>
          <div><strong>Adicionar amigo</strong><p>Use o username exato desta comunidade.</p></div>
          <div className="friends__add-row">
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Username" aria-label="Username para adicionar" />
            <button type="submit" disabled={!query.trim()}>Enviar pedido</button>
          </div>
          {feedback && <p className="friends__feedback" role="status">{feedback}</p>}
        </form>

        <label className="friends__privacy">
          <span><strong>Mensagens de membros</strong><small>Permitir que membros iniciem uma conversa sem amizade.</small></span>
          <input type="checkbox" checked={allowMemberDms} onChange={(event) => onPrivacyChange(event.target.checked)} />
        </label>

        <h2>{shown.length} {tab === 'pending' ? 'pedidos' : 'pessoas'}</h2>
        <div className="friends__list">
          {shown.map((member) => (
            <article className="friends__row" key={member.user_id}>
              <span className="friends__avatar">{member.username.slice(0, 1).toUpperCase()}</span>
              <span className="friends__person"><strong>{member.username}</strong><small>{onlineIds.has(member.user_id) ? 'Online' : 'Offline'}</small></span>
              <div className="friends__actions">
                {member.can_start_dm && <button type="button" onClick={() => onOpenDirect(member.user_id)} title="Mensagem"><IconAt /></button>}
                {member.relationship === 'incoming' && <><button type="button" onClick={() => onAction('accept', member.user_id)}>Aceitar</button><button type="button" onClick={() => onAction('decline', member.user_id)}>Recusar</button></>}
                {member.relationship === 'outgoing' && <button type="button" onClick={() => onAction('cancel', member.user_id)}>Cancelar</button>}
                {member.relationship === 'friend' && <button type="button" onClick={() => onAction('remove', member.user_id)}>Remover</button>}
                {member.relationship === 'blocked' ? <button type="button" onClick={() => onAction('unblock', member.user_id)}>Desbloquear</button> : <button type="button" className="is-danger" onClick={() => onAction('block', member.user_id)}>Bloquear</button>}
              </div>
            </article>
          ))}
          {shown.length === 0 && <div className="friends__empty">Nada por aqui ainda.</div>}
        </div>
      </div>
    </section>
  )
}

export type { SocialAction }
