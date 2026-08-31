import { Avatar } from './Avatar'
import stappLogo from '../../assets/imgs/svg/stapp_logo.svg'
import type { ConnectionStatus } from '../net/connection'
import type { PeerId, UserId } from '../protocol'
import { directList, peersInChannel, type StappState } from '../store'
import { IconHash, IconMicOff, IconSpeaker, IconUsers } from './Icons'
import { useUserMenu } from './UserMenu'
import './sidebar.css'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'conectando', online: 'online', reconnecting: 'reconectando', offline: 'desconectado',
}

export type View =
  | { kind: 'home' }
  | { kind: 'channel'; id: string }
  | { kind: 'voice'; id: string }
  | { kind: 'direct'; userId: UserId }

export type SidebarMode = 'home' | 'server'

export function sidebarModeFor(view: View | null): SidebarMode {
  return view?.kind === 'channel' || view?.kind === 'voice' ? 'server' : 'home'
}

interface Props {
  state: StappState
  status: ConnectionStatus
  view: View | null
  mode: SidebarMode
  onSelectHome(): void
  onSelectChannel(id: string): void
  onSelectDirect(userId: UserId): void
  callChannel: string | null
  onJoinCall(id: string): void
  speaking: ReadonlySet<PeerId>
  footer: React.ReactNode
}

export function Sidebar({ state, status, view, mode, onSelectHome, onSelectChannel, onSelectDirect,
  callChannel, onJoinCall, speaking, footer }: Props) {
  const conversations = directList(state)
  const incomingRequests = state.socialMembers.filter((member) => member.relationship === 'incoming').length
  const home = mode === 'home'

  return (
    <aside className={`sidebar sidebar--${mode}`}>
      <header className="sidebar__head">
        {home ? (
          <div className="sidebar__search-label">Encontre ou comece uma conversa</div>
        ) : (
          <>
            <div className="sidebar__brand">
              <img src={stappLogo} alt="" className="sidebar__logo" aria-hidden="true" />
              <span className="sidebar__server">{state.serverName}</span>
            </div>
            <span className={`sidebar__status sidebar__status--${status}`}>{STATUS_LABEL[status]}</span>
          </>
        )}
      </header>

      <nav className="sidebar__scroll" aria-label={home ? 'Amigos e mensagens diretas' : 'Canais do servidor'}>
        {home ? (
          <HomeNavigation state={state} view={view} conversations={conversations}
            incomingRequests={incomingRequests} onSelectHome={onSelectHome} onSelectDirect={onSelectDirect} />
        ) : (
          <ServerNavigation state={state} view={view} callChannel={callChannel}
            speaking={speaking} onSelectChannel={onSelectChannel} onJoinCall={onJoinCall} />
        )}
      </nav>
      {footer}
    </aside>
  )
}

interface HomeNavigationProps {
  state: StappState
  view: View | null
  conversations: ReturnType<typeof directList>
  incomingRequests: number
  onSelectHome(): void
  onSelectDirect(userId: UserId): void
}

function HomeNavigation({ state, view, conversations, incomingRequests, onSelectHome, onSelectDirect }: HomeNavigationProps) {
  const userMenu = useUserMenu()
  return (
    <div className="sidebar__menu">
      <button className={`sidebar__item sidebar__friends ${view?.kind === 'home' ? 'is-active' : ''}`}
        onClick={onSelectHome}><IconUsers /><span className="sidebar__item-name">Amigos</span>
        {incomingRequests > 0 && <span className="sidebar__badge sidebar__badge--requests"
          aria-label={`${incomingRequests} pedidos recebidos`}>{incomingRequests > 99 ? '99+' : incomingRequests}</span>}
      </button>

      <div className="sidebar__divider" aria-hidden="true" />
      <h2 className="sidebar__section">Mensagens Diretas</h2>
      {conversations.map((conversation) => {
        const online = state.users.some((user) => user.user_id === conversation.user_id)
        const open = view?.kind === 'direct' && view.userId === conversation.user_id
        return <button key={conversation.user_id} className={`sidebar__item ${open ? 'is-active' : ''}`}
          aria-label={conversation.username}
          onContextMenu={(event) => userMenu.open(event, { userId: conversation.user_id, name: conversation.username })}
          onClick={() => onSelectDirect(conversation.user_id)}>
          <Avatar userId={conversation.user_id} className={`sidebar__dm-avatar ${online ? 'is-online' : ''}`} fallbackName={conversation.username} />
          <span className="sidebar__item-name">{conversation.username}</span>
          {conversation.unread > 0 && <span className="sidebar__badge">{conversation.unread}</span>}
        </button>
      })}
      {conversations.length === 0 && <p className="sidebar__empty">Suas conversas aparecerão aqui.</p>}
    </div>
  )
}

interface ServerNavigationProps {
  state: StappState
  view: View | null
  callChannel: string | null
  speaking: ReadonlySet<PeerId>
  onSelectChannel(id: string): void
  onJoinCall(id: string): void
}

function ServerNavigation({ state, view, callChannel, speaking, onSelectChannel, onJoinCall }: ServerNavigationProps) {
  const userMenu = useUserMenu()
  return (
    <div className="sidebar__menu">
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
        const isConnected = channel.id === callChannel
        return <div key={channel.id}>
          <button className={`sidebar__item ${isConnected ? 'is-active' : ''}`}
            onClick={() => onJoinCall(channel.id)} title={isConnected ? 'Abrir chamada' : 'Conectar à sala de voz'}>
            <IconSpeaker /><span className="sidebar__item-name">{channel.name}</span>
            {peers.length > 0 && <span className="sidebar__count">{peers.length}</span>}
          </button>
          {peers.map((peer) => (
            <div key={peer.peer_id} className={`sidebar__peer ${speaking.has(peer.peer_id) ? 'is-speaking' : ''}`}
              onContextMenu={(event) => userMenu.open(event, { userId: peer.user_id, name: peer.username })}>
              <Avatar userId={peer.user_id} className="sidebar__avatar" fallbackName={peer.username} />
              <span className="sidebar__peer-name">{peer.username}</span>
              {(peer.muted || peer.deafened) && <span className="sidebar__peer-muted"><IconMicOff size={13} /></span>}
            </div>
          ))}
        </div>
      })}
    </div>
  )
}
