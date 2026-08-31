import { memo } from 'react'
import type { Reaction, UserId } from '../../protocol'
import { useProfile } from '../Avatar'
import './reactions.css'

interface Props {
  reactions: Reaction[]
  selfUserId?: UserId
  onToggle(emoji: string): void
}

/**
 * Quem reagiu, resolvido no mapa de perfis.
 *
 * O payload traz so `user_id` — nome e cor nunca viajam junto, senao trocar de
 * apelido deixaria as reacoes antigas com o nome velho para sempre.
 */
function Quem({ users }: { users: UserId[] }) {
  const primeiro = useProfile(users[0] ?? '')
  const resto = users.length - 1
  if (users.length === 0) return null
  return (
    <>
      {primeiro.display_name}
      {resto > 0 && ` e mais ${resto}`}
    </>
  )
}

export const MessageReactions = memo(function MessageReactions({
  reactions,
  selfUserId,
  onToggle,
}: Props) {
  if (reactions.length === 0) return null

  return (
    <div className="stapp-reactions">
      {reactions.map((reacao) => {
        // Nao existe `reacted_by_me` no protocolo de proposito: o payload e o
        // mesmo para todo mundo, e quem quer saber procura o proprio id.
        const eu = Boolean(selfUserId && reacao.users.includes(selfUserId))
        return (
          <button
            key={reacao.emoji}
            type="button"
            className={`stapp-reaction ${eu ? 'is-minha' : ''}`}
            onClick={() => onToggle(reacao.emoji)}
          >
            <span className="stapp-reaction__emoji">{reacao.emoji}</span>
            <span className="stapp-reaction__conta">{reacao.users.length}</span>
            <span className="stapp-reaction__quem">
              <Quem users={reacao.users} />
            </span>
          </button>
        )
      })}
    </div>
  )
})
