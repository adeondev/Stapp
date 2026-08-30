import { useEffect, useState } from 'react'
import { ACCENTS, type AccentName, type Profile } from '../protocol'
import { IconX } from './Icons'
import './profileeditor.css'

interface Props {
  isOpen: boolean
  profile: Profile
  onClose(): void
  onSave(change: { display_name: string; accent: AccentName; bio: string }): void
}

const MAX_NAME = 32
const MAX_BIO = 190

export function ProfileEditor({ isOpen, profile, onClose, onSave }: Props) {
  // O nome de exibicao comeca vazio quando a pessoa nunca escolheu um: o campo
  // mostra o username como placeholder, e deixar em branco continua significando
  // "usa meu username".
  const escolheu = profile.display_name !== profile.username
  const [nome, setNome] = useState(escolheu ? profile.display_name : '')
  const [accent, setAccent] = useState<AccentName>(profile.accent)
  const [bio, setBio] = useState(profile.bio)

  // Reabrir tem que mostrar o que esta salvo, nao o rascunho abandonado.
  useEffect(() => {
    if (!isOpen) return
    setNome(profile.display_name !== profile.username ? profile.display_name : '')
    setAccent(profile.accent)
    setBio(profile.bio)
  }, [isOpen, profile])

  useEffect(() => {
    if (!isOpen) return
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [isOpen, onClose])

  if (!isOpen) return null

  function salvar(event: React.FormEvent) {
    event.preventDefault()
    onSave({ display_name: nome.trim(), accent, bio: bio.trim() })
    onClose()
  }

  const previa = nome.trim() || profile.username

  return (
    <div
      className="profile-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-editor-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form className="profile-editor__dialog" onSubmit={salvar}>
        <header className="profile-editor__head">
          <h2 id="profile-editor-title" className="profile-editor__title">
            seu perfil
          </h2>
          <button
            className="profile-editor__close"
            type="button"
            onClick={onClose}
            aria-label="fechar"
          >
            <IconX />
          </button>
        </header>

        <div
          className="profile-editor__preview"
          style={
            {
              '--avatar-accent': `var(--accent-${accent})`,
              '--avatar-ink': `var(--accent-${accent}-ink)`,
            } as React.CSSProperties
          }
        >
          <span className="profile-editor__avatar">{previa.slice(0, 1).toUpperCase()}</span>
          <div className="profile-editor__identity">
            <span className="profile-editor__name">{previa}</span>
            <span className="profile-editor__handle">@{profile.username}</span>
          </div>
        </div>

        <label className="profile-editor__label" htmlFor="profile-display-name">
          nome de exibição
        </label>
        <input
          id="profile-display-name"
          className="profile-editor__field"
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          placeholder={profile.username}
          maxLength={MAX_NAME}
        />
        <p className="profile-editor__hint">
          deixe vazio para usar @{profile.username}. o username é o seu login e não muda.
        </p>

        <span className="profile-editor__label">cor</span>
        <div className="profile-editor__accents" role="radiogroup" aria-label="cor do perfil">
          {ACCENTS.map((cor) => (
            <button
              key={cor}
              type="button"
              role="radio"
              aria-checked={cor === accent}
              aria-label={cor}
              className={`profile-editor__accent ${cor === accent ? 'is-active' : ''}`}
              style={{ background: `var(--accent-${cor})` }}
              onClick={() => setAccent(cor)}
            />
          ))}
        </div>

        <label className="profile-editor__label" htmlFor="profile-bio">
          sobre você
        </label>
        <textarea
          id="profile-bio"
          className="profile-editor__field profile-editor__bio"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={MAX_BIO}
          rows={3}
        />
        <p className="profile-editor__hint">
          {bio.length}/{MAX_BIO}
        </p>

        <button className="profile-editor__save" type="submit">
          salvar
        </button>
      </form>
    </div>
  )
}
