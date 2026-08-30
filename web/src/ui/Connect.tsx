import { useEffect, useState } from 'react'
import { canPersistSession } from '../net/auth'
import { defaultServerUrl, type ConnectionStatus } from '../net/connection'
import type { SavedServer } from '../net/servers'
import type { AuthMode } from '../protocol'
import { IconCheck, IconStappLogo } from './Icons'
import './connect.css'

export interface AuthInfo {
  serverId: string
  protocolVersion: number
  serverName: string
  registrationEnabled: boolean
  plaintextAuthAllowed: boolean
}

interface Props {
  serverUrl: string | null
  serverProfile: SavedServer | null
  savedServers: SavedServer[]
  authInfo: AuthInfo | null
  status: ConnectionStatus
  busy: boolean
  error: string | null
  onChooseServer(url: string, remember: boolean): void
  onSelectServer(server: SavedServer): void
  onRemoveServer(url: string): void
  onAuthenticate(mode: AuthMode, username: string, password: string, remember: boolean): void
  onBack(): void
}

export function Connect({ serverUrl, serverProfile, savedServers, authInfo, status, busy, error,
  onChooseServer, onSelectServer, onRemoveServer, onAuthenticate, onBack }: Props) {
  const [url, setUrl] = useState(defaultServerUrl)
  const [username, setUsername] = useState(serverProfile?.username ?? '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [localError, setLocalError] = useState<string | null>(null)
  const [rememberServer, setRememberServer] = useState(true)
  const [rememberUser, setRememberUser] = useState(true)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    setUsername(serverProfile?.username ?? '')
    setPassword('')
    setConfirmation('')
    setMode('login')
    setLocalError(null)
    setShowHelp(false)
    setRememberUser(serverUrl ? canPersistSession(serverUrl) : true)
  }, [serverProfile, serverUrl])

  const persistentAvailable = serverUrl ? canPersistSession(serverUrl) : false
  const shownError = localError ?? error
  const title = !serverUrl || mode === 'login' ? 'Boas-vindas de volta!' : 'Criar uma conta'
  const subtitle = !serverUrl
    ? 'Conecte-se a um servidor Stapp para começar a conversar.'
    : authInfo
      ? mode === 'login'
        ? `Estamos felizes em ver você! Conectado a ${authInfo.serverName}.`
        : `Sua conta existirá apenas em ${authInfo.serverName}.`
      : status === 'reconnecting'
        ? 'Tentando restabelecer a conexão com o servidor…'
        : 'Conferindo as informações do servidor…'

  function chooseServer(event: React.FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    setLocalError(null)
    onChooseServer(url, rememberServer)
  }

  function authenticate(event: React.FormEvent) {
    event.preventDefault()
    const cleanUsername = username.trim()
    if (!cleanUsername || !password) return
    if (mode === 'register' && password !== confirmation) return setLocalError('As senhas não conferem.')
    if (mode === 'register' && [...password].length < 12) return setLocalError('A senha precisa ter pelo menos 12 caracteres.')
    setLocalError(null)
    onAuthenticate(mode, cleanUsername, password, rememberUser && persistentAvailable)
    setPassword('')
    setConfirmation('')
  }

  return (
    <main className="connect">
      <div className="connect__bg" aria-hidden="true" />
      <section className="connect__card" aria-labelledby="connect-title">
        <header className="connect__header">
          <IconStappLogo size={48} className="connect__logo" />
          <h1 id="connect-title" className="connect__title">{title}</h1>
          <p className="connect__sub">{subtitle}</p>
          {serverUrl && authInfo && (
            <span className={`connect__security ${persistentAvailable ? 'is-secure' : ''}`}>
              {persistentAvailable ? 'Sessão protegida' : 'Sessão temporária'}
            </span>
          )}
        </header>

        {!serverUrl ? (
          <form onSubmit={chooseServer} noValidate>
            {savedServers.length > 0 && (
              <div className="connect__recent" aria-label="Servidores recentes">
                {savedServers.map((server) => (
                  <div className="connect__recent-row" key={server.url}>
                    <button className="connect__recent-main" type="button" onClick={() => onSelectServer(server)}>
                      <span className="connect__server-mark">{server.name.slice(0, 1).toUpperCase()}</span>
                      <span className="connect__server-copy"><strong>{server.name}</strong><small>{server.username || server.url}</small></span>
                    </button>
                    <button className="connect__recent-remove" type="button" onClick={() => onRemoveServer(server.url)}
                      aria-label={`Remover ${server.name}`}>×</button>
                  </div>
                ))}
              </div>
            )}

            <label className="connect__label" htmlFor="server-url">Servidor</label>
            <input id="server-url" className="connect__field" value={url}
              onChange={(event) => setUrl(event.target.value)} placeholder="wss://stapp.exemplo.com/ws"
              spellCheck={false} autoCapitalize="none" autoFocus />
            <div className="connect__options">
              <CheckOption checked={rememberServer} onChange={setRememberServer} label="Lembrar servidor" />
              <button type="button" className="connect__link" aria-expanded={showHelp}
                onClick={() => setShowHelp((value) => !value)}>Não consegue conectar?</button>
            </div>
            {showHelp && <ConnectionHelp />}
            {shownError && <p className="connect__error" role="alert">{shownError}</p>}
            <button className="connect__go" type="submit" disabled={!url.trim()}>Conectar</button>
          </form>
        ) : authInfo && !authInfo.plaintextAuthAllowed ? (
          <div>
            <p className="connect__error" role="alert">Este servidor exige HTTPS/WSS para receber credenciais desta rede.</p>
            <button className="connect__back" type="button" onClick={onBack}>Trocar servidor</button>
          </div>
        ) : authInfo ? (
          <form onSubmit={authenticate} noValidate>
            <label className="connect__label" htmlFor="username">Username</label>
            <input id="username" className="connect__field" value={username}
              onChange={(event) => setUsername(event.target.value)} placeholder="como você entra aqui"
              minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
            <label className="connect__label" htmlFor="password">Senha</label>
            <input id="password" className="connect__field" type="password" value={password}
              onChange={(event) => setPassword(event.target.value)} maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'register' && <>
              <label className="connect__label" htmlFor="password-confirmation">Repita a senha</label>
              <input id="password-confirmation" className="connect__field" type="password" value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} maxLength={128} autoComplete="new-password" />
              <p className="connect__hint">12 a 128 caracteres, sem regras artificiais de símbolos.</p>
            </>}
            <div className="connect__options">
              <CheckOption checked={rememberUser && persistentAvailable} onChange={setRememberUser}
                label="Lembrar usuário" disabled={!persistentAvailable} />
              <button type="button" className="connect__link" aria-expanded={showHelp}
                onClick={() => setShowHelp((value) => !value)}>Não consegue conectar?</button>
            </div>
            <p className="connect__hint">A senha nunca é salva.{!persistentAvailable && ' Sem HTTPS, esta sessão não será persistida.'}</p>
            {showHelp && <AuthHelp />}
            {shownError && <p className="connect__error" role="alert">{shownError}</p>}
            <button className="connect__go" type="submit" disabled={busy}>
              {busy ? 'Autenticando…' : mode === 'login' ? 'Entrar' : 'Criar e entrar'}
            </button>
            {authInfo.registrationEnabled && (
              <button className="connect__switch" type="button" disabled={busy} onClick={() => {
                setMode((current) => current === 'login' ? 'register' : 'login')
                setPassword(''); setConfirmation(''); setLocalError(null)
              }}>{mode === 'login' ? 'Criar uma conta neste servidor' : 'Já tenho uma conta'}</button>
            )}
          </form>
        ) : <div className="connect__waiting" role="status"><span className="connect__pulse" />Aguardando resposta</div>}

        {serverUrl && <button className="connect__back" type="button" onClick={onBack}>Trocar servidor</button>}
      </section>
    </main>
  )
}

function CheckOption({ checked, onChange, label, disabled = false }: {
  checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean
}) {
  return <label className={`connect__checkbox-label ${disabled ? 'is-disabled' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}
      className="connect__checkbox-input" />
    <span className={`connect__checkbox-box ${checked ? 'is-checked' : ''}`} aria-hidden="true">
      {checked && <IconCheck size={11} />}
    </span>
    <span>{label}</span>
  </label>
}

function ConnectionHelp() {
  return <div className="connect__help-box" role="region" aria-label="Ajuda de conexão">
    Confirme se o servidor está ligado. Na internet, use <code>wss://</code>. Em uma rede confiável,
    <code> ws://IP:8787/ws</code> funciona com sessão temporária.
  </div>
}

function AuthHelp() {
  return <div className="connect__help-box" role="region" aria-label="Ajuda de autenticação">
    A conta pertence somente a este servidor. Se perdeu a senha, peça a redefinição ao administrador.
  </div>
}
