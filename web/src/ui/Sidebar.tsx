import type { ConnectionStatus } from '../net/connection'
import type { PeerId } from '../protocol'
import { peersInChannel, type StappState } from '../store'
import { IconHash, IconMicOff, IconSpeaker } from './Icons'
import './sidebar.css'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'conectando',
  online: 'online',
  reconnecting: 'reconectando',
  offline: 'desconectado',
}

interface Props {
  state: StappState
  status: ConnectionStatus
  activeChannel: string | null
  onSelectChannel(id: string): void
  /** Canal de voz em que estamos, se estivermos em algum. */
  callChannel: string | null
  onJoinCall(id: string): void
  speaking: ReadonlySet<PeerId>
  footer: React.ReactNode
}

export function Sidebar({
  state,
  status,
  activeChannel,
  onSelectChannel,
  callChannel,
  onJoinCall,
  speaking,
  footer,
}: Props) {
  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <span className="sidebar__server">{state.serverName}</span>
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
              className={`sidebar__item ${channel.id === activeChannel ? 'is-active' : ''}`}
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
                    key={peer.id}
                    className={`sidebar__peer ${speaking.has(peer.id) ? 'is-speaking' : ''}`}
                  >
                    <span className="sidebar__avatar">{peer.nick.slice(0, 1).toUpperCase()}</span>
                    <span className="sidebar__peer-name">{peer.nick}</span>
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

        <h2 className="sidebar__section">online — {state.users.length}</h2>
        {state.users.map((user) => (
          <div key={user.id} className="sidebar__user">
            <span className="sidebar__dot" />
            <span className="sidebar__peer-name">
              {user.nick}
              {user.id === state.selfId && <span className="sidebar__you"> voce</span>}
            </span>
          </div>
        ))}
      </nav>

      {footer}
    </aside>
  )
}
