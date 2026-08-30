import { Avatar, ProfileName } from './Avatar'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SocialMember, UserId } from '../protocol'
import { IconAt, IconCheck, IconUsers, IconX } from './Icons'
import './friends.css'

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add'
type ListTab = Exclude<Tab, 'add'>
type SocialAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  onOpenDirect(userId: UserId): void
  onAction(action: SocialAction, userId: UserId): void
}

export function FriendsHome({ members, onlineIds, onOpenDirect, onAction }: Props) {
  const [tab, setTab] = useState<Tab>('online')
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const incoming = members.filter((member) => member.relationship === 'incoming')
  const outgoing = members.filter((member) => member.relationship === 'outgoing')
  const shown = useMemo(() => members.filter((member) => {
    if (tab === 'online') return member.relationship === 'friend' && onlineIds.has(member.user_id)
    if (tab === 'all') return member.relationship === 'friend'
    if (tab === 'pending') return member.relationship === 'incoming' || member.relationship === 'outgoing'
    if (tab === 'blocked') return member.relationship === 'blocked'
    return false
  }), [members, onlineIds, tab])

  useLayoutEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const update = () => {
      const active = tabs.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(tabs)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [tab])

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
        <div ref={tabsRef} className="friends__tabs" role="tablist" aria-label="Filtros de amizade">
          <span className={`friends__tab-indicator ${indicator.width > 0 ? 'is-ready' : ''}`}
            style={{ width: indicator.width, translate: `${indicator.left}px 0` }} aria-hidden="true" />
          {(['online', 'all', 'pending', 'blocked'] as ListTab[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value}
              className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>
              {{ online: 'Online', all: 'Todos', pending: 'Pendentes', blocked: 'Bloqueados' }[value]}
              {value === 'pending' && incoming.length > 0 && <span className="friends__tab-count"
                aria-label={`${incoming.length} pedidos recebidos`}>{incoming.length > 99 ? '99+' : incoming.length}</span>}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={tab === 'add'}
            className={`friends__add-tab ${tab === 'add' ? 'is-active' : ''}`}
            onClick={() => setTab('add')}>Adicionar amigo</button>
        </div>
      </header>

      <div className="friends__body">
        {tab === 'add' && (
          <div className="friends__view" key="add">
            <form className="friends__add" onSubmit={addFriend}>
              <div><strong>Adicionar amigo</strong><p>Use o username exato desta comunidade.</p></div>
              <div className="friends__add-row">
                <input value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Username" aria-label="Username para adicionar" />
                <button type="submit" disabled={!query.trim()}>Enviar pedido</button>
              </div>
              {feedback && <p className="friends__feedback" role="status">{feedback}</p>}
            </form>
          </div>
        )}

        {tab !== 'add' && (
          <div className="friends__view" key={tab}>
            {tab === 'pending' ? (
              <PendingRequests incoming={incoming} outgoing={outgoing} onlineIds={onlineIds}
                onAction={onAction} />
            ) : (
              <>
                <h2>{shown.length} pessoas</h2>
                <div className="friends__list">
                  {shown.map((member) => (
                    <FriendRow key={member.user_id} member={member} online={onlineIds.has(member.user_id)}
                      onOpenDirect={onOpenDirect} onAction={onAction} />
                  ))}
                  {shown.length === 0 && <div className="friends__empty">Nada por aqui ainda.</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

interface PendingRequestsProps {
  incoming: SocialMember[]
  outgoing: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  onAction(action: SocialAction, userId: UserId): void
}

function PendingRequests({ incoming, outgoing, onlineIds, onAction }: PendingRequestsProps) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return <div className="friends__empty">Nenhum pedido pendente.</div>
  }
  return (
    <>
      {incoming.length > 0 && (
        <section className="friends__request-group" aria-labelledby="incoming-requests">
          <h2 id="incoming-requests">Recebidos — {incoming.length}</h2>
          <div className="friends__list">
            {incoming.map((member) => <FriendRow key={member.user_id} member={member}
              online={onlineIds.has(member.user_id)} request="incoming" onAction={onAction} />)}
          </div>
        </section>
      )}
      {outgoing.length > 0 && (
        <section className="friends__request-group" aria-labelledby="outgoing-requests">
          <h2 id="outgoing-requests">Enviados — {outgoing.length}</h2>
          <div className="friends__list">
            {outgoing.map((member) => <FriendRow key={member.user_id} member={member}
              online={onlineIds.has(member.user_id)} request="outgoing" onAction={onAction} />)}
          </div>
        </section>
      )}
    </>
  )
}

interface FriendRowProps {
  member: SocialMember
  online: boolean
  request?: 'incoming' | 'outgoing'
  onOpenDirect?(userId: UserId): void
  onAction(action: SocialAction, userId: UserId): void
}

function FriendRow({ member, online, request, onOpenDirect, onAction }: FriendRowProps) {
  const detail = request === 'incoming' ? 'Quer adicionar você'
    : request === 'outgoing' ? 'Pedido enviado' : online ? 'Online' : 'Offline'
  return (
    <article className="friends__row">
      <Avatar userId={member.user_id} className="friends__avatar" fallbackName={member.username} />
      <span className="friends__person"><strong><ProfileName userId={member.user_id} fallbackName={member.username} /></strong><small>{detail}</small></span>
      <div className="friends__actions">
        {request === 'incoming' && (
          <>
            <button className="friends__icon-action is-accept" type="button"
              aria-label={`Aceitar pedido de ${member.username}`} title="Aceitar pedido"
              onClick={() => onAction('accept', member.user_id)}><IconCheck size={15} /></button>
            <button className="friends__icon-action is-cancel" type="button"
              aria-label={`Recusar pedido de ${member.username}`} title="Recusar pedido"
              onClick={() => onAction('decline', member.user_id)}><IconX size={15} /></button>
          </>
        )}
        {request === 'outgoing' && (
          <button className="friends__icon-action is-cancel" type="button"
            aria-label={`Cancelar pedido para ${member.username}`} title="Cancelar pedido"
            onClick={() => onAction('cancel', member.user_id)}><IconX size={15} /></button>
        )}
        {!request && (
          <>
            {member.can_start_dm && onOpenDirect && <button type="button" onClick={() => onOpenDirect(member.user_id)} title="Mensagem"><IconAt /></button>}
            {member.relationship === 'friend' && <button type="button" onClick={() => onAction('remove', member.user_id)}>Remover</button>}
            {member.relationship === 'blocked'
              ? <button type="button" onClick={() => onAction('unblock', member.user_id)}>Desbloquear</button>
              : <button type="button" className="is-danger" onClick={() => onAction('block', member.user_id)}>Bloquear</button>}
          </>
        )}
      </div>
    </article>
  )
}

export type { SocialAction }
