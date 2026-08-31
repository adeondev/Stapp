import { memo, useEffect, useMemo, useState } from 'react'
import type { DirectoryEntry, UserId } from '../../protocol'
import { Avatar, ProfileName } from '../Avatar'
import './reactions.css'

/** `@everyone` nao e conta: e um alvo reservado que o servidor reconhece. */
export const TODOS: DirectoryEntry = { user_id: '@everyone', username: 'everyone' }

interface Props {
  /** O que veio depois do `@`, ja sem o arroba. `null` = popup fechado. */
  consulta: string | null
  candidatos: DirectoryEntry[]
  onEscolher(username: string): void
  onFechar(): void
}

const MAX_SUGESTOES = 8

/**
 * Sugere contas enquanto a pessoa digita `@`.
 *
 * A lista sai do `directory` que o `welcome` ja entregou — nenhuma ida nova ao
 * servidor. O que e escolhido e o **username**, porque e ele que vai no texto:
 * o servidor resolve para `user_id` no envio, e nome de exibicao, cor e avatar
 * continuam saindo do mapa de perfis.
 */
export const MentionAutocomplete = memo(function MentionAutocomplete({
  consulta,
  candidatos,
  onEscolher,
  onFechar,
}: Props) {
  const [ativo, setAtivo] = useState(0)

  const sugestoes = useMemo(() => {
    if (consulta === null) return []
    const alvo = consulta.toLocaleLowerCase('pt-BR')
    return [TODOS, ...candidatos]
      .filter((entry) => entry.username.toLocaleLowerCase('pt-BR').startsWith(alvo))
      .slice(0, MAX_SUGESTOES)
  }, [consulta, candidatos])

  useEffect(() => setAtivo(0), [consulta])

  useEffect(() => {
    if (sugestoes.length === 0) return

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        return onFechar()
      }
      if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
        evento.preventDefault()
        const passo = evento.key === 'ArrowDown' ? 1 : -1
        return setAtivo((atual) => (atual + passo + sugestoes.length) % sugestoes.length)
      }
      if (evento.key === 'Enter' || evento.key === 'Tab') {
        // Enter aqui **escolhe a sugestao**; sem isto ele enviaria a mensagem
        // no meio da digitacao do nome.
        evento.preventDefault()
        onEscolher(sugestoes[ativo].username)
      }
    }

    // Captura para chegar antes do onKeyDown da caixa de escrever.
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [sugestoes, ativo, onEscolher, onFechar])

  if (consulta === null || sugestoes.length === 0) return null

  return (
    <div className="stapp-mencao-popup" role="listbox">
      {sugestoes.map((entry, i) => (
        <button
          key={entry.user_id}
          type="button"
          role="option"
          aria-selected={i === ativo}
          className={`stapp-mencao-item ${i === ativo ? 'is-ativo' : ''}`}
          onMouseEnter={() => setAtivo(i)}
          onClick={() => onEscolher(entry.username)}
        >
          {entry.user_id === TODOS.user_id ? (
            <>
              <span className="stapp-mencao-todos">@</span>
              <span>everyone</span>
              <span className="stapp-mencao-dica">avisa todo mundo do canal</span>
            </>
          ) : (
            <>
              <Avatar
                userId={entry.user_id}
                className="stapp-mencao-avatar"
                fallbackName={entry.username}
              />
              <ProfileName userId={entry.user_id} fallbackName={entry.username} />
              <span className="stapp-mencao-dica">@{entry.username}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
})

/**
 * O `@` que o cursor esta editando agora, se houver.
 *
 * So conta quando o arroba abre uma palavra (inicio da linha ou depois de
 * espaco) — senao um e-mail no meio do texto abriria o popup.
 */
export function consultaDeMencao(texto: string, cursor: number): string | null {
  const antes = texto.slice(0, cursor)
  const arroba = antes.lastIndexOf('@')
  if (arroba === -1) return null

  const anterior = arroba === 0 ? ' ' : antes[arroba - 1]
  if (!/\s/.test(anterior)) return null

  const parcial = antes.slice(arroba + 1)
  // Espaco fecha a menção: o nome ja terminou.
  if (/[\s@]/.test(parcial)) return null
  return parcial
}

export type { UserId }
