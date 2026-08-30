import { createContext, useContext, useMemo } from 'react'
import type { Profile, UserId } from '../protocol'
import { resolveProfile, type StappState } from '../store'

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

const ProfilesContext = createContext<StappState['profiles']>({})

/**
 * Deixa os perfis alcancaveis de qualquer lugar. Sem isto, componentes como o
 * `CallPanel` — que so recebem um nome — teriam que ganhar o estado inteiro por
 * prop so para desenhar um circulo.
 */
export function ProfileProvider({
  profiles,
  children,
}: {
  profiles: StappState['profiles']
  children: React.ReactNode
}) {
  return <ProfilesContext.Provider value={profiles}>{children}</ProfilesContext.Provider>
}

/** O perfil de alguem, com um provisorio enquanto o servidor nao mandou. */
export function useProfile(userId: UserId | null | undefined, fallbackName = ''): Profile {
  const profiles = useContext(ProfilesContext)
  return useMemo(
    () => resolveProfile(profiles, userId ?? '', fallbackName),
    [profiles, userId, fallbackName],
  )
}

interface Props {
  userId: UserId | null | undefined
  /** A classe da tela, que decide tamanho e formato. */
  className?: string
  /** Nome a usar enquanto o perfil nao chegou. */
  fallbackName?: string
  title?: string
}

export function Avatar({ userId, className, fallbackName, title }: Props) {
  const profile = useProfile(userId, fallbackName)

  return (
    <span
      className={className}
      title={title}
      style={
        {
          '--avatar-accent': `var(--accent-${profile.accent})`,
          '--avatar-ink': `var(--accent-${profile.accent}-ink)`,
        } as React.CSSProperties
      }
    >
      {inicial(profile.display_name)}
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
