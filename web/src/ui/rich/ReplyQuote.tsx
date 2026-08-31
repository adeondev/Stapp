import { memo } from 'react'
import type { ReplyRef } from '../../protocol'
import { ProfileName } from '../Avatar'
import { IconReply } from '../Icons'
import './reactions.css'

interface Props {
  reply: ReplyRef
  /** Leva a conversa ate a mensagem citada, quando ela ainda existe. */
  onGoTo?(messageId: string): void
}

/**
 * A linha de citacao acima de uma resposta.
 *
 * `author_id` ausente quer dizer que o alvo foi apagado — apagar e definitivo e
 * nao deixa lapide, entao a citacao e o unico lugar onde aquela mensagem ainda
 * aparece, e ela precisa dizer que sumiu em vez de sumir junto.
 */
export const ReplyQuote = memo(function ReplyQuote({ reply, onGoTo }: Props) {
  const apagada = reply.author_id === undefined

  if (apagada) {
    return (
      <p className="stapp-reply stapp-reply--apagada">
        <IconReply size={12} />
        <span>mensagem apagada</span>
      </p>
    )
  }

  return (
    <button
      type="button"
      className="stapp-reply"
      onClick={() => onGoTo?.(reply.message_id)}
      title="Ir para a mensagem"
    >
      <IconReply size={12} />
      <span className="stapp-reply__autor">
        <ProfileName userId={reply.author_id!} fallbackName={reply.author_username} />
      </span>
      <span className="stapp-reply__trecho">{reply.excerpt}</span>
    </button>
  )
})
