import { useState } from 'react'
import { defaultServerUrl } from '../net/connection'
import './connect.css'

export interface Session {
  url: string
  nick: string
}

const STORAGE_URL = 'stapp.url'
const STORAGE_NICK = 'stapp.nick'

interface Props {
  onConnect(session: Session): void
}

/** Tela de entrada: endereco do servidor e apelido. Nao existe cadastro. */
export function Connect({ onConnect }: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_URL) ?? defaultServerUrl())
  const [nick, setNick] = useState(() => localStorage.getItem(STORAGE_NICK) ?? '')

  const trimmedNick = nick.trim()
  const trimmedUrl = url.trim()
  const ready = trimmedNick.length > 0 && trimmedUrl.length > 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    localStorage.setItem(STORAGE_URL, trimmedUrl)
    localStorage.setItem(STORAGE_NICK, trimmedNick)
    onConnect({ url: trimmedUrl, nick: trimmedNick })
  }

  return (
    <div className="connect">
      <form className="connect__card" onSubmit={submit}>
        <h1 className="connect__title">Stapp</h1>
        <p className="connect__sub">entra no servidor e escolhe um apelido</p>

        <label className="connect__label" htmlFor="nick">
          apelido
        </label>
        <input
          id="nick"
          className="connect__field"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="como te chamam"
          maxLength={24}
          autoFocus
        />

        <label className="connect__label" htmlFor="url">
          servidor
        </label>
        <input
          id="url"
          className="connect__field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://localhost:8787/ws"
          spellCheck={false}
        />

        <button className="connect__go" type="submit" disabled={!ready}>
          entrar
        </button>
      </form>
    </div>
  )
}
