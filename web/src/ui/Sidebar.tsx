import { useMemo, useState } from 'react'
import { Avatar, ProfileName } from './Avatar'
import type { ConnectionStatus } from '../net/connection'
import type { PeerId, UserId } from '../protocol'
import { directList, peersInChannel, type StappState } from '../store'
import { useVoiceStore } from '../stores/voiceStore'
import { IconChevronDown, IconHash, IconMicOff, IconSearch, IconSpeaker, IconUsers } from './Icons'
import { MenuDivider, MenuItem, useMenuHost } from './Menu'
import { useUserMenu } from './UserMenu'
import './sidebar.css'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…', online: 'Online', reconnecting: 'Reconectando…', offline: 'Sem conexão',
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
  speaking?: ReadonlySet<PeerId>
  footer: React.ReactNode
  onLogout?(): void
  onRemoveServer?(): void
}

export function Sidebar({ state, status, view, mode, onSelectHome, onSelectChannel, onSelectDirect,
  callChannel, onJoinCall, speaking: propSpeaking, footer, onLogout, onRemoveServer }: Props) {
  const storeSpeaking = useVoiceStore((s) => s.speakingPeers)
  const speaking = propSpeaking ?? storeSpeaking
  const [busca, setBusca] = useState('')
  const conversations = directList(state)
  const incomingRequests = state.socialMembers.filter((member) => member.relationship === 'incoming').length
  const home = mode === 'home'

  return (
    <aside className={`sidebar sidebar--${mode}`}>
      <header className="sidebar__head">
        {home ? (
          <label className="sidebar__search">
            <IconSearch size={14} />
            <input value={busca} onChange={(event) => setBusca(event.target.value)}
              placeholder="Encontre uma conversa" aria-label="Filtrar conversas" />
          </label>
        ) : (
          <ServerHeader name={state.serverName} onLogout={onLogout} onRemoveServer={onRemoveServer} />
        )}
      </header>

      {/* Estado da conexao so ganha uma linha quando ha algo errado. No caminho
          feliz ele seria ruido permanente ocupando a faixa mais nobre da
          coluna, e "online" escrito o tempo todo nao informa nada. */}
      {status !== 'online' && (
        <p className={`sidebar__status sidebar__status--${status}`} role="status">{STATUS_LABEL[status]}</p>
      )}

      <nav className="sidebar__scroll" aria-label={home ? 'Amigos e mensagens diretas' : 'Canais do servidor'}>
        {home ? (
          <HomeNavigation state={state} view={view} conversations={conversations} filtro={busca}
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

/* O cabecalho do servidor abre o menu com o que antes eram "sair" e "×" soltos
   na barra de conta. Acao de servidor mora no nome do servidor; a barra de
   baixo fala de quem voce e, nao de onde voce esta. */
function ServerHeader({ name, onLogout, onRemoveServer }: {
  name: string
  onLogout?(): void
  onRemoveServer?(): void
}) {
  const host = useMenuHost()
  const [aberto, setAberto] = useState(false)

  if (!onLogout && !onRemoveServer) {
    return <div className="sidebar__header-button"><span className="sidebar__server">{name}</span></div>
  }

  return (
    <button className="sidebar__header-button" type="button" aria-haspopup="menu" aria-expanded={aberto}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setAberto(true)
        host.open({ x: rect.left + 8, y: rect.bottom + 4, menuKey: 'server-header' }, name, (close) => (
          <ServerMenu onLogout={onLogout} onRemoveServer={onRemoveServer}
            close={() => { setAberto(false); close() }} />
        ))
      }}>
      <span className="sidebar__server">{name}</span>
      <IconChevronDown size={16} className="sidebar__header-chevron" />
    </button>
  )
}

function ServerMenu({ onLogout, onRemoveServer, close }: {
  onLogout?(): void
  onRemoveServer?(): void
  close(): void
}) {
  return <>
    {onLogout && <MenuItem onClick={() => { close(); onLogout() }}>Sair da conta</MenuItem>}
    {onLogout && onRemoveServer && <MenuDivider />}
    {onRemoveServer && <MenuItem danger onClick={() => { close(); onRemoveServer() }}>Remover servidor</MenuItem>}
  </>
}

/* Secao que recolhe. O estado mora aqui, e nao em quem chama, porque recolher
   uma secao e preferencia de tela — nao muda nada no servidor. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const [aberta, setAberta] = useState(true)
  return <>
    <button className="sidebar__section" type="button" aria-expanded={aberta}
      onClick={() => setAberta((valor) => !valor)}>
      <IconChevronDown size={12} className="sidebar__section-chevron" />
      <span className="sidebar__section-label">{label}</span>
    </button>
    {aberta && children}
  </>
}

interface HomeNavigationProps {
  state: StappState
  view: View | null
  conversations: ReturnType<typeof directList>
  filtro: string
  incomingRequests: number
  onSelectHome(): void
  onSelectDirect(userId: UserId): void
}

function HomeNavigation({ state, view, conversations, filtro, incomingRequests, onSelectHome, onSelectDirect }: HomeNavigationProps) {
  const userMenu = useUserMenu()
  const alvo = filtro.trim().toLocaleLowerCase('pt-BR')
  const visiveis = useMemo(() => alvo
    ? conversations.filter((conversation) => conversation.username.toLocaleLowerCase('pt-BR').includes(alvo))
    : conversations, [conversations, alvo])

  return (
    <div className="sidebar__menu">
      <button className={`sidebar__item ${view?.kind === 'home' ? 'is-active' : ''}`}
        onClick={onSelectHome}><IconUsers size={20} /><span className="sidebar__item-name">Amigos</span>
        {incomingRequests > 0 && <span className="sidebar__badge"
          aria-label={`${incomingRequests} pedidos recebidos`}>{incomingRequests > 99 ? '99+' : incomingRequests}</span>}
      </button>

      <Section label="Mensagens diretas">
        {visiveis.map((conversation) => {
          const online = state.users.some((user) => user.user_id === conversation.user_id)
          const open = view?.kind === 'direct' && view.userId === conversation.user_id
          const naoLido = conversation.unread > 0 && !open
          return <button key={conversation.user_id}
            className={`sidebar__item sidebar__item--dm ${open ? 'is-active' : ''} ${naoLido ? 'has-unread' : ''}`}
            aria-label={conversation.username}
            onContextMenu={(event) => userMenu.open(event, { userId: conversation.user_id, name: conversation.username })}
            onClick={() => onSelectDirect(conversation.user_id)}>
            {naoLido && <span className="sidebar__unread" aria-hidden="true" />}
            <Avatar userId={conversation.user_id}
              className={`sidebar__dm-avatar ${online ? 'is-online' : ''}`} fallbackName={conversation.username} />
            <span className="sidebar__item-name">
              <ProfileName userId={conversation.user_id} fallbackName={conversation.username} />
            </span>
            {conversation.unread > 0 && <span className="sidebar__badge">{conversation.unread}</span>}
          </button>
        })}
        {visiveis.length === 0 && <p className="sidebar__empty">
          {alvo ? 'Nenhuma conversa com esse nome.' : 'Suas conversas aparecerão aqui.'}
        </p>}
      </Section>
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
  const texto = state.channels.filter((channel) => channel.kind === 'text')
  const voz = state.channels.filter((channel) => channel.kind === 'voice')

  return (
    <div className="sidebar__menu">
      <Section label="Canais de texto">
        {texto.map((channel) => (
          <button key={channel.id}
            className={`sidebar__item ${view?.kind === 'channel' && view.id === channel.id ? 'is-active' : ''}`}
            onClick={() => onSelectChannel(channel.id)}>
            <IconHash size={20} /><span className="sidebar__item-name">{channel.name}</span>
          </button>
        ))}
      </Section>

      <Section label="Canais de voz">
        {voz.map((channel) => {
          const peers = peersInChannel(state, channel.id)
          const isConnected = channel.id === callChannel
          return <div key={channel.id}>
            <button className={`sidebar__item ${isConnected ? 'is-active' : ''}`}
              onClick={() => onJoinCall(channel.id)} title={isConnected ? 'Abrir chamada' : 'Conectar à sala de voz'}>
              <IconSpeaker size={20} /><span className="sidebar__item-name">{channel.name}</span>
              {peers.length > 0 && <span className="sidebar__count">{peers.length}</span>}
            </button>
            {peers.map((peer) => (
              <div key={peer.peer_id} className={`sidebar__peer ${speaking.has(peer.peer_id) ? 'is-speaking' : ''}`}
                onContextMenu={(event) => userMenu.open(event, { userId: peer.user_id, name: peer.username })}>
                <span className="sidebar__peer-ring">
                  <Avatar userId={peer.user_id} className="sidebar__avatar" fallbackName={peer.username} />
                </span>
                <span className="sidebar__peer-name">
                  <ProfileName userId={peer.user_id} fallbackName={peer.username} />
                </span>
                {(peer.muted || peer.deafened) && <span className="sidebar__peer-muted"><IconMicOff size={14} /></span>}
              </div>
            ))}
          </div>
        })}
      </Section>
    </div>
  )
}
