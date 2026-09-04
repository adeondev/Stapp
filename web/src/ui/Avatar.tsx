import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { PeerId, Profile, UserId } from '../protocol'
import { avatarUrl } from '../net/avatars'
import { resolveProfile, type StappState } from '../store'
import { usePresenceStore } from '../stores/presenceStore'
import { useVoiceStore } from '../stores/voiceStore'

/**
 * O avatar de uma pessoa, em um lugar so.
 *
 * Antes cada tela desenhava `username.slice(0, 1).toUpperCase()` por conta
 * propria — eram sete copias, todas do mesmo cinza. Agora todas chamam isto, e
 * qualquer coisa que o perfil ganhe (imagem, moldura de quem esta falando)
 * aparece nas sete de uma vez.
 *
 * O tamanho e o formato continuam vindo do CSS de cada tela, pela `className`:
 * um avatar na sidebar tem 24px e canto quadrado, o do painel de chamada tem
 * 40px e e redondo. Aqui so entram o conteudo e a cor.
 */

interface Contexto {
  profiles: StappState['profiles']
  /** Base HTTP do servidor, para montar a URL da imagem. */
  avatarBase: string | null
}

const ProfilesContext = createContext<Contexto>({ profiles: {}, avatarBase: null })

/**
 * Deixa os perfis alcancaveis de qualquer lugar. Sem isto, componentes como o
 * `CallPanel` — que so recebem um nome — teriam que ganhar o estado inteiro por
 * prop so para desenhar um circulo.
 */
export function ProfileProvider({
  profiles,
  avatarBase,
  children,
}: {
  profiles: StappState['profiles']
  avatarBase: string | null
  children: React.ReactNode
}) {
  const valor = useMemo(() => ({ profiles, avatarBase }), [profiles, avatarBase])
  return <ProfilesContext.Provider value={valor}>{children}</ProfilesContext.Provider>
}

/** O perfil de alguem, com um provisorio enquanto o servidor nao mandou. */
export function useProfile(userId: UserId | null | undefined, fallbackName = ''): Profile {
  const { profiles: contextProfiles } = useContext(ProfilesContext)
  const storeProfile = usePresenceStore((s) => (userId ? s.profiles[userId] : undefined))
  const profile = storeProfile ?? (userId ? contextProfiles[userId] : undefined)

  return useMemo(
    () => profile ?? resolveProfile(contextProfiles, userId ?? '', fallbackName),
    [profile, contextProfiles, userId, fallbackName],
  )
}

interface Props {
  userId: UserId | null | undefined
  /** A classe da tela, que decide tamanho e formato. */
  className?: string
  /** Nome a usar enquanto o perfil nao chegou. */
  fallbackName?: string
  title?: string
  peerId?: PeerId
  speaking?: boolean
}

export function Avatar({ userId, className, fallbackName, title, peerId, speaking }: Props) {
  const profile = useProfile(userId, fallbackName)
  const { avatarBase } = useContext(ProfilesContext)
  const [falhou, setFalhou] = useState(false)
  const storeSpeaking = useVoiceStore((s) => (peerId ? s.speakingPeers.has(peerId) : false))
  const isSpeaking = speaking ?? storeSpeaking

  // Trocar a foto muda o `updated_at`, e com ele a URL — entao vale voltar a
  // tentar depois de um erro.
  useEffect(() => setFalhou(false), [profile.updated_at, profile.has_avatar])

  const imagem =
    profile.has_avatar && avatarBase && !falhou
      ? avatarUrl(avatarBase, profile.user_id, profile.updated_at)
      : null

  const combinedClass = `${className ?? ''} ${isSpeaking ? 'is-speaking' : ''}`.trim()

  return (
    <span
      className={combinedClass || undefined}
      title={title}
      style={
        {
          '--avatar-accent': `var(--accent-${profile.accent})`,
          '--avatar-ink': `var(--accent-${profile.accent}-ink)`,
        } as React.CSSProperties
      }
    >
      {imagem ? (
        // Se o arquivo sumiu do servidor, cai no gerado em vez de deixar o
        // quadrado quebrado do navegador.
        <img className="avatar__img" src={imagem} alt="" onError={() => setFalhou(true)} />
      ) : (
        inicial(profile.display_name)
      )}
    </span>
  )
}

/**
 * So o nome que deve aparecer. Existe como componente, e nao como hook, para
 * poder ser usado dentro de um `.map()` — que e onde as listas desenham gente.
 */
export function ProfileName({
  userId,
  fallbackName,
}: {
  userId: UserId | null | undefined
  fallbackName?: string
}) {
  return <>{useProfile(userId, fallbackName).display_name}</>
}

/** A primeira letra de verdade — nome que comeca com emoji nao vira quadrado. */
function inicial(nome: string): string {
  const letra = [...nome].find((caractere) => /\p{L}|\p{N}/u.test(caractere))
  return (letra ?? nome[0] ?? '?').toUpperCase()
}
