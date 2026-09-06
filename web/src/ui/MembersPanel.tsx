import { Avatar, ProfileName } from './Avatar'
import type { SocialMember, UserId } from '../protocol'
import { useUserMenu } from './UserMenu'
import './members.css'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  selfUserId: UserId | null
  selfUsername: string
  onEditSelf(): void
}

/* Mensagem, adicionar, bloquear e o resto sairam daqui: agora saem do menu de
   perfil, que ja existia e ja era o caminho do botao direito em todo o resto
   do app. Ter as mesmas acoes em dois lugares — pilulas aqui, menu ali — era
   duas listas para manter e dois desenhos diferentes para a mesma coisa. */
export function MembersPanel({ members, onlineIds, selfUserId, selfUsername, onEditSelf }: Props) {
  const userMenu = useUserMenu()
  const outros = members.filter((member) => member.user_id !== selfUserId)
  const ordenar = (lista: SocialMember[]) =>
    [...lista].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' }))
  const online = ordenar(outros.filter((member) => onlineIds.has(member.user_id)))
  const offline = ordenar(outros.filter((member) => !onlineIds.has(member.user_id)))

  const linha = (userId: UserId, username: string, conectado: boolean, eu: boolean) => (
    <button key={userId} className={`members__row ${conectado ? '' : 'is-offline'}`} type="button"
      onClick={(event) => {
        if (eu) return onEditSelf()
        const rect = event.currentTarget.getBoundingClientRect()
        // O menu nasce colado na linha, e nao no ponteiro: o clique da esquerda
        // tem uma ancora previsivel, diferente do menu de contexto.
        userMenu.open({ x: rect.left - 8, y: rect.top }, { userId, name: username })
      }}
      onContextMenu={(event) => userMenu.open(event, { userId, name: username })}>
      <Avatar userId={userId} className={`members__avatar ${conectado ? 'is-online' : ''}`} fallbackName={username} />
      <span className="members__name"><ProfileName userId={userId} fallbackName={username} /></span>
      {eu && <span className="members__self">você</span>}
    </button>
  )

  const onlineCount = online.length + (selfUserId ? 1 : 0)

  return (
    <aside className="members" aria-label="Membros do servidor">
      <h2 className="members__section-header" aria-label={`${onlineCount} — Online`}>
        <span className="members__status-dot is-online" aria-hidden="true" />
        <span className="members__count">{onlineCount} — Online</span>
      </h2>
      {selfUserId && linha(selfUserId, selfUsername, true, true)}
      {online.map((member) => linha(member.user_id, member.username, true, false))}

      {offline.length > 0 && (
        <>
          <div className="members__divider" role="separator" />
          <h2 className="members__section-header is-offline" aria-label={`${offline.length} — Offline`}>
            <span className="members__status-dot is-offline" aria-hidden="true" />
            <span className="members__count">{offline.length} — Offline</span>
          </h2>
          {offline.map((member) => linha(member.user_id, member.username, false, false))}
        </>
      )}
    </aside>
  )
}
