import { useEffect, useRef, useState } from 'react'
import { avatarUrl } from '../net/avatars'
import { notificationSound } from '../net/notifications'
import { ACCENTS, type AccentName, type Profile } from '../protocol'
import { DEFAULT_VOICE_PREFERENCES, loadVoicePreferences, resetVoicePreferences, saveVoicePreferences, type VoicePreferences } from '../voice/preferences'
import { startMicrophoneTest } from '../voice/testMicrophone'
import type { MediaDeviceLists, VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import {
  IconCamera,
  IconCheck,
  IconEye,
  IconHeadphones,
  IconMic,
  IconMicOff,
  IconScreen,
  IconSpeaker,
  IconUser,
  IconX,
} from './Icons'
import { DropdownSelect } from './Menu'
import './settingsmodal.css'
import './voicesettings.css'

export type SettingsTab = 'account' | 'voice' | 'appearance' | 'notifications'

export interface SettingsModalProps {
  isOpen: boolean
  initialTab?: SettingsTab
  onClose(): void
  // Conta
  profile: Profile | null
  avatarBase: string | null
  onSaveProfile?(change: { display_name: string; accent: AccentName; bio: string }): void
  onAvatarChange?(file: File | null): Promise<void>
  // Voz & Vídeo (opcional se não estiver em chamada ativa)
  transport?: VoiceTransport | null
  snapshot?: VoiceSnapshot | null
  voicePreferences?: VoicePreferences
  onVoicePreferencesChange?(preferences: VoicePreferences): void
}

const EMPTY_DEVICES: MediaDeviceLists = { inputs: [], outputs: [], cameras: [] }
const MAX_NAME = 32
const MAX_BIO = 190

export function SettingsModal({
  isOpen,
  initialTab = 'account',
  onClose,
  profile,
  avatarBase,
  onSaveProfile,
  onAvatarChange,
  transport,
  snapshot,
  voicePreferences,
  onVoicePreferencesChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="settingsmodal__scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="settingsmodal" role="dialog" aria-modal="true" aria-labelledby="settingsmodal-heading">
        {/* Sidebar Lateral de Navegação */}
        <aside className="settingsmodal__sidebar">
          <span className="settingsmodal__nav-title">Configurações</span>
          <nav className="settingsmodal__nav-list">
            <button
              type="button"
              className={`settingsmodal__tab-btn ${activeTab === 'account' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('account')}
            >
              <IconUser size={18} />
              <span>Minha Conta</span>
            </button>
            <button
              type="button"
              className={`settingsmodal__tab-btn ${activeTab === 'voice' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('voice')}
            >
              <IconMic size={18} />
              <span>Voz & Vídeo</span>
            </button>
            <button
              type="button"
              className={`settingsmodal__tab-btn ${activeTab === 'appearance' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              <IconEye size={18} />
              <span>Aparência</span>
            </button>
            <button
              type="button"
              className={`settingsmodal__tab-btn ${activeTab === 'notifications' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('notifications')}
            >
              <IconSpeaker size={18} />
              <span>Notificações & Sons</span>
            </button>
          </nav>
          <div className="settingsmodal__sidebar-footer">
            <span className="settingsmodal__version">Stapp Desktop v0.1.0-beta.5</span>
          </div>
        </aside>

        {/* Conteúdo Principal */}
        <main className="settingsmodal__main">
          <header className="settingsmodal__header">
            <div className="settingsmodal__title-wrap">
              <h2 id="settingsmodal-heading">
                {activeTab === 'account' && 'Minha Conta'}
                {activeTab === 'voice' && 'Voz & Vídeo'}
                {activeTab === 'appearance' && 'Aparência & Temas'}
                {activeTab === 'notifications' && 'Notificações & Sons'}
              </h2>
              <p>
                {activeTab === 'account' && 'Personalize seu perfil, cor de destaque e foto pública.'}
                {activeTab === 'voice' && 'Configure dispositivos de entrada, sensibilidade e qualidade de transmissão.'}
                {activeTab === 'appearance' && 'Tokens de design do Stapp e princípios de interface flat.'}
                {activeTab === 'notifications' && 'Gerencie volume de reprodução e permissão de alertas de desktop.'}
              </p>
            </div>
            <div className="settingsmodal__close-wrap">
              <button
                type="button"
                className="settingsmodal__close-btn"
                onClick={onClose}
                aria-label="Fechar configurações"
              >
                <IconX size={16} />
              </button>
              <span className="settingsmodal__esc-badge">ESC</span>
            </div>
          </header>

          <div className="settingsmodal__content">
            {activeTab === 'account' && (
              <AccountTab
                profile={profile}
                avatarBase={avatarBase}
                onSave={onSaveProfile}
                onAvatar={onAvatarChange}
              />
            )}

            {activeTab === 'voice' && (
              <VoiceTab
                transport={transport}
                snapshot={snapshot}
                externalPreferences={voicePreferences}
                onPreferencesChange={onVoicePreferencesChange}
              />
            )}

            {activeTab === 'appearance' && <AppearanceTab />}

            {activeTab === 'notifications' && <NotificationsTab />}
          </div>
        </main>
      </div>
    </div>
  )
}

/* ==========================================================================
   Aba 1: Minha Conta
   ========================================================================== */
interface AccountTabProps {
  profile: Profile | null
  avatarBase: string | null
  onSave?(change: { display_name: string; accent: AccentName; bio: string }): void
  onAvatar?(file: File | null): Promise<void>
}

function AccountTab({ profile, avatarBase, onSave, onAvatar }: AccountTabProps) {
  const chosenName = profile ? profile.display_name !== profile.username : false
  const [name, setName] = useState(chosenName ? (profile?.display_name ?? '') : '')
  const [accent, setAccent] = useState<AccentName>(profile?.accent ?? 'green')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!profile) return
    const chosen = profile.display_name !== profile.username
    setName(chosen ? profile.display_name : '')
    setAccent(profile.accent)
    setBio(profile.bio)
    setAvatarFile(null)
    setRemovePhoto(false)
    setError(null)
    setSavedSuccess(false)
  }, [profile])

  useEffect(() => {
    if (!avatarFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(avatarFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  const copyUserId = async () => {
    if (!profile?.user_id) return
    try {
      await navigator.clipboard.writeText(profile.user_id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    } catch {
      // Ignora falha de clipboard se restrito
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setSavedSuccess(false)

    if (avatarFile || removePhoto) {
      if (!onAvatar) {
        setError('O servidor não suporta alteração de foto de perfil no momento.')
        return
      }
      setSaving(true)
      try {
        await onAvatar(avatarFile)
      } catch (err) {
        setSaving(false)
        setError(err instanceof Error ? err.message : 'Falha ao atualizar foto.')
        return
      }
      setSaving(false)
    }

    onSave?.({
      display_name: name.trim() || profile.username,
      accent,
      bio: bio.trim(),
    })
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 3000)
  }

  if (!profile) {
    return (
      <div className="settingsmodal__card">
        <p className="settingsmodal__row-desc">Conecte-se a uma conta para gerenciar seu perfil.</p>
      </div>
    )
  }

  const currentHasPhoto = profile.has_avatar && avatarBase && !removePhoto
  const effectivePhoto = previewUrl ?? (currentHasPhoto ? avatarUrl(avatarBase, profile.user_id, profile.updated_at) : null)
  const displayNamePreview = name.trim() || profile.username

  return (
    <form className="settingsmodal__section" onSubmit={handleSave}>
      <div className="settingsmodal__profile-banner">
        <div
          className="settingsmodal__profile-avatar-wrap"
          style={
            {
              '--avatar-accent': `var(--accent-${accent})`,
              '--avatar-ink': `var(--accent-${accent}-ink)`,
            } as React.CSSProperties
          }
        >
          {effectivePhoto ? (
            <img className="settingsmodal__profile-avatar" src={effectivePhoto} alt="" />
          ) : (
            <div
              className="settingsmodal__profile-avatar"
              style={{
                background: `var(--accent-${accent})`,
                color: `var(--accent-${accent}-ink, #fff)`,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                fontSize: 22,
              }}
            >
              {displayNamePreview.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <div className="settingsmodal__profile-info">
          <span className="settingsmodal__profile-name">{displayNamePreview}</span>
          <span className="settingsmodal__profile-username">@{profile.username}</span>
          <button
            type="button"
            className="settingsmodal__profile-id"
            onClick={copyUserId}
            title="Clique para copiar seu User ID"
          >
            <span>ID: {profile.user_id}</span>
            <span className="settingsmodal__copy-pill">{copiedId ? 'Copiado!' : 'Copiar'}</span>
          </button>
        </div>
      </div>

      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Foto de Perfil</span>
        <div className="settingsmodal__photo-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              setAvatarFile(file)
              if (file) setRemovePhoto(false)
              setError(null)
            }}
          />
          <button
            type="button"
            className="settingsmodal__btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {effectivePhoto ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {effectivePhoto && (
            <button
              type="button"
              className="settingsmodal__btn-secondary"
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setAvatarFile(null)
                setRemovePhoto(true)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              Remover
            </button>
          )}
        </div>
      </div>

      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Informações do Usuário</span>
        <div className="settingsmodal__form-grid">
          <div className="settingsmodal__field">
            <label htmlFor="settings-display-name">Nome de Exibição</label>
            <input
              id="settings-display-name"
              className="settingsmodal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={profile.username}
              maxLength={MAX_NAME}
            />
            <span className="settingsmodal__row-desc">
              Deixe vazio para usar @{profile.username}. O username é o seu identificador de login permanente.
            </span>
          </div>

          <div className="settingsmodal__field">
            <label>Cor de Destaque</label>
            <div className="settingsmodal__accents-picker" role="radiogroup" aria-label="Cor do perfil">
              {ACCENTS.map((cor) => (
                <button
                  key={cor}
                  type="button"
                  role="radio"
                  aria-checked={cor === accent}
                  aria-label={cor}
                  className={`settingsmodal__accent-btn ${cor === accent ? 'is-selected' : ''}`}
                  style={{ background: `var(--accent-${cor})` }}
                  onClick={() => setAccent(cor)}
                />
              ))}
            </div>
          </div>

          <div className="settingsmodal__field">
            <label htmlFor="settings-bio">Sobre Você (Bio)</label>
            <textarea
              id="settings-bio"
              className="settingsmodal__textarea"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={MAX_BIO}
              rows={3}
            />
            <span className="settingsmodal__row-desc" style={{ textAlign: 'right' }}>
              {bio.length}/{MAX_BIO}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="voicesettings__insecure-banner" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="settingsmodal__actions-bar">
        {savedSuccess && (
          <span style={{ color: 'var(--status-online)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconCheck size={14} /> Alterações salvas!
          </span>
        )}
        <button type="submit" className="settingsmodal__btn-primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>
    </form>
  )
}

/* ==========================================================================
   Aba 2: Voz & Vídeo
   ========================================================================== */
interface VoiceTabProps {
  transport?: VoiceTransport | null
  snapshot?: VoiceSnapshot | null
  externalPreferences?: VoicePreferences
  onPreferencesChange?(preferences: VoicePreferences): void
}

function VoiceTab({
  transport,
  snapshot,
  externalPreferences,
  onPreferencesChange,
}: VoiceTabProps) {
  const [preferences, setPreferences] = useState<VoicePreferences>(() => {
    return externalPreferences ?? transport?.getPreferences() ?? loadVoicePreferences()
  })
  const [devices, setDevices] = useState<MediaDeviceLists>(EMPTY_DEVICES)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [testError, setTestError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)

  const isSecure = typeof window === 'undefined' || (window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia))

  // Carrega dispositivos
  useEffect(() => {
    if (transport) {
      void transport.enumerateDevices().then(setDevices).catch(() => setDevices(EMPTY_DEVICES))
    } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        setDevices({
          inputs: list.filter((d) => d.kind === 'audioinput'),
          outputs: list.filter((d) => d.kind === 'audiooutput'),
          cameras: list.filter((d) => d.kind === 'videoinput'),
        })
      }).catch(() => setDevices(EMPTY_DEVICES))
    }
  }, [transport])

  // Teste de microfone
  useEffect(() => {
    if (!testing) return
    let stop: (() => void) | undefined
    setTestError(null)

    if (transport) {
      void transport.startMicrophoneTest(setLevel).then((cleanup) => {
        stop = cleanup
      }).catch((err) => {
        setTesting(false)
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada pelo navegador.'
          : (err instanceof Error ? err.message : 'Não foi possível iniciar o teste de microfone.')
        setTestError(msg)
      })
    } else {
      const constraints: MediaTrackConstraints = preferences.inputDeviceId
        ? { deviceId: { exact: preferences.inputDeviceId } }
        : {}
      void startMicrophoneTest(constraints, setLevel).then((cleanup) => {
        stop = cleanup
      }).catch((err) => {
        setTesting(false)
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada pelo navegador.'
          : (err instanceof Error ? err.message : 'Não foi possível iniciar o teste de microfone.')
        setTestError(msg)
      })
    }

    return () => stop?.()
  }, [testing, transport, preferences.inputDeviceId])

  // Prévia da câmera
  useEffect(() => {
    const element = previewRef.current
    if (!previewing || !element) return
    let disposed = false
    let stop: (() => void) | undefined
    setPreviewError(null)

    if (transport) {
      void transport.startCameraPreview(element).then((cleanup) => {
        if (disposed) cleanup()
        else stop = cleanup
      }).catch(() => {
        if (!disposed) {
          setPreviewing(false)
          setPreviewError('Não foi possível abrir a câmera.')
        }
      })
    } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const constraints: MediaStreamConstraints = {
        video: preferences.cameraDeviceId ? { deviceId: { exact: preferences.cameraDeviceId } } : true,
      }
      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop())
        } else {
          element.srcObject = stream
          stop = () => {
            element.srcObject = null
            stream.getTracks().forEach((t) => t.stop())
          }
        }
      }).catch(() => {
        if (!disposed) {
          setPreviewing(false)
          setPreviewError('Não foi possível abrir a câmera.')
        }
      })
    }

    return () => {
      disposed = true
      stop?.()
    }
  }, [previewing, transport, preferences.cameraDeviceId])

  const update = <K extends keyof VoicePreferences>(key: K, value: VoicePreferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    saveVoicePreferences(next)
    onPreferencesChange?.(next)
    if (transport) {
      void transport.updatePreferences({ [key]: value })
    }
  }

  const handleReset = () => {
    const defaults = resetVoicePreferences()
    setPreferences(defaults)
    onPreferencesChange?.(defaults)
    if (transport) {
      void transport.updatePreferences({ ...DEFAULT_VOICE_PREFERENCES })
    }
  }

  return (
    <div className="settingsmodal__section">
      {!isSecure && (
        <div className="voicesettings__insecure-banner" role="alert">
          <IconMicOff size={18} />
          <div>
            <strong>Microfone e câmera bloqueados pelo navegador</strong>
            <p>
              Em conexões HTTP remotas, o navegador bloqueia dispositivos de mídia.
              Para usar voz e vídeo, conecte via HTTPS ou use o aplicativo Desktop (Tauri).
            </p>
          </div>
        </div>
      )}

      {/* Dispositivos de Entrada e Saída */}
      <section className="voicesettings__group">
        <h3><IconMic /> Dispositivos de Áudio</h3>
        <div className="voicesettings__columns">
          <DropdownSelect
            label="Microfone de Entrada"
            value={preferences.inputDeviceId}
            onChange={(val) => update('inputDeviceId', val)}
            options={[
              { value: '', label: 'Padrão do sistema', icon: <IconMic /> },
              ...devices.inputs.map((d, i) => ({
                value: d.deviceId,
                label: d.label || `Microfone ${i + 1}`,
                icon: <IconMic />,
              })),
            ]}
          />
          <DropdownSelect
            label="Dispositivo de Saída"
            value={preferences.outputDeviceId}
            onChange={(val) => update('outputDeviceId', val)}
            options={[
              { value: '', label: 'Padrão do sistema', icon: <IconHeadphones /> },
              ...devices.outputs.map((d, i) => ({
                value: d.deviceId,
                label: d.label || `Alto-falante ${i + 1}`,
                icon: <IconHeadphones />,
              })),
            ]}
          />
        </div>

        <label className="voicesettings__range">
          <span>Volume de entrada</span>
          <output>{preferences.inputVolume}%</output>
          <input
            type="range"
            min={0}
            max={200}
            value={preferences.inputVolume}
            onChange={(e) => update('inputVolume', Number(e.target.value))}
          />
        </label>

        <label className="voicesettings__range">
          <span>Volume de saída</span>
          <output>{preferences.outputVolume}%</output>
          <input
            type="range"
            min={0}
            max={200}
            value={preferences.outputVolume}
            onChange={(e) => update('outputVolume', Number(e.target.value))}
          />
        </label>

        <button
          type="button"
          className={`voicesettings__test ${testing ? 'is-active' : ''}`}
          onClick={() => setTesting((val) => !val)}
        >
          {testing ? 'Parar teste do microfone' : 'Testar microfone'}
        </button>
        {testError && <span className="voicesettings__test-error" role="status">{testError}</span>}
        <div className="voicesettings__meter" aria-label={`nível do microfone ${Math.round(level * 100)}%`}>
          <span style={{ width: `${level * 100}%` }} />
        </div>
      </section>

      {/* Modo de Entrada e Processamento */}
      <section className="voicesettings__group">
        <h3><IconMic /> Modo de Entrada e Processamento</h3>
        <div className="voicesettings__choice" role="group" aria-label="modo de entrada">
          <button
            type="button"
            className={preferences.inputMode === 'voice_activity' ? 'is-active' : ''}
            onClick={() => update('inputMode', 'voice_activity')}
          >
            <strong>Atividade de voz</strong>
            <small>O microfone abre automaticamente quando você fala.</small>
          </button>
          <button
            type="button"
            className={preferences.inputMode === 'push_to_talk' ? 'is-active' : ''}
            onClick={() => update('inputMode', 'push_to_talk')}
          >
            <strong>Push-to-Talk</strong>
            <small>{'__TAURI_INTERNALS__' in window ? 'Atalho global no aplicativo.' : 'Funciona com a janela em foco.'}</small>
          </button>
        </div>

        {preferences.inputMode === 'push_to_talk' && (
          <div className="voicesettings__columns">
            <label>
              Atalho
              <input
                value={preferences.pttShortcut}
                onChange={(e) => update('pttShortcut', e.target.value)}
              />
            </label>
            <label className="voicesettings__range">
              <span>Atraso ao soltar</span>
              <output>{preferences.pttReleaseDelay} ms</output>
              <input
                type="range"
                min={0}
                max={2000}
                value={preferences.pttReleaseDelay}
                onChange={(e) => update('pttReleaseDelay', Number(e.target.value))}
              />
            </label>
          </div>
        )}

        <label className="voicesettings__toggle">
          <span>
            <strong>Sensibilidade automática</strong>
            <small>Ajusta o limiar de atividade de voz de acordo com o ambiente.</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.automaticSensitivity}
            onChange={(e) => update('automaticSensitivity', e.target.checked)}
          />
        </label>

        {!preferences.automaticSensitivity && (
          <label className="voicesettings__range">
            <span>Sensibilidade</span>
            <output>{preferences.sensitivity} dB</output>
            <input
              type="range"
              min={-100}
              max={0}
              value={preferences.sensitivity}
              onChange={(e) => update('sensitivity', Number(e.target.value))}
            />
          </label>
        )}

        <label className="voicesettings__toggle">
          <span>
            <strong>Cancelamento de eco</strong>
            <small>Reduz o som dos alto-falantes retornando ao microfone.</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.echoCancellation}
            onChange={(e) => update('echoCancellation', e.target.checked)}
          />
        </label>

        <label className="voicesettings__toggle">
          <span>
            <strong>Controle de ganho automático</strong>
            <small>Mantém o nível da sua voz consistente.</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.autoGainControl}
            onChange={(e) => update('autoGainControl', e.target.checked)}
          />
        </label>

        <div className="voicesettings__noise">
          <span>Supressão de ruído</span>
          <div>
            {(['off', 'standard', 'enhanced'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={preferences.noiseMode === mode ? 'is-active' : ''}
                onClick={() => update('noiseMode', mode)}
              >
                {({ off: 'Desligado', standard: 'Padrão', enhanced: 'RNNoise' })[mode]}
              </button>
            ))}
          </div>
          <small>RNNoise roda localmente em WASM; nenhum dado sai da sua máquina.</small>
          {preferences.noiseMode === 'enhanced' && snapshot && <ProcessorStatus snapshot={snapshot} />}
        </div>
      </section>

      {/* Câmera */}
      <section className="voicesettings__group">
        <h3><IconCamera /> Câmera</h3>
        <DropdownSelect
          label="Câmera de Vídeo"
          value={preferences.cameraDeviceId}
          onChange={(val) => update('cameraDeviceId', val)}
          options={[
            { value: '', label: 'Padrão do sistema', icon: <IconCamera /> },
            ...devices.cameras.map((d, i) => ({
              value: d.deviceId,
              label: d.label || `Câmera ${i + 1}`,
              icon: <IconCamera />,
            })),
          ]}
        />

        <div className="voicesettings__choice">
          <button
            type="button"
            className={preferences.cameraQuality === '720p' ? 'is-active' : ''}
            onClick={() => update('cameraQuality', '720p')}
          >
            <strong>720p / 30 FPS</strong>
            <small>Padrão e econômico.</small>
          </button>
          <button
            type="button"
            className={preferences.cameraQuality === '1080p' ? 'is-active' : ''}
            onClick={() => update('cameraQuality', '1080p')}
          >
            <strong>1080p / 30 FPS</strong>
            <small>Mais nítido para chamadas de alta fidelidade.</small>
          </button>
        </div>

        <button
          type="button"
          className={`voicesettings__test ${previewing ? 'is-active' : ''}`}
          onClick={() => setPreviewing((v) => !v)}
        >
          {previewing ? 'Fechar prévia da câmera' : 'Testar câmera'}
        </button>

        <div className={`voicesettings__camera-preview ${previewing ? 'is-visible' : ''} ${preferences.mirrorPreview ? 'is-mirrored' : ''}`}>
          <video ref={previewRef} autoPlay muted playsInline aria-label="Prévia local da câmera" />
        </div>
        {previewError && <span className="voicesettings__preview-error" role="status">{previewError}</span>}

        <label className="voicesettings__toggle">
          <span>
            <strong>Espelhar minha prévia</strong>
            <small>Inverte a imagem apenas para você; outros verão normalmente.</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.mirrorPreview}
            onChange={(e) => update('mirrorPreview', e.target.checked)}
          />
        </label>
      </section>

      {/* Transmissão */}
      <section className="voicesettings__group">
        <h3><IconScreen /> Transmissão de Tela</h3>
        <DropdownSelect
          label="Qualidade padrão de captura"
          value={preferences.screenPreset}
          onChange={(val) => update('screenPreset', val as VoicePreferences['screenPreset'])}
          options={[
            { value: 'economy', label: 'Econômico', detail: '720p · 15 FPS', icon: <IconScreen /> },
            { value: 'balanced', label: 'Equilibrado', detail: '1080p · 30 FPS', icon: <IconScreen /> },
            { value: 'fluid', label: 'Fluido', detail: '720p · até 60 FPS', icon: <IconScreen /> },
            { value: 'original', label: 'Original', detail: 'Resolução original', icon: <IconScreen /> },
          ]}
        />
        <label className="voicesettings__toggle">
          <span>
            <strong>Capturar áudio do sistema por padrão</strong>
            <small>Loopback WASAPI com exclusão automática de áudio da chamada.</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.shareAudio}
            onChange={(e) => update('shareAudio', e.target.checked)}
          />
        </label>
      </section>

      <button type="button" className="voicesettings__reset" onClick={handleReset}>
        Redefinir opções de voz e vídeo
      </button>
    </div>
  )
}

/* ==========================================================================
   Aba 3: Aparência
   ========================================================================== */
function AppearanceTab() {
  const tokens = [
    { name: '--bg-app', label: 'Superfície Base', desc: 'Fundo da janela e chat' },
    { name: '--bg-sidebar', label: 'Barra Lateral', desc: 'Canais e servidores' },
    { name: '--bg-surface', label: 'Superfície Média', desc: 'Painéis e listas' },
    { name: '--bg-raised', label: 'Superfície Elevada', desc: 'Cards e modais' },
    { name: '--bg-hover', label: 'Estado Hover', desc: 'Realce interativo' },
    { name: '--accent-brand', label: 'Destaque Primário', desc: 'Identidade visual' },
    { name: '--status-online', label: 'Status Online', desc: 'Presença conectada' },
    { name: '--status-offline', label: 'Status Offline', desc: 'Presença desconectada' },
  ]

  return (
    <div className="settingsmodal__section">
      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Design System & Princípios</span>
        <p className="settingsmodal__row-desc" style={{ fontSize: 13, lineHeight: 1.5 }}>
          O Stapp adota <strong>flat design estrito</strong>: superfícies sólidas, separação tonal limpa e zero
          sombras artificiais (<code>box-shadow</code>). O contraste é construído por meio de camadas de cores
          semânticas padronizadas.
        </p>
      </div>

      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Tokens Semânticos de Superfície</span>
        <div className="settingsmodal__tokens-grid">
          {tokens.map((token) => (
            <div key={token.name} className="settingsmodal__token-chip">
              <div className="settingsmodal__token-color" style={{ background: `var(${token.name})` }} />
              <div className="settingsmodal__token-meta">
                <span className="settingsmodal__token-name">{token.name}</span>
                <span className="settingsmodal__token-desc">{token.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Demonstração de Componente Flat</span>
        <div className="settingsmodal__preview-box">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--accent-brand)',
                  color: 'var(--on-accent)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                S
              </div>
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>Stapp Interface</strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Card sem elevação simulada</span>
              </div>
            </div>
            <span className="settingsmodal__status-badge is-granted">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              Online
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Aba 4: Notificações & Sons
   ========================================================================== */
function NotificationsTab() {
  const [soundVolume, setSoundVolume] = useState(() => Math.round(notificationSound.getBaseVolume() * 100))
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  })

  const handleVolumeChange = (volPercent: number) => {
    setSoundVolume(volPercent)
    notificationSound.setBaseVolume(volPercent / 100)
  }

  const handleTestSound = () => {
    notificationSound.play()
  }

  const handleRequestPermission = async () => {
    if (typeof Notification === 'undefined') return
    try {
      const perm = await Notification.requestPermission()
      setPermissionStatus(perm)
    } catch {
      // Ignora erro
    }
  }

  const handleTestNotification = () => {
    if (typeof Notification === 'undefined' || permissionStatus !== 'granted') return
    try {
      new Notification('Stapp', {
        body: 'Esta é uma notificação de teste do Stapp!',
        silent: true,
      })
    } catch {
      // Ignora erro
    }
  }

  return (
    <div className="settingsmodal__section">
      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Sons do Aplicativo</span>
        <div className="settingsmodal__row">
          <div className="settingsmodal__row-info">
            <span className="settingsmodal__row-title">Volume de Notificações</span>
            <span className="settingsmodal__row-desc">
              Ajusta o nível de reprodução de mensagens diretas, menções e chamadas.
            </span>
          </div>
          <div className="settingsmodal__range-wrap">
            <input
              type="range"
              min={0}
              max={100}
              value={soundVolume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="settingsmodal__range-slider"
            />
            <span className="settingsmodal__range-val">{soundVolume}%</span>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="settingsmodal__btn-secondary"
            onClick={handleTestSound}
          >
            Ouvir som de teste
          </button>
        </div>
      </div>

      <div className="settingsmodal__card">
        <span className="settingsmodal__section-title">Notificações Desktop</span>
        <div className="settingsmodal__row">
          <div className="settingsmodal__row-info">
            <span className="settingsmodal__row-title">Status de Permissão</span>
            <span className="settingsmodal__row-desc">
              Permite alertas na bandeja do sistema operacional quando o aplicativo estiver em segundo plano.
            </span>
          </div>
          <div>
            {permissionStatus === 'granted' && (
              <span className="settingsmodal__status-badge is-granted">Permitido</span>
            )}
            {permissionStatus === 'denied' && (
              <span className="settingsmodal__status-badge is-denied">Bloqueado</span>
            )}
            {permissionStatus === 'default' && (
              <span className="settingsmodal__status-badge is-default">Não solicitado</span>
            )}
            {permissionStatus === 'unsupported' && (
              <span className="settingsmodal__status-badge is-default">Não suportado</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
          {permissionStatus !== 'granted' && permissionStatus !== 'unsupported' && (
            <button
              type="button"
              className="settingsmodal__btn-primary"
              onClick={handleRequestPermission}
            >
              Solicitar permissão
            </button>
          )}
          {permissionStatus === 'granted' && (
            <button
              type="button"
              className="settingsmodal__btn-secondary"
              onClick={handleTestNotification}
            >
              Enviar notificação de teste
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProcessorStatus({ snapshot }: { snapshot: VoiceSnapshot }) {
  const processor = snapshot.audioProcessor
  if (processor.status === 'starting') {
    return <small className="voicesettings__processor-status">Iniciando RNNoise em 48 kHz…</small>
  }
  if (processor.status === 'active' && processor.effective === 'rnnoise') {
    return <small className="voicesettings__processor-status is-active">RNNoise ativo em 48 kHz.</small>
  }
  if (processor.status === 'fallback') {
    return (
      <small className="voicesettings__processor-status is-fallback">
        RNNoise indisponível nesta tentativa; supressão padrão ativa. Sua preferência foi mantida.
      </small>
    )
  }
  return null
}

