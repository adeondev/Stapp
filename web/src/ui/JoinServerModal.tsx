import { useState } from 'react'
import { AuthApi, AuthApiError } from '../net/auth'
import { normalizeServerUrl, type SavedServer } from '../net/servers'
import type { AuthMode, AuthSession } from '../protocol'
import { IconEye, IconEyeOff, IconLock, IconServer, IconUser } from './Icons'
import { Modal, ModalBody, ModalFooter, ModalHeader } from './Overlay'
import './connect.css'

interface Props {
  open: boolean
  onClose(): void
  onSuccess(profile: SavedServer, session?: AuthSession): void
}

export function JoinServerModal({ open, onClose, onSuccess }: Props) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [rememberServer, setRememberServer] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setUrl('')
    setMode('login')
    setUsername('')
    setPassword('')
    setConfirmation('')
    setShowPassword(false)
    setShowConfirmation(false)
    setRememberServer(true)
    setBusy(false)
    setError(null)
  }

  const handleClose = () => {
    if (!busy) {
      resetForm()
      onClose()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!url.trim()) {
      setError('Informe o endereço do servidor.')
      return
    }

    let normalizedUrl = ''
    try {
      normalizedUrl = normalizeServerUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Endereço de servidor inválido.')
      return
    }

    const cleanUsername = username.trim()
    if (!cleanUsername) {
      setError('Informe seu nome de usuário.')
      return
    }

    if (!password) {
      setError('Informe sua senha.')
      return
    }

    if (mode === 'register') {
      if (password !== confirmation) {
        setError('As senhas não conferem.')
        return
      }
      if ([...password].length < 12) {
        setError('A senha precisa ter pelo menos 12 caracteres.')
        return
      }
    }

    setBusy(true)
    try {
      const api = new AuthApi(normalizedUrl)
      const session = await api.authenticate(mode, cleanUsername, password, rememberServer)

      let serverHost = normalizedUrl
      try {
        serverHost = new URL(normalizedUrl).host
      } catch { /* fallback */ }

      const newProfile: SavedServer = {
        url: normalizedUrl,
        name: serverHost,
        username: cleanUsername,
        lastUsed: Date.now(),
      }

      resetForm()
      onSuccess(newProfile, session)
    } catch (err) {
      setBusy(false)
      if (err instanceof AuthApiError && err.retryAfterMs) {
        setError(`${err.message} — tente novamente em ${Math.max(1, Math.ceil(err.retryAfterMs / 1000))}s`)
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível conectar ao servidor.')
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      label="Adicionar servidor"
      size="sm"
    >
      <form onSubmit={handleSubmit} noValidate>
        <ModalHeader
          title="Adicionar novo servidor"
          onClose={handleClose}
        />
        <ModalBody>
          {error && (
            <div className="connect__error" role="alert" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <label className="connect__label" htmlFor="join-server-url">
            Endereço do Servidor
          </label>
          <div className="connect__input-wrap">
            <span className="connect__input-icon" aria-hidden="true">
              <IconServer size={16} />
            </span>
            <input
              id="join-server-url"
              className="connect__field connect__field--with-icon"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="wss://stapp.exemplo.com/ws"
              disabled={busy}
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="serverrail__modal-btn"
              style={{
                flex: 1,
                background: mode === 'login' ? 'var(--accent)' : 'var(--modifier-hover)',
                color: mode === 'login' ? 'var(--on-accent)' : 'var(--text)',
              }}
              onClick={() => { setMode('login'); setError(null) }}
              disabled={busy}
            >
              Entrar
            </button>
            <button
              type="button"
              className="serverrail__modal-btn"
              style={{
                flex: 1,
                background: mode === 'register' ? 'var(--accent)' : 'var(--modifier-hover)',
                color: mode === 'register' ? 'var(--on-accent)' : 'var(--text)',
              }}
              onClick={() => { setMode('register'); setError(null) }}
              disabled={busy}
            >
              Criar conta
            </button>
          </div>

          <label className="connect__label" htmlFor="join-username">
            Nome de usuário
          </label>
          <div className="connect__input-wrap">
            <span className="connect__input-icon" aria-hidden="true">
              <IconUser size={16} />
            </span>
            <input
              id="join-username"
              className="connect__field connect__field--with-icon"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="seu_usuario"
              disabled={busy}
              spellCheck={false}
              autoCapitalize="none"
            />
          </div>

          <label className="connect__label" htmlFor="join-password">
            Senha
          </label>
          <div className="connect__input-wrap">
            <span className="connect__input-icon" aria-hidden="true">
              <IconLock size={16} />
            </span>
            <input
              id="join-password"
              type={showPassword ? 'text' : 'password'}
              className="connect__field connect__field--with-icon connect__field--with-action"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Mínimo de 12 caracteres' : 'Sua senha'}
              disabled={busy}
            />
            <button
              type="button"
              className="connect__input-action"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
              tabIndex={-1}
            >
              {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label className="connect__label" htmlFor="join-confirmation">
                Confirmar senha
              </label>
              <div className="connect__input-wrap">
                <span className="connect__input-icon" aria-hidden="true">
                  <IconLock size={16} />
                </span>
                <input
                  id="join-confirmation"
                  type={showConfirmation ? 'text' : 'password'}
                  className="connect__field connect__field--with-icon connect__field--with-action"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Repita sua senha"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="connect__input-action"
                  onClick={() => setShowConfirmation((v) => !v)}
                  aria-label={showConfirmation ? 'Ocultar confirmação' : 'Ver confirmação'}
                  tabIndex={-1}
                >
                  {showConfirmation ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={rememberServer}
              onChange={(e) => setRememberServer(e.target.checked)}
              disabled={busy}
            />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-soft)' }}>
              Lembrar este servidor na lista
            </span>
          </label>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="serverrail__modal-btn"
            onClick={handleClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="serverrail__modal-btn"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            disabled={busy}
          >
            {busy ? 'Conectando…' : mode === 'login' ? 'Conectar' : 'Criar e Conectar'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
