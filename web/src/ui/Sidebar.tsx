import stappLogo from '../../assets/imgs/svg/stapp_logo.svg'
import type { ConnectionStatus } from '../net/connection'
import type { PeerId, UserId } from '../protocol'
import { directList, peersInChannel, type StappState } from '../store'
import { IconHash, IconMicOff, IconSpeaker, IconUsers } from './Icons'
import './sidebar.css'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'conectando', online: 'online', reconnecting: 'reconectando', offline: 'desconectado',
}

export type View =
  | { kind: 'home' }
  | { kind: 'channel'; id: string }
  | { kind: 'direct'; userId: UserId }

interface Props {
  state: StappState
  status: ConnectionStatus
  view: View | null
  onSelectHome(): void
  onSelectChannel(id: string): void
  onSelectDirect(userId: UserId): void
  callChannel: string | null
  onJoinCall(id: string): void
  speaking: ReadonlySet<PeerId>
  footer: React.ReactNode
}

export function Sidebar({ state, status, view, onSelectHome, onSelectChannel, onSelectDirect,
  callChannel, onJoinCall, speaking, footer }: Props) {
  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <div className="sidebar__brand">
          <img src={stappLogo} alt="" className="sidebar__logo" aria-hidden="true" />
          <span className="sidebar__server">{state.serverName}</span>
        </div>
        <span className={`sidebar__status sidebar__status--${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      <nav className="sidebar__scroll" aria-label="Navegação do servidor">
        <button className={`sidebar__item sidebar__friends ${view?.kind === 'home' ? 'is-active' : ''}`}
          onClick={onSelectHome}><IconUsers /><span className="sidebar__item-name">Amigos</span></button>

        <h2 className="sidebar__section">Canais de texto</h2>
        {state.channels.filter((channel) => channel.kind === 'text').map((channel) => (
          <button key={channel.id} className={`sidebar__item ${view?.kind === 'channel' && view.id === channel.id ? 'is-active' : ''}`}
            onClick={() => onSelectChannel(channel.id)}>
            <IconHash /><span className="sidebar__item-name">{channel.name}</span>
          </button>
        ))}

        <h2 className="sidebar__section">Canais de voz</h2>
        {state.channels.filter((channel) => channel.kind === 'voice').map((channel) => {
          const peers = peersInChannel(state, channel.id)
          return <div key={channel.id}>
            <button className={`sidebar__item ${channel.id === callChannel ? 'is-active' : ''}`}
              onClick={() => onJoinCall(channel.id)} disabled={channel.id === callChannel}>
              <IconSpeaker /><span className="sidebar__item-name">{channel.name}</span>
              {peers.length > 0 && <span className="sidebar__count">{peers.length}</span>}
            </button>
            {peers.map((peer) => (
              <div key={peer.peer_id} className={`sidebar__peer ${speaking.has(peer.peer_id) ? 'is-speaking' : ''}`}>
                <span className="sidebar__avatar">{peer.username.slice(0, 1).toUpperCase()}</span>
                <span className="sidebar__peer-name">{peer.username}</span>
                {(peer.muted || peer.deafened) && <span className="sidebar__peer-muted"><IconMicOff size={13} /></span>}
              </div>
            ))}
          </div>
        })}

        <h2 className="sidebar__section">Mensagens diretas</h2>
        {directList(state).map((conversation) => {
          const online = state.users.some((user) => user.user_id === conversation.user_id)
          const open = view?.kind === 'direct' && view.userId === conversation.user_id
          return <button key={conversation.user_id} className={`sidebar__item ${open ? 'is-active' : ''}`}
            onClick={() => onSelectDirect(conversation.user_id)}>
            <span className={`sidebar__dm-avatar ${online ? 'is-online' : ''}`}>{conversation.username.slice(0, 1).toUpperCase()}</span>
            <span className="sidebar__item-name">{conversation.username}</span>
            {conversation.unread > 0 && <span className="sidebar__badge">{conversation.unread}</span>}
          </button>
        })}
        {directList(state).length === 0 && <p className="sidebar__empty">Suas conversas aparecerão aqui.</p>}
      </nav>
      {footer}
    </aside>
  )
}
