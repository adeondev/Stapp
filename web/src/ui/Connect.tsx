import { useEffect, useState } from 'react'
import { defaultServerUrl, isSecureAuthUrl, type ConnectionStatus } from '../net/connection'
import type { AuthMode } from '../protocol'
import './connect.css'

export interface AuthInfo {
  serverName: string
  registrationEnabled: boolean
}

const STORAGE_URL = 'stapp.url'
const usernameStorageKey = (url: string) => `stapp.username:${url}`

interface Props {
  serverUrl: string | null
  authInfo: AuthInfo | null
  status: ConnectionStatus
  busy: boolean
  error: string | null
  onChooseServer(url: string): void
  onAuthenticate(mode: AuthMode, username: string, password: string): void
  onBack(): void
}

export function Connect({
  serverUrl,
  authInfo,
  status,
  busy,
  error,
  onChooseServer,
  onAuthenticate,
  onBack,
}: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_URL) ?? defaultServerUrl())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!serverUrl) return
    setUsername(localStorage.getItem(usernameStorageKey(serverUrl)) ?? '')
    setPassword('')
    setConfirmation('')
    setMode('login')
    setLocalError(null)
  }, [serverUrl])

  function chooseServer(event: React.FormEvent) {
    event.preventDefault()
    const target = url.trim()
    if (!target) return
    if (!isSecureAuthUrl(target)) {
      setLocalError('use wss:// ou ws://localhost para proteger sua senha')
      return
    }
    localStorage.setItem(STORAGE_URL, target)
    setLocalError(null)
    onChooseServer(target)
  }

  function authenticate(event: React.FormEvent) {
    event.preventDefault()
    const cleanUsername = username.trim()
    if (!cleanUsername || !password) return
    if (mode === 'register' && password !== confirmation) {
      setLocalError('as senhas nao conferem')
      return
    }
    if (mode === 'register' && password.length < 12) {
      setLocalError('a senha precisa ter pelo menos 12 caracteres')
      return
    }
    setLocalError(null)
    onAuthenticate(mode, cleanUsername, password)
  }

  const shownError = localError ?? error

  return (
    <main className="connect">
      <section className="connect__card" aria-labelledby="connect-title">
        <h1 id="connect-title" className="connect__title">
          {authInfo?.serverName ?? 'Stapp'}
        </h1>
        <p className="connect__sub">
          {serverUrl
            ? authInfo
              ? 'sua conta pertence somente a este servidor'
              : status === 'reconnecting'
                ? 'tentando alcançar este servidor novamente'
                : 'conferindo o servidor'
            : 'conecte no servidor de quem voce confia'}
        </p>

        {!serverUrl ? (
          <form onSubmit={chooseServer} noValidate>
            <label className="connect__label" htmlFor="server-url">
              servidor
            </label>
            <input
              id="server-url"
              className="connect__field"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="wss://stapp.exemplo.com/ws"
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
            />
            {shownError && <p className="connect__error" role="alert">{shownError}</p>}
            <button className="connect__go" type="submit" disabled={!url.trim()}>
              continuar
            </button>
          </form>
        ) : authInfo ? (
          <form onSubmit={authenticate} noValidate>
            <label className="connect__label" htmlFor="username">
              username
            </label>
            <input
              id="username"
              className="connect__field"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="como voce entra aqui"
              minLength={3}
              maxLength={24}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />

            <label className="connect__label" htmlFor="password">
              senha
            </label>
            <input
              id="password"
              className="connect__field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />

            {mode === 'register' && (
              <>
                <label className="connect__label" htmlFor="password-confirmation">
                  repita a senha
                </label>
                <input
                  id="password-confirmation"
                  className="connect__field"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <p className="connect__hint">12 a 128 caracteres, sem regras de simbolos.</p>
              </>
            )}

            {shownError && <p className="connect__error" role="alert">{shownError}</p>}

            <button
              className="connect__go"
              type="submit"
              disabled={busy}
            >
              {busy ? 'autenticando...' : mode === 'login' ? 'entrar' : 'criar e entrar'}
            </button>

            {authInfo.registrationEnabled && (
              <button
                className="connect__switch"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode((current) => (current === 'login' ? 'register' : 'login'))
                  setPassword('')
                  setConfirmation('')
                  setLocalError(null)
                }}
              >
                {mode === 'login' ? 'criar uma conta neste servidor' : 'ja tenho uma conta'}
              </button>
            )}
          </form>
        ) : (
          <div className="connect__waiting" role="status">
            <span className="connect__pulse" />
            aguardando resposta
          </div>
        )}

        {serverUrl && (
          <button className="connect__back" type="button" onClick={onBack}>
            trocar servidor
          </button>
        )}
      </section>
    </main>
  )
}

export function rememberUsername(url: string, username: string) {
  localStorage.setItem(usernameStorageKey(url), username)
}
