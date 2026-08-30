import { useEffect, useRef, useState } from 'react'
import { avatarUrl } from '../net/avatars'
import { ACCENTS, type AccentName, type Profile } from '../protocol'
import { IconX } from './Icons'
import './profileeditor.css'

interface Props {
  isOpen: boolean
  profile: Profile
  /** Base HTTP do servidor, para mostrar a foto atual. */
  avatarBase: string | null
  onClose(): void
  onSave(change: { display_name: string; accent: AccentName; bio: string }): void
  /** `null` remove a imagem e volta ao avatar gerado. */
  onAvatar(file: File | null): Promise<void>
}

const MAX_NAME = 32
const MAX_BIO = 190

export function ProfileEditor({
  isOpen,
  profile,
  avatarBase,
  onClose,
  onSave,
  onAvatar,
}: Props) {
  // O nome de exibicao comeca vazio quando a pessoa nunca escolheu um: o campo
  // mostra o username como placeholder, e deixar em branco continua significando
  // "usa meu username".
  const escolheu = profile.display_name !== profile.username
  const [nome, setNome] = useState(escolheu ? profile.display_name : '')
  const [accent, setAccent] = useState<AccentName>(profile.accent)
  const [bio, setBio] = useState(profile.bio)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [removerFoto, setRemoverFoto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const seletor = useRef<HTMLInputElement>(null)

  // A previa local e um object URL; sem revogar, cada troca de arquivo vaza.
  const [previaLocal, setPreviaLocal] = useState<string | null>(null)
  useEffect(() => {
    if (!arquivo) return setPreviaLocal(null)
    const url = URL.createObjectURL(arquivo)
    setPreviaLocal(url)
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  // Reabrir tem que mostrar o que esta salvo, nao o rascunho abandonado.
  useEffect(() => {
    if (!isOpen) return
    setNome(profile.display_name !== profile.username ? profile.display_name : '')
    setAccent(profile.accent)
    setBio(profile.bio)
    setArquivo(null)
    setRemoverFoto(false)
    setErro(null)
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

  async function salvar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)

    // A imagem vai primeiro: se ela falhar, nada e salvo e a pessoa continua
    // com o que digitou na tela para tentar de novo.
    if (arquivo || removerFoto) {
      setEnviando(true)
      try {
        await onAvatar(arquivo)
      } catch (falha) {
        setEnviando(false)
        setErro(falha instanceof Error ? falha.message : 'não consegui enviar a imagem')
        return
      }
      setEnviando(false)
    }

    onSave({ display_name: nome.trim(), accent, bio: bio.trim() })
    onClose()
  }

  const previa = nome.trim() || profile.username
  const temFotoAtual = profile.has_avatar && avatarBase && !removerFoto
  const fotoDaPrevia =
    previaLocal ??
    (temFotoAtual ? avatarUrl(avatarBase, profile.user_id, profile.updated_at) : null)

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
          <span className="profile-editor__avatar">
            {fotoDaPrevia ? (
              <img className="avatar__img" src={fotoDaPrevia} alt="" />
            ) : (
              previa.slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="profile-editor__identity">
            <span className="profile-editor__name">{previa}</span>
            <span className="profile-editor__handle">@{profile.username}</span>
          </div>
        </div>

        <div className="profile-editor__photo">
          <input
            ref={seletor}
            className="profile-editor__file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const escolhido = event.target.files?.[0] ?? null
              setArquivo(escolhido)
              if (escolhido) setRemoverFoto(false)
              setErro(null)
            }}
          />
          <button
            className="profile-editor__photo-action"
            type="button"
            onClick={() => seletor.current?.click()}
          >
            {fotoDaPrevia ? 'trocar foto' : 'escolher foto'}
          </button>
          {fotoDaPrevia && (
            <button
              className="profile-editor__photo-action is-remove"
              type="button"
              onClick={() => {
                setArquivo(null)
                setRemoverFoto(true)
                if (seletor.current) seletor.current.value = ''
              }}
            >
              remover
            </button>
          )}
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

        {erro && (
          <p className="profile-editor__erro" role="alert">
            {erro}
          </p>
        )}

        <button className="profile-editor__save" type="submit" disabled={enviando}>
          {enviando ? 'enviando...' : 'salvar'}
        </button>
      </form>
    </div>
  )
}
