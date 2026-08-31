import type { SavedServer } from '../net/servers'
import { IconPlus, IconStappLogo } from './Icons'
import './serverrail.css'

interface Props {
  servers: SavedServer[]
  activeUrl: string
  homeActive: boolean
  homeNotificationCount: number
  onHome(): void
  onSelect(server: SavedServer): void
  onAdd(): void
}

export function ServerRail({ servers, activeUrl, homeActive, homeNotificationCount, onHome, onSelect, onAdd }: Props) {
  return (
    <nav className="serverrail" aria-label="Servidores">
      <button className={`serverrail__item serverrail__home ${homeActive ? 'is-active' : ''}`}
        type="button" onClick={onHome}
        aria-label={`Amigos e mensagens diretas${homeNotificationCount > 0 ? `, ${homeNotificationCount} pendentes` : ''}`}>
        <IconStappLogo size={24} />
        {homeNotificationCount > 0 && <span className="serverrail__notification" aria-hidden="true">
          {homeNotificationCount > 99 ? '99+' : homeNotificationCount}
        </span>}
      </button>
      <span className="serverrail__separator" aria-hidden="true" />
      <div className="serverrail__servers">
        {servers.map((server) => (
          <button key={server.url}
            className={`serverrail__item ${activeUrl === server.url && !homeActive ? 'is-active' : ''}`}
            type="button" onClick={() => onSelect(server)} title={server.name}
            aria-label={server.name}>
            <span>{server.name.slice(0, 2).toUpperCase()}</span>
          </button>
        ))}
      </div>
      <button className="serverrail__item serverrail__add" type="button" onClick={onAdd}
        aria-label="Adicionar servidor" title="Adicionar servidor">
        <IconPlus size={20} />
      </button>
    </nav>
  )
}
