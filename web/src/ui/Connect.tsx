import { useEffect, useState } from 'react'
import { defaultServerUrl, isSecureAuthUrl, type ConnectionStatus } from '../net/connection'
import type { AuthMode } from '../protocol'
import { CRTWarp } from './CRTWarp'
import { IconCheck, IconStappLogo } from './Icons'
import './connect.css'

export interface AuthInfo {
  serverName: string
  registrationEnabled: boolean
  /** O servidor aceita senha sem TLS vinda desta conexao. */
  plaintextAuthAllowed: boolean
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
  const [rememberServer, setRememberServer] = useState(true)
  const [rememberUser, setRememberUser] = useState(true)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (!serverUrl) return
    setUsername(localStorage.getItem(usernameStorageKey(serverUrl)) ?? '')
    setPassword('')
    setConfirmation('')
    setMode('login')
    setLocalError(null)
    setShowHelp(false)
  }, [serverUrl])

  function chooseServer(event: React.FormEvent) {
    event.preventDefault()
    const target = url.trim()
    if (!target) return
    if (rememberServer) {
      localStorage.setItem(STORAGE_URL, target)
    } else {
      localStorage.removeItem(STORAGE_URL)
    }
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
    if (!rememberUser && serverUrl) {
      localStorage.removeItem(usernameStorageKey(serverUrl))
    }
    setLocalError(null)
    onAuthenticate(mode, cleanUsername, password)
  }

  const shownError = localError ?? error

  const title = !serverUrl
    ? 'Boas-vindas de volta!'
    : authInfo
      ? mode === 'login'
        ? 'Boas-vindas de volta!'
        : 'Criar uma conta'
      : 'Conectando...'

  const subtitle = !serverUrl
    ? 'Conecte-se a um servidor Stapp para começar a conversar.'
    : authInfo
      ? mode === 'login'
        ? `Estamos felizes em ver você! Conectado a ${authInfo.serverName}.`
        : `Informe seus dados para se cadastrar em ${authInfo.serverName}.`
      : status === 'reconnecting'
        ? 'Tentando restabelecer conexão com o servidor...'
        : 'Conferindo informações do servidor...'

  return (
    <main className="connect">
      <div className="connect__bg" aria-hidden="true">
        <CRTWarp color="#6980b8" backgroundColor="#15181d" scanlineStrength={0} noise={0} rgbShift={0} />
      </div>
      <section className="connect__card" aria-labelledby="connect-title">
        <header className="connect__header">
          <IconStappLogo size={48} className="connect__logo" />
          <h1 id="connect-title" className="connect__title">
            {title}
          </h1>
          <p className="connect__sub">{subtitle}</p>
        </header>

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

            <div className="connect__options">
              <label className="connect__checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberServer}
                  onChange={(e) => setRememberServer(e.target.checked)}
                  className="connect__checkbox-input"
                />
                <span
                  className={`connect__checkbox-box ${rememberServer ? 'is-checked' : ''}`}
                  aria-hidden="true"
                >
                  {rememberServer && <IconCheck size={11} />}
                </span>
                <span className="connect__checkbox-text">Lembrar servidor</span>
              </label>

              <button
                type="button"
                className="connect__link"
                onClick={() => setShowHelp((prev) => !prev)}
              >
                Não consegue conectar?
              </button>
            </div>

            {showHelp && (
              <div className="connect__help-box" role="region" aria-label="Ajuda de conexão">
                <div className="connect__help-title">Não consegue conectar?</div>
                <ul className="connect__help-list">
                  <li>Certifique-se de que o servidor Stapp está rodando na máquina destino.</li>
                  <li>Em rede local, utilize o formato <code>ws://IP:8787/ws</code>.</li>
                  <li>Na internet, use um proxy seguro com terminação TLS em <code>wss://</code>.</li>
                  <li>Verifique se a porta <code>8787</code> não está bloqueada pelo firewall.</li>
                </ul>
                <button
                  type="button"
                  className="connect__help-close"
                  onClick={() => setShowHelp(false)}
                >
                  fechar
                </button>
              </div>
            )}

            {shownError && <p className="connect__error" role="alert">{shownError}</p>}

            <button className="connect__go" type="submit" disabled={!url.trim()}>
              Conectar
            </button>
          </form>
        ) : authInfo && !authInfo.plaintextAuthAllowed && !isSecureAuthUrl(serverUrl) ? (
          <div>
            <p className="connect__error" role="alert">
              este servidor nao aceita senha sem TLS vinda daqui. use um endereco
              wss:// ou peca para quem administra liberar esta rede.
            </p>
            <button className="connect__back" type="button" onClick={onBack}>
              trocar servidor
            </button>
          </div>
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
              placeholder="como você entra aqui"
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

            {!isSecureAuthUrl(serverUrl) && (
              <p className="connect__hint">
                este servidor liberou esta rede, mas a ligacao nao tem TLS — sua
                senha depende da rede ser confiavel.
              </p>
            )}

            <div className="connect__options">
              <label className="connect__checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberUser}
                  onChange={(e) => setRememberUser(e.target.checked)}
                  className="connect__checkbox-input"
                />
                <span
                  className={`connect__checkbox-box ${rememberUser ? 'is-checked' : ''}`}
                  aria-hidden="true"
                >
                  {rememberUser && <IconCheck size={11} />}
                </span>
                <span className="connect__checkbox-text">Lembrar usuário</span>
              </label>

              <button
                type="button"
                className="connect__link"
                onClick={() => setShowHelp((prev) => !prev)}
              >
                Não consegue conectar?
              </button>
            </div>

            {showHelp && (
              <div className="connect__help-box" role="region" aria-label="Ajuda de autenticação">
                <div className="connect__help-title">Dificuldade para autenticar?</div>
                <ul className="connect__help-list">
                  <li>Verifique se o nome de usuário foi digitado corretamente.</li>
                  <li>Contas pertencem unicamente a este servidor (não existe conta global).</li>
                  <li>Se esqueceu a senha, solicite a redefinição a quem administra o servidor.</li>
                </ul>
                <button
                  type="button"
                  className="connect__help-close"
                  onClick={() => setShowHelp(false)}
                >
                  fechar
                </button>
              </div>
            )}

            {shownError && <p className="connect__error" role="alert">{shownError}</p>}

            <button className="connect__go" type="submit" disabled={busy}>
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
