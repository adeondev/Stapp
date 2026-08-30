import stappLogo from '../../assets/imgs/svg/stapp_logo.svg'
import type { ConnectionStatus } from '../net/connection'
import type { PeerId, UserId } from '../protocol'
import { directList, peersInChannel, type StappState } from '../store'
import { IconAt, IconHash, IconMicOff, IconSpeaker } from './Icons'
import './sidebar.css'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'conectando',
  online: 'online',
  reconnecting: 'reconectando',
  offline: 'desconectado',
}

/** O que esta aberto na area principal. */
export type View = { kind: 'channel'; id: string } | { kind: 'direct'; userId: UserId }

interface Props {
  state: StappState
  status: ConnectionStatus
  view: View | null
  onSelectChannel(id: string): void
  onSelectDirect(userId: UserId): void
  /** Canal de voz em que estamos, se estivermos em algum. */
  callChannel: string | null
  onJoinCall(id: string): void
  speaking: ReadonlySet<PeerId>
  footer: React.ReactNode
}

export function Sidebar({
  state,
  status,
  view,
  onSelectChannel,
  onSelectDirect,
  callChannel,
  onJoinCall,
  speaking,
  footer,
}: Props) {
  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <div className="sidebar__brand">
          <img src={stappLogo} alt="" className="sidebar__logo" aria-hidden="true" />
          <span className="sidebar__server">{state.serverName}</span>
        </div>
        <span className={`sidebar__status sidebar__status--${status}`}>
          {STATUS_LABEL[status]}
        </span>
      </header>

      <nav className="sidebar__scroll">
        <h2 className="sidebar__section">canais</h2>
        {state.channels
          .filter((channel) => channel.kind === 'text')
          .map((channel) => (
            <button
              key={channel.id}
              className={`sidebar__item ${
                view?.kind === 'channel' && view.id === channel.id ? 'is-active' : ''
              }`}
              onClick={() => onSelectChannel(channel.id)}
            >
              <IconHash />
              <span className="sidebar__item-name">{channel.name}</span>
            </button>
          ))}

        <h2 className="sidebar__section">voz</h2>
        {state.channels
          .filter((channel) => channel.kind === 'voice')
          .map((channel) => {
            const peers = peersInChannel(state, channel.id)
            return (
              <div key={channel.id}>
                <button
                  className={`sidebar__item ${channel.id === callChannel ? 'is-active' : ''}`}
                  onClick={() => onJoinCall(channel.id)}
                  disabled={channel.id === callChannel}
                >
                  <IconSpeaker />
                  <span className="sidebar__item-name">{channel.name}</span>
                  {peers.length > 0 && <span className="sidebar__count">{peers.length}</span>}
                </button>

                {peers.map((peer) => (
                  <div
                    key={peer.peer_id}
                    className={`sidebar__peer ${speaking.has(peer.peer_id) ? 'is-speaking' : ''}`}
                  >
                    <span className="sidebar__avatar">{peer.username.slice(0, 1).toUpperCase()}</span>
                    <span className="sidebar__peer-name">{peer.username}</span>
                    {(peer.muted || peer.deafened) && (
                      <span className="sidebar__peer-muted">
                        <IconMicOff size={13} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

        <h2 className="sidebar__section">diretas</h2>
        {directList(state).map((conversa) => {
          const online = state.users.some((user) => user.user_id === conversa.user_id)
          const aberta = view?.kind === 'direct' && view.userId === conversa.user_id
          return (
            <button
              key={conversa.user_id}
              className={`sidebar__item ${aberta ? 'is-active' : ''}`}
              onClick={() => onSelectDirect(conversa.user_id)}
            >
              <IconAt />
              <span className="sidebar__item-name">{conversa.username}</span>
              {!online && <span className="sidebar__offline">offline</span>}
              {conversa.unread > 0 && (
                <span className="sidebar__badge">{conversa.unread}</span>
              )}
            </button>
          )
        })}

        <h2 className="sidebar__section">online — {state.users.length}</h2>
        {state.users.map((user) => (
          <div key={user.user_id} className="sidebar__user">
            <span className="sidebar__dot" />
            <span className="sidebar__peer-name">
              {user.username}
              {user.user_id === state.selfUserId && <span className="sidebar__you"> voce</span>}
            </span>
          </div>
        ))}
      </nav>

      {footer}
    </aside>
  )
}
