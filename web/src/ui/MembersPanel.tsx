import { Avatar, ProfileName } from './Avatar'
import type { SocialMember, UserId } from '../protocol'
import { useUserMenu } from './UserMenu'
import { useUserProfile } from './profile/UserProfilePopover'
import './members.css'

interface Props {
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  selfUserId: UserId | null
  selfUsername: string
}

/* Mensagem, adicionar, bloquear e o resto sairam daqui: agora saem do menu de
   perfil, que ja existia e ja era o caminho do botao direito em todo o resto
   do app. Ter as mesmas acoes em dois lugares — pilulas aqui, menu ali — era
   duas listas para manter e dois desenhos diferentes para a mesma coisa. */
export function MembersPanel({ members, onlineIds, selfUserId, selfUsername }: Props) {
  const userMenu = useUserMenu()
  const perfil = useUserProfile()
  const outros = members.filter((member) => member.user_id !== selfUserId)
  const ordenar = (lista: SocialMember[]) =>
    [...lista].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' }))
  const online = ordenar(outros.filter((member) => onlineIds.has(member.user_id)))
  const offline = ordenar(outros.filter((member) => !onlineIds.has(member.user_id)))

  const linha = (userId: UserId, username: string, conectado: boolean, eu: boolean) => (
    <button key={userId} className={`members__row ${conectado ? '' : 'is-offline'}`} type="button"
      onClick={(event) => {
        /* O clique da esquerda abre o CARTAO, inclusive no proprio perfil — e o
           cartao e que leva a "Editar perfil". O menu de acoes continua no botao
           direito e em "Mais opcoes" dentro do cartao, entao a mesma coisa vale
           aqui, no chat e na lista de amigos.
           O lado preferido e a esquerda porque esta coluna e a ultima da tela. */
        perfil.open(event.currentTarget, userId, 'left')
      }}
      onContextMenu={(event) => userMenu.open(event, { userId, name: username })}>
      <Avatar userId={userId} className={`members__avatar ${conectado ? 'is-online' : ''}`} fallbackName={username} />
      <span className="members__name"><ProfileName userId={userId} fallbackName={username} /></span>
      {eu && <span className="members__self">você</span>}
    </button>
  )

  return (
    <aside className="members" aria-label="Membros do servidor">
      <h2>Online — {online.length + (selfUserId ? 1 : 0)}</h2>
      {selfUserId && linha(selfUserId, selfUsername, true, true)}
      {online.map((member) => linha(member.user_id, member.username, true, false))}

      {offline.length > 0 && <>
        <h2>Offline — {offline.length}</h2>
        {offline.map((member) => linha(member.user_id, member.username, false, false))}
      </>}
    </aside>
  )
}
