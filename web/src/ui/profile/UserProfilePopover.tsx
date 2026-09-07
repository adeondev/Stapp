import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SocialMember, UserId } from '../../protocol'
import { usePresenceStore } from '../../stores/presenceStore'
import { anchorFrom, useAnchoredSurface, type AnchorRect, type Placement } from '../anchored'
import { Modal, ModalHeader } from '../Overlay'
import { useUserMenu } from '../UserMenu'
import type { SocialAction } from '../FriendsHome'
import { UserProfileCard } from './UserProfileCard'
import './profilecard.css'

/**
 * A infraestrutura de perfil do app inteiro.
 *
 * Um provider, um popover montado, um dialogo. **Nao existe** um popup por
 * pagina: qualquer tela chama `useUserProfile().open(alvo, userId)` e recebe o
 * mesmo cartao, com as mesmas regras de posicionamento, foco e fechamento.
 *
 * Isso importa para desempenho tanto quanto para consistencia. A lista de
 * membros, a de amigos e o historico de mensagens desenham dezenas de avatares;
 * se cada linha montasse o proprio popover (mesmo fechado), seriam dezenas de
 * `useEffect`, de listeners de teclado e de nos no DOM. Aqui a linha so entrega
 * um retangulo.
 */

interface AberturaPopover {
  userId: UserId
  anchor: AnchorRect
  placement: Placement
}

interface ValorPerfil {
  /** Abre o cartao ancorado. Aceita o elemento clicado ou um retangulo. */
  open(alvo: Element | AnchorRect, userId: UserId, placement?: Placement): void
  /** Abre direto o perfil completo, sem passar pelo popover. */
  openFull(userId: UserId): void
  close(): void
}

const PerfilContext = createContext<ValorPerfil>({ open() {}, openFull() {}, close() {} })

export interface UserProfileProviderProps {
  children: React.ReactNode
  selfUserId: UserId | null
  members: SocialMember[]
  onlineIds: ReadonlySet<UserId>
  avatarBase: string | null
  onMessage(userId: UserId): void
  onCall(userId: UserId, username: string): void
  onQuickMessage(userId: UserId, text: string): void
  onAction(action: SocialAction, userId: UserId): void
  onEditSelf(): void
  /** Pede ao servidor a parte do perfil que nao vem no `welcome`. */
  onFetchDetail(userId: UserId): void
}

export function UserProfileProvider({
  children, selfUserId, members, onlineIds, avatarBase,
  onMessage, onCall, onQuickMessage, onAction, onEditSelf, onFetchDetail,
}: UserProfileProviderProps) {
  const [popover, setPopover] = useState<AberturaPopover | null>(null)
  const [completo, setCompleto] = useState<UserId | null>(null)
  const userMenu = useUserMenu()
  const profiles = usePresenceStore((s) => s.profiles)
  const detalhes = usePresenceStore((s) => s.profileDetails)

  const close = useCallback(() => setPopover(null), [])

  const open = useCallback((alvo: Element | AnchorRect, userId: UserId, placement: Placement = 'right') => {
    const anchor = 'getBoundingClientRect' in alvo ? anchorFrom(alvo) : alvo
    setPopover((atual) => {
      // Clicar de novo no mesmo avatar fecha, como faz o menu de contexto.
      if (atual && atual.userId === userId && atual.anchor.top === anchor.top && atual.anchor.left === anchor.left) {
        return null
      }
      return { userId, anchor, placement }
    })
  }, [])

  const openFull = useCallback((userId: UserId) => {
    setPopover(null)
    setCompleto(userId)
  }, [])

  const valor = useMemo(() => ({ open, openFull, close }), [open, openFull, close])

  // O detalhe so e pedido quando alguem ABRE um perfil — nunca a cada avatar
  // desenhado. E pedido de novo a cada abertura de proposito: amizade em comum
  // muda, e o custo e uma consulta por clique.
  const alvo = popover?.userId ?? completo ?? null
  useEffect(() => {
    if (!alvo || alvo === selfUserId) return
    onFetchDetail(alvo)
  }, [alvo, selfUserId, onFetchDetail])

  const dados = (userId: UserId) => {
    const membro = members.find((item) => item.user_id === userId)
    const isSelf = userId === selfUserId
    return {
      isSelf,
      online: isSelf || onlineIds.has(userId),
      relation: membro
        ? { relationship: membro.relationship, canStartDm: membro.can_start_dm, serverName: membro.server_name }
        : undefined,
      mutualFriends: isSelf ? [] : detalhes[userId]?.mutualFriends,
      // O perfil pode simplesmente nao existir (conta apagada, id de mensagem
      // antiga). Melhor dizer isso do que desenhar um cartao de "alguem".
      unavailable: !isSelf && !profiles[userId]
        ? 'Não consegui carregar este perfil. A conta pode ter sido removida.'
        : null,
    }
  }

  const acoes = (fechar: () => void) => ({
    onMessage: (id: UserId) => { fechar(); onMessage(id) },
    onCall: (id: UserId) => {
      fechar()
      onCall(id, profiles[id]?.username ?? '')
    },
    onQuickMessage: (id: UserId, texto: string) => {
      fechar()
      onQuickMessage(id, texto)
    },
    onAddFriend: (id: UserId) => onAction('request', id),
    onAcceptFriend: (id: UserId) => onAction('accept', id),
    onUnblock: (id: UserId) => onAction('unblock', id),
    onEditSelf: () => { fechar(); onEditSelf() },
    onOpenMenu: (id: UserId, botao: HTMLElement) => {
      const caixa = botao.getBoundingClientRect()
      userMenu.open(
        { x: caixa.left, y: caixa.bottom + 4, menuKey: `profile:${id}`, trigger: botao },
        { userId: id, name: profiles[id]?.display_name ?? '' },
      )
    },
  })

  return (
    <PerfilContext.Provider value={valor}>
      {children}
      {popover && (
        <PopoverAncorado
          abertura={popover}
          onClose={close}
          conteudo={
            <UserProfileCard
              userId={popover.userId}
              variant="popover"
              avatarBase={avatarBase}
              {...dados(popover.userId)}
              {...acoes(close)}
              onOpenFull={openFull}
            />
          }
        />
      )}
      {completo && (
        <Modal open onClose={() => setCompleto(null)} size="lg" label="Perfil" className="profile-full">
          <ModalHeader title="Perfil" onClose={() => setCompleto(null)} />
          <UserProfileCard
            userId={completo}
            variant="full"
            avatarBase={avatarBase}
            {...dados(completo)}
            {...acoes(() => setCompleto(null))}
          />
        </Modal>
      )}
    </PerfilContext.Provider>
  )
}

/**
 * A casca do popover: portal, posicionamento com flip, Escape e clique fora.
 *
 * Escape e clique fora sao registrados na fase de captura para ganhar de quem
 * estiver ouvindo dentro da tela — o mesmo que o `PopupMenu` ja faz.
 */
function PopoverAncorado({ abertura, conteudo, onClose }: {
  abertura: AberturaPopover
  conteudo: React.ReactNode
  onClose(): void
}) {
  const { ref, style } = useAnchoredSurface<HTMLDivElement>({
    anchor: abertura.anchor,
    placement: abertura.placement,
    align: 'start',
  })
  const devolverFoco = useRef<HTMLElement | null>(null)

  useEffect(() => {
    devolverFoco.current = document.activeElement as HTMLElement | null
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const foraDaCaixa = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    // Rolar a lista embaixo levaria o cartao junto sem levar a ancora: mais
    // honesto fechar, como o menu ja faz no `resize`.
    const fechar = () => onClose()
    window.addEventListener('keydown', aoTeclar, true)
    window.addEventListener('pointerdown', foraDaCaixa, true)
    window.addEventListener('blur', fechar)
    document.addEventListener('scroll', fechar, true)
    return () => {
      window.removeEventListener('keydown', aoTeclar, true)
      window.removeEventListener('pointerdown', foraDaCaixa, true)
      window.removeEventListener('blur', fechar)
      document.removeEventListener('scroll', fechar, true)
      const anterior = devolverFoco.current
      if (anterior?.isConnected) anterior.focus()
    }
  }, [onClose, ref])

  return createPortal(
    <div ref={ref} className="profile-popover" style={style} role="dialog" aria-label="Perfil">
      {conteudo}
    </div>,
    document.body,
  )
}

export function useUserProfile() {
  return useContext(PerfilContext)
}

/**
 * As props que transformam QUALQUER elemento num alvo de perfil.
 *
 * Existe como hook, e nao como componente, porque os alvos ja tem casca e
 * classe propria: o avatar da mensagem, o apelido no cabecalho, a linha da
 * lista de membros. Envolver cada um num `<button>` mudaria o layout de todos e
 * ainda criaria botao dentro de botao onde a linha inteira ja e clicavel.
 *
 * O elemento vira alvo de teclado de verdade — Enter e Espaco abrem, e o foco
 * volta para ele quando o cartao fecha.
 */
export function useProfileTrigger(userId: UserId | null | undefined, placement: Placement = 'right') {
  const paraUsuario = useProfileTriggerFactory()
  return userId ? paraUsuario(userId, placement) : {}
}

/**
 * A mesma coisa, mas como fabrica.
 *
 * Uma lista de mensagens desenha dezenas de autores dentro de um `.map()`, e ali
 * nao da para chamar um hook por item. O componente chama esta fabrica uma vez e
 * usa `paraUsuario(id)` a vontade.
 */
export function useProfileTriggerFactory() {
  const { open } = useUserProfile()
  return useCallback((userId: UserId, placement: Placement = 'right') => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-haspopup': 'dialog' as const,
    onClick(event: React.MouseEvent) {
      event.stopPropagation()
      open(event.currentTarget, userId, placement)
    },
    onKeyDown(event: React.KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      open(event.currentTarget, userId, placement)
    },
  }), [open])
}
