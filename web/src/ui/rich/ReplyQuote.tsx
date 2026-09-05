import { memo } from 'react'
import type { ReplyRef } from '../../protocol'
import { Avatar, ProfileName } from '../Avatar'
import { IconReply } from '../Icons'
import './reactions.css'

interface Props {
  reply: ReplyRef
  /** Leva a conversa ate a mensagem citada, quando ela ainda existe. */
  onGoTo?(messageId: string): void
}

/* A espinha que liga a citacao ao avatar da resposta, na calha a esquerda.

   E um SVG, e nao `border-left` + `border-top` + raio: o projeto nao usa borda,
   e o desenho aqui e conteudo — diz "esta mensagem responde aquela" — nao uma
   linha divisoria. Uma resposta nunca e agrupada com a anterior justamente
   para o avatar existir e a espinha ter onde chegar. */
function Espinha() {
  return (
    <svg className="stapp-reply__espinha" viewBox="0 0 30 22" aria-hidden="true">
      <path d="M1 22V8a6 6 0 0 1 6-6h23" />
    </svg>
  )
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
        <Espinha />
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
      <Espinha />
      <Avatar userId={reply.author_id!} className="stapp-reply__avatar" fallbackName={reply.author_username} />
      <span className="stapp-reply__autor">
        <ProfileName userId={reply.author_id!} fallbackName={reply.author_username} />
      </span>
      <span className="stapp-reply__trecho">{reply.excerpt}</span>
    </button>
  )
})
