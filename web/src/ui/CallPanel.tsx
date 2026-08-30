import { IconLeave, IconPhone } from './Icons'
import './callpanel.css'

interface Props {
  /** Quem esta ligando para voce, ou para quem voce ligou. */
  username: string
  direction: 'incoming' | 'outgoing'
  onAccept(): void
  onDecline(): void
}

/**
 * O telefone tocando. Sem som de proposito — a decisao foi so visual; se
 * mudarmos de ideia, o toque entra aqui e em lugar nenhum mais.
 */
export function CallPanel({ username, direction, onAccept, onDecline }: Props) {
  const chegando = direction === 'incoming'

  return (
    <div className="callpanel" role="alertdialog" aria-label="chamada">
      <div className="callpanel__who">
        <span className="callpanel__avatar">{username.slice(0, 1).toUpperCase()}</span>
        <div className="callpanel__text">
          <span className="callpanel__name">{username}</span>
          <span className="callpanel__state">
            {chegando ? 'esta ligando' : 'chamando...'}
          </span>
        </div>
      </div>

      <div className="callpanel__actions">
        {chegando && (
          <button className="callpanel__accept" type="button" onClick={onAccept}>
            <IconPhone />
            atender
          </button>
        )}
        <button className="callpanel__decline" type="button" onClick={onDecline}>
          <IconLeave />
          {chegando ? 'recusar' : 'desistir'}
        </button>
      </div>
    </div>
  )
}
