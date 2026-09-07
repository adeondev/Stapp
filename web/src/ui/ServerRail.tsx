import { useState } from 'react'
import type { SavedServer } from '../net/servers'
import { IconPlus, IconStappLogo } from './Icons'
import { MenuDivider, MenuItem, useMenuHost } from './Menu'
import { Modal, ModalBody, ModalFooter, ModalHeader } from './Overlay'
import './serverrail.css'

interface Props {
  servers: SavedServer[]
  activeUrl: string
  homeActive: boolean
  homeNotificationCount: number
  onHome(): void
  onSelect(server: SavedServer): void
  onAdd(): void
  onMarkAsRead?(server: SavedServer): void
  onRemoveServer?(server: SavedServer): void
}

/* Sigla do servidor: inicial de cada palavra, nao os dois primeiros caracteres.
   "Stapp dos guri" vira "Sdg" e nao "ST" — com dois servidores cujo nome
   comeca igual, o corte cego mostrava a mesma sigla nos dois. */
function sigla(name: string) {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase()
}

interface Dica { texto: string; y: number }

export function ServerRail({
  servers,
  activeUrl,
  homeActive,
  homeNotificationCount,
  onHome,
  onSelect,
  onAdd,
  onMarkAsRead,
  onRemoveServer,
}: Props) {
  /* A dica mora AQUI, no trilho, e nao dentro de cada slot: a lista de
     servidores rola, e tudo que nasce dentro de um container que rola e
     recortado na borda dele — a dica apareceria cortada pela metade. Uma so,
     `position: fixed`, ancorada na altura do item sob o mouse. */
  const [dica, setDica] = useState<Dica | null>(null)
  const [serverToRemove, setServerToRemove] = useState<SavedServer | null>(null)
  const host = useMenuHost()

  const mostrar = (texto: string) => (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setDica({ texto, y: rect.top + rect.height / 2 })
  }
  const esconder = () => setDica(null)

  const handleContextMenu = (event: React.MouseEvent, server: SavedServer) => {
    event.preventDefault()
    event.stopPropagation()
    esconder()
    host.open(
      { x: event.clientX, y: event.clientY, menuKey: `server-${server.url}` },
      server.name,
      (close) => (
        <>
          <MenuItem onClick={() => {
            close()
            onMarkAsRead?.(server)
          }}>
            Marcar como lido
          </MenuItem>
          <MenuItem onClick={() => {
            close()
            void navigator.clipboard.writeText(server.url)
          }}>
            Copiar endereço do servidor
          </MenuItem>
          <MenuDivider />
          <MenuItem danger onClick={() => {
            close()
            setServerToRemove(server)
          }}>
            Remover servidor da lista
          </MenuItem>
        </>
      ),
    )
  }

  const slot = (active: boolean, texto: string, botao: React.ReactNode) => (
    <div className={`serverrail__slot ${active ? 'is-active' : ''}`}
      onMouseEnter={mostrar(texto)} onMouseLeave={esconder}>
      <span className="serverrail__pill" aria-hidden="true" />
      {botao}
    </div>
  )

  return (
    <>
      <nav className="serverrail" aria-label="Servidores" onMouseLeave={esconder}>
        {slot(homeActive, 'Mensagens diretas',
          <button className="serverrail__item serverrail__home" type="button" onClick={onHome}
            aria-label={`Amigos e mensagens diretas${homeNotificationCount > 0 ? `, ${homeNotificationCount} pendentes` : ''}`}>
            <IconStappLogo size={26} />
            {homeNotificationCount > 0 && <span className="serverrail__notification" aria-hidden="true">
              {homeNotificationCount > 99 ? '99+' : homeNotificationCount}
            </span>}
          </button>)}

        <span className="serverrail__separator" aria-hidden="true" />

        <div className="serverrail__servers">
          {servers.map((server) => (
            <div key={server.url}
              className={`serverrail__slot ${activeUrl === server.url && !homeActive ? 'is-active' : ''}`}
              onMouseEnter={mostrar(server.name)} onMouseLeave={esconder}>
              <span className="serverrail__pill" aria-hidden="true" />
              <button className="serverrail__item" type="button"
                onClick={() => onSelect(server)}
                onContextMenu={(event) => handleContextMenu(event, server)}
                aria-label={server.name}>
                <span aria-hidden="true">{sigla(server.name)}</span>
              </button>
            </div>
          ))}
        </div>

        {slot(false, 'Adicionar servidor',
          <button className="serverrail__item serverrail__add" type="button" onClick={onAdd}
            aria-label="Adicionar servidor">
            <IconPlus size={20} />
          </button>)}

        {dica && <span className="serverrail__tip" style={{ top: dica.y }} role="presentation">{dica.texto}</span>}
      </nav>

      {serverToRemove && (
        <Modal
          open={true}
          onClose={() => setServerToRemove(null)}
          label="Remover servidor da lista"
          size="sm"
        >
          <ModalHeader
            title="Remover servidor"
            onClose={() => setServerToRemove(null)}
          />
          <ModalBody>
            <p className="serverrail__modal-p">
              Tem certeza que deseja remover <strong>{serverToRemove.name}</strong> da sua lista de servidores?
            </p>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              className="serverrail__modal-btn"
              onClick={() => setServerToRemove(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="serverrail__modal-btn serverrail__modal-btn--danger"
              onClick={() => {
                const s = serverToRemove
                setServerToRemove(null)
                onRemoveServer?.(s)
              }}
            >
              Remover servidor
            </button>
          </ModalFooter>
        </Modal>
      )}
    </>
  )
}
