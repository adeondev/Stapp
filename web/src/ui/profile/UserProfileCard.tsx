import { useEffect, useMemo, useRef, useState } from 'react'
import type { Profile, RelationshipState, UserId } from '../../protocol'
import { bannerUrl } from '../../net/avatars'
import { Avatar, useProfile } from '../Avatar'
import { IconChat, IconMore, IconPhone, IconShield, IconUser, IconX } from '../Icons'
import { IconButton } from '../IconButton'
import './profilecard.css'

/**
 * O cartao de perfil — um so, para todas as superficies.
 *
 * Antes disto, clicar numa pessoa dava coisas diferentes conforme a tela: no
 * painel de membros abria o menu de contexto, na barra de conta abria o editor,
 * e no chat e na lista de amigos **nao fazia nada** (o `Avatar` era um `<span>`
 * e o `ProfileName` um fragmento). O menu que existia oferecia so "Mensagem" e
 * "Ligar".
 *
 * Duas regras que este componente nao quebra:
 *
 * - **Nada de dado ficticio para preencher espaco.** Secao sem dado nao e
 *   desenhada vazia: ela simplesmente nao existe. "Amigos em comum" enquanto
 *   carrega mostra que esta carregando, e nunca "0".
 * - **Perfil se busca, nao se copia.** O cartao recebe `userId` e resolve nome,
 *   cor e avatar pelo `useProfile`, como todo o resto do app.
 */

export type ProfileCardVariant =
  /** Popover ancorado num avatar ou nome. Compacto. */
  | 'popover'
  /** Dentro do dialogo de perfil completo. Mais largo, com mais secoes. */
  | 'full'
  /** Somente leitura, no editor de perfil: "e assim que os outros te veem". */
  | 'preview'

export interface ProfileCardRelation {
  relationship: RelationshipState
  canStartDm: boolean
  serverName?: string
}

export interface ProfileCardActions {
  onMessage?(userId: UserId): void
  onCall?(userId: UserId): void
  onQuickMessage?(userId: UserId, text: string): void
  onAddFriend?(userId: UserId): void
  onAcceptFriend?(userId: UserId): void
  onBlock?(userId: UserId): void
  onUnblock?(userId: UserId): void
  onOpenFull?(userId: UserId): void
  onOpenMenu?(userId: UserId, anchor: HTMLElement): void
  onEditSelf?(): void
}

export interface UserProfileCardProps extends ProfileCardActions {
  userId: UserId
  variant?: ProfileCardVariant
  /** Perfil ja resolvido — usado pelo preview do editor, que mostra o rascunho. */
  profileOverride?: Profile
  /** Base HTTP do servidor, para montar a URL do banner. */
  avatarBase?: string | null
  /** URL local (object URL) do banner ainda nao enviado, no preview do editor. */
  bannerPreview?: string | null
  isSelf?: boolean
  online?: boolean
  relation?: ProfileCardRelation
  /** `undefined` = ainda carregando. `[]` = carregou e nao ha nenhum. */
  mutualFriends?: UserId[]
  /** Mensagem de indisponibilidade; substitui o corpo do cartao. */
  unavailable?: string | null
  className?: string
}

const RELACAO: Record<RelationshipState, string | null> = {
  none: null,
  friend: 'Amigos',
  incoming: 'Quer ser seu amigo',
  outgoing: 'Pedido enviado',
  blocked: 'Bloqueado',
}

/** Data por extenso, mes abreviado — "8 de nov. de 2018". */
function membroDesde(epochMs: number): string | null {
  if (!epochMs) return null
  const data = new Date(epochMs)
  if (Number.isNaN(data.getTime())) return null
  return data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function UserProfileCard({
  userId, variant = 'popover', profileOverride, avatarBase, bannerPreview,
  isSelf = false, online = false, relation, mutualFriends, unavailable = null,
  className = '', ...acoes
}: UserProfileCardProps) {
  const resolvido = useProfile(userId)
  const profile = profileOverride ?? resolvido
  const [rascunho, setRascunho] = useState('')
  const maisRef = useRef<HTMLButtonElement>(null)

  // Trocar de pessoa nao pode carregar o texto digitado para a proxima.
  useEffect(() => setRascunho(''), [userId])

  const banner = bannerPreview
    ?? (profile.banner_url ? profile.banner_url : (profile.has_banner && avatarBase ? bannerUrl(avatarBase, profile.user_id, profile.updated_at) : null))
  const desde = membroDesde(profile.created_at)
  const rotuloRelacao = relation ? RELACAO[relation.relationship] : null
  const somenteLeitura = variant === 'preview'

  const estilo = useMemo(() => ({
    '--profile-accent': `var(--accent-${profile.accent})`,
    '--profile-ink': `var(--accent-${profile.accent}-ink)`,
  } as React.CSSProperties), [profile.accent])

  if (unavailable) {
    return (
      <section className={`profile-card profile-card--${variant} ${className}`} style={estilo}>
        <div className="profile-card__banner profile-card__banner--flat" />
        <div className="profile-card__unavailable" role="status">
          <IconShield size={24} />
          <p>{unavailable}</p>
        </div>
      </section>
    )
  }

  return (
    <section className={`profile-card profile-card--${variant} ${className}`} style={estilo}>
      {/* Sem imagem, a faixa e a cor de destaque da pessoa ou banner_color customizada. */}
      <div
        className={`profile-card__banner ${banner ? 'has-image' : 'profile-card__banner--flat'}`}
        style={profile.banner_color ? { backgroundColor: profile.banner_color } : undefined}
      >
        {banner && <img src={banner} alt="" className="profile-card__banner-img" />}
      </div>

      <div className="profile-card__identity">
        <span className={`profile-card__avatar ${online ? 'is-online' : ''}`}>
          <Avatar userId={userId} fallbackName={profile.username} />
        </span>
        {!somenteLeitura && (
          <div className="profile-card__quick">
            {acoes.onOpenMenu && (
              <IconButton
                ref={maisRef}
                size="sm"
                label="Mais opções"
                icon={<IconMore size={16} />}
                onClick={() => maisRef.current && acoes.onOpenMenu?.(userId, maisRef.current)}
              />
            )}
          </div>
        )}
      </div>

      <div className="profile-card__body">
        <header className="profile-card__names">
          <h3 className="profile-card__display">{profile.display_name}</h3>
          <span className="profile-card__handle">@{profile.username}</span>
          <div className="profile-card__badges">
            <span className={`profile-card__badge ${online ? 'is-online' : 'is-offline'}`}>
              {online ? 'Online' : 'Offline'}
            </span>
            {rotuloRelacao && <span className="profile-card__relation">{rotuloRelacao}</span>}
            {relation?.serverName && (
              <span className="profile-card__badge profile-card__badge--server">
                {relation.serverName}
              </span>
            )}
          </div>
        </header>

        {profile.bio && (
          <section className="profile-card__section">
            <h4>Sobre</h4>
            <p className="profile-card__bio">{profile.bio}</p>
          </section>
        )}

        {desde && (
          <section className="profile-card__section">
            <h4>Membro desde</h4>
            <p className="profile-card__meta">{desde}</p>
          </section>
        )}

        {/* `undefined` e "ainda nao voltou do servidor". Sem esta distincao o
            cartao anunciaria "nenhum amigo em comum" antes de saber. */}
        {!isSelf && !somenteLeitura && (
          mutualFriends === undefined ? (
            <section className="profile-card__section">
              <h4>Amigos em comum</h4>
              <p className="profile-card__meta profile-card__meta--loading">Carregando…</p>
            </section>
          ) : mutualFriends.length > 0 ? (
            <section className="profile-card__section">
              <h4>Amigos em comum — {mutualFriends.length}</h4>
              <ul className="profile-card__mutuals">
                {mutualFriends.slice(0, 8).map((id) => (
                  <li key={id}>
                    <Avatar userId={id} className="profile-card__mutual-avatar" />
                  </li>
                ))}
                {mutualFriends.length > 8 && (
                  <li className="profile-card__mutual-more">+{mutualFriends.length - 8}</li>
                )}
              </ul>
            </section>
          ) : null
        )}

        {!somenteLeitura && (
          <footer className="profile-card__actions">
            {isSelf ? (
              acoes.onEditSelf && (
                <button type="button" className="profile-card__button is-primary" onClick={acoes.onEditSelf}>
                  <IconUser size={16} /> Editar perfil
                </button>
              )
            ) : (
              <>
                {relation?.relationship === 'none' && acoes.onAddFriend && (
                  <button type="button" className="profile-card__button" onClick={() => acoes.onAddFriend?.(userId)}>
                    <IconUser size={16} /> Adicionar amigo
                  </button>
                )}
                {relation?.relationship === 'incoming' && acoes.onAcceptFriend && (
                  <button type="button" className="profile-card__button is-primary" onClick={() => acoes.onAcceptFriend?.(userId)}>
                    <IconUser size={16} /> Aceitar pedido
                  </button>
                )}
                {relation?.canStartDm && acoes.onMessage && (
                  <button type="button" className="profile-card__button" onClick={() => acoes.onMessage?.(userId)}>
                    <IconChat size={16} /> Mensagem
                  </button>
                )}
                {relation?.canStartDm && acoes.onCall && (
                  <button type="button" className="profile-card__button" onClick={() => acoes.onCall?.(userId)}>
                    <IconPhone size={16} /> Ligar
                  </button>
                )}
                {relation?.relationship === 'blocked' && acoes.onUnblock && (
                  <button type="button" className="profile-card__button" onClick={() => acoes.onUnblock?.(userId)}>
                    <IconShield size={16} /> Desbloquear
                  </button>
                )}
              </>
            )}
            {acoes.onOpenFull && variant === 'popover' && (
              <button type="button" className="profile-card__link" onClick={() => acoes.onOpenFull?.(userId)}>
                Ver perfil completo
              </button>
            )}
          </footer>
        )}

        {/* Campo rapido: manda a mensagem sem sair da tela em que se estava.
            So aparece quando a conversa e possivel de verdade. */}
        {!isSelf && !somenteLeitura && relation?.canStartDm && acoes.onQuickMessage && (
          <form
            className="profile-card__compose"
            onSubmit={(event) => {
              event.preventDefault()
              const texto = rascunho.trim()
              if (!texto) return
              acoes.onQuickMessage?.(userId, texto)
              setRascunho('')
            }}
          >
            <input
              value={rascunho}
              onChange={(event) => setRascunho(event.target.value)}
              placeholder={`Conversar com @${profile.username}`}
              aria-label={`Mensagem para ${profile.display_name}`}
              maxLength={2000}
            />
            {rascunho.trim() && (
              <IconButton
                type="submit"
                size="sm"
                tone="accent"
                label="Enviar"
                icon={<IconChat size={16} />}
              />
            )}
          </form>
        )}
      </div>
    </section>
  )
}

/** Cabecalho fechavel, para quando o cartao aparece dentro de um dialogo. */
export function ProfileCardClose({ onClose }: { onClose(): void }) {
  return (
    <IconButton
      className="profile-card__close"
      size="sm"
      label="Fechar"
      icon={<IconX size={16} />}
      onClick={onClose}
    />
  )
}
