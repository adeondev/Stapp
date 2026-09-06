import { useEffect, useRef, useState } from 'react'
import { ACCENTS, type AccentName, type Profile } from '../../protocol'
import { avatarUrl } from '../../net/avatars'
import { IconFileImage, IconTrash, IconUpload } from '../Icons'
import { UserProfileCard } from '../profile/UserProfileCard'
import {
  SettingsButton, SettingsDangerZone, SettingsField, SettingsGroup,
  SettingsRow, SettingsSection,
} from './primitives'
import './profileSettings.css'

/**
 * A edicao do proprio perfil.
 *
 * A tela anterior era um formulario num modal de 420px, com rotulos em
 * minusculas ("nome de exibição", "cor", "sobre você") e uma linha de previa que
 * **redesenhava o avatar por conta propria** em vez de usar `<Avatar>` — inclusive
 * com um `slice(0, 1)` que quebrava em nome comecando por emoji, coisa que o
 * `inicial()` do `Avatar` ja resolvia.
 *
 * Agora sao duas colunas: os campos a esquerda, e a direita o MESMO cartao que
 * as outras pessoas veem, ao vivo. Nao e uma maquete do cartao: e o
 * `UserProfileCard` de verdade, em `variant="preview"`. Se o cartao mudar, a
 * previa muda junto — nao ha como as duas divergirem.
 *
 * O que da para editar e exatamente o que o servidor guarda: avatar, banner,
 * cor, nome de exibicao e bio. `@username` e "Membro desde" aparecem so para
 * leitura porque sao mesmo imutaveis.
 */

const MAX_NAME = 32
const MAX_BIO = 190

/** Precisa bater com `--accent-<nome>` no theme.css e com `ACCENTS` no servidor. */
const NOME_DA_COR: Record<AccentName, string> = {
  blue: 'Azul', green: 'Verde', red: 'Vermelho',
  amber: 'Âmbar', purple: 'Roxo', cyan: 'Ciano',
}

export interface ProfileSettingsProps {
  profile: Profile
  avatarBase: string | null
  onSave(change: { display_name: string; accent: AccentName; bio: string }): void
  /** `null` remove a imagem e volta ao avatar gerado. */
  onAvatar(file: File | null): Promise<void>
  /** `null` remove o banner e volta a faixa de cor. */
  onBanner(file: File | null): Promise<void>
}

export function ProfileSettings({ profile, avatarBase, onSave, onAvatar, onBanner }: ProfileSettingsProps) {
  // Nome vazio nao e "sem nome": e "usa meu username". O campo comeca vazio
  // quando a pessoa nunca escolheu um, e o username fica de placeholder.
  const escolheu = profile.display_name !== profile.username
  const [nome, setNome] = useState(escolheu ? profile.display_name : '')
  const [accent, setAccent] = useState<AccentName>(profile.accent)
  const [bio, setBio] = useState(profile.bio)
  const [avatarNovo, setAvatarNovo] = useState<File | null>(null)
  const [bannerNovo, setBannerNovo] = useState<File | null>(null)
  const [removerAvatar, setRemoverAvatar] = useState(false)
  const [removerBanner, setRemoverBanner] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const seletorAvatar = useRef<HTMLInputElement>(null)
  const seletorBanner = useRef<HTMLInputElement>(null)

  // As previas locais sao object URLs; sem revogar, cada troca de arquivo vaza.
  const [previaAvatar, setPreviaAvatar] = useState<string | null>(null)
  const [previaBanner, setPreviaBanner] = useState<string | null>(null)
  useEffect(() => {
    if (!avatarNovo) return setPreviaAvatar(null)
    const url = URL.createObjectURL(avatarNovo)
    setPreviaAvatar(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarNovo])
  useEffect(() => {
    if (!bannerNovo) return setPreviaBanner(null)
    const url = URL.createObjectURL(bannerNovo)
    setPreviaBanner(url)
    return () => URL.revokeObjectURL(url)
  }, [bannerNovo])

  // Voltar aqui depois de salvar tem que mostrar o que esta salvo, nao o
  // rascunho abandonado da vez anterior.
  useEffect(() => {
    setNome(profile.display_name !== profile.username ? profile.display_name : '')
    setAccent(profile.accent)
    setBio(profile.bio)
    setAvatarNovo(null)
    setBannerNovo(null)
    setRemoverAvatar(false)
    setRemoverBanner(false)
    setErro(null)
  }, [profile])

  const sujo =
    nome.trim() !== (escolheu ? profile.display_name : '')
    || accent !== profile.accent
    || bio.trim() !== profile.bio
    || avatarNovo !== null
    || bannerNovo !== null
    || removerAvatar
    || removerBanner

  const temAvatarAtual = profile.has_avatar && avatarBase && !removerAvatar
  const avatarDaPrevia = previaAvatar
    ?? (temAvatarAtual ? avatarUrl(avatarBase, profile.user_id, profile.updated_at) : null)

  /* O cartao resolve o avatar pelo perfil vivo, entao a previa de um arquivo
     ainda nao enviado precisa entrar por um perfil de rascunho. `has_avatar:
     false` com previa local faz o cartao desenhar a inicial, o que estaria
     errado — por isso o rascunho carrega o object URL pelo `bannerPreview` e o
     avatar entra por cima com uma imagem propria na coluna da esquerda. */
  const rascunho: Profile = {
    ...profile,
    display_name: nome.trim() || profile.username,
    accent,
    bio: bio.trim(),
    has_avatar: Boolean(avatarDaPrevia),
    has_banner: Boolean(previaBanner) || (profile.has_banner && !removerBanner),
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault()
    setErro(null)

    // As imagens vao primeiro: se uma falhar, nada e salvo e a pessoa continua
    // com o que digitou na tela para tentar de novo.
    if (avatarNovo || removerAvatar || bannerNovo || removerBanner) {
      setEnviando(true)
      try {
        if (avatarNovo || removerAvatar) await onAvatar(avatarNovo)
        if (bannerNovo || removerBanner) await onBanner(bannerNovo)
      } catch (falha) {
        setEnviando(false)
        setErro(falha instanceof Error ? falha.message : 'não consegui enviar a imagem')
        return
      }
      setEnviando(false)
    }

    onSave({ display_name: nome.trim(), accent, bio: bio.trim() })
  }

  return (
    <form className="profile-settings" onSubmit={salvar}>
      <div className="profile-settings__form">
        <SettingsSection
          title="Identidade"
          description="É assim que as outras pessoas do servidor veem você. O username é o seu login e não muda."
        >
          <SettingsGroup title="Imagens">
            <input ref={seletorAvatar} type="file" hidden accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const escolhido = event.target.files?.[0] ?? null
                setAvatarNovo(escolhido)
                if (escolhido) setRemoverAvatar(false)
                setErro(null)
              }} />
            <input ref={seletorBanner} type="file" hidden accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const escolhido = event.target.files?.[0] ?? null
                setBannerNovo(escolhido)
                if (escolhido) setRemoverBanner(false)
                setErro(null)
              }} />

            <SettingsRow
              label="Avatar"
              description="Cortado em quadrado e reduzido para 256px. Até 2MB."
              control={
                <div className="profile-settings__imagem">
                  <span className="profile-settings__avatar" style={{
                    background: `var(--accent-${accent})`,
                    color: `var(--accent-${accent}-ink)`,
                  }}>
                    {avatarDaPrevia
                      ? <img className="avatar__img" src={avatarDaPrevia} alt="" />
                      : inicial(rascunho.display_name)}
                  </span>
                  <div className="profile-settings__imagem-acoes">
                    <SettingsButton icon={<IconUpload size={16} />} onClick={() => seletorAvatar.current?.click()}>
                      {avatarDaPrevia ? 'Trocar' : 'Escolher'}
                    </SettingsButton>
                    {avatarDaPrevia && (
                      <SettingsButton icon={<IconTrash size={16} />} onClick={() => {
                        setAvatarNovo(null)
                        setRemoverAvatar(true)
                        if (seletorAvatar.current) seletorAvatar.current.value = ''
                      }}>Remover</SettingsButton>
                    )}
                  </div>
                </div>
              }
            />

            <SettingsRow
              label="Banner"
              description="Cortado em 8:3 e reduzido para 960px. Sem imagem, vira uma faixa na sua cor. Até 4MB."
              control={
                <div className="profile-settings__imagem">
                  <span className="profile-settings__banner" style={{ background: `var(--accent-${accent})` }}>
                    {rascunho.has_banner && (previaBanner || avatarBase) && (
                      <img
                        className="profile-settings__banner-img"
                        src={previaBanner ?? `${avatarBase}/banners/${encodeURIComponent(profile.user_id)}?v=${profile.updated_at}`}
                        alt=""
                      />
                    )}
                  </span>
                  <div className="profile-settings__imagem-acoes">
                    <SettingsButton icon={<IconFileImage size={16} />} onClick={() => seletorBanner.current?.click()}>
                      {rascunho.has_banner ? 'Trocar' : 'Escolher'}
                    </SettingsButton>
                    {rascunho.has_banner && (
                      <SettingsButton icon={<IconTrash size={16} />} onClick={() => {
                        setBannerNovo(null)
                        setRemoverBanner(true)
                        if (seletorBanner.current) seletorBanner.current.value = ''
                      }}>Remover</SettingsButton>
                    )}
                  </div>
                </div>
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Nome e cor">
            <SettingsField
              label="Nome de exibição"
              description="Deixe vazio para usar o seu username."
              value={nome}
              onChange={setNome}
              placeholder={profile.username}
              maxLength={MAX_NAME}
              hint={<>Entra em <strong>@{profile.username}</strong> em todo o servidor.</>}
            />

            <SettingsRow
              label="Cor de destaque"
              description="Pinta o seu avatar gerado, o banner padrão e o realce do seu nome."
              stacked
              control={
                <div className="profile-settings__cores" role="radiogroup" aria-label="Cor do perfil">
                  {ACCENTS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      role="radio"
                      aria-checked={cor === accent}
                      aria-label={NOME_DA_COR[cor]}
                      title={NOME_DA_COR[cor]}
                      className={`profile-settings__cor ${cor === accent ? 'is-active' : ''}`}
                      style={{ background: `var(--accent-${cor})` }}
                      onClick={() => setAccent(cor)}
                    />
                  ))}
                </div>
              }
            />

            <SettingsField
              label="Sobre você"
              value={bio}
              onChange={setBio}
              maxLength={MAX_BIO}
              multiline
              placeholder="Uma linha sobre você — aparece no seu cartão de perfil."
            />
          </SettingsGroup>

          <SettingsGroup title="Conta">
            <SettingsRow label="Username" description="É o seu login neste servidor e não pode ser alterado."
              control={<span className="profile-settings__leitura">@{profile.username}</span>} />
            {profile.created_at > 0 && (
              <SettingsRow label="Membro desde"
                control={<span className="profile-settings__leitura">
                  {new Date(profile.created_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>} />
            )}
          </SettingsGroup>

          {erro && (
            <SettingsDangerZone title="Não consegui salvar" description={erro}>
              <SettingsButton onClick={() => setErro(null)}>Entendi</SettingsButton>
            </SettingsDangerZone>
          )}
        </SettingsSection>
      </div>

      <aside className="profile-settings__preview" aria-label="Prévia do seu perfil">
        <h2>Prévia</h2>
        <p>Exatamente o que as outras pessoas veem ao clicar em você.</p>
        <UserProfileCard
          userId={profile.user_id}
          variant="preview"
          profileOverride={rascunho}
          avatarBase={avatarBase}
          bannerPreview={previaBanner}
          isSelf
          online
        />
      </aside>

      {/* A barra so aparece com algo para salvar — e a mesma ideia do Discord:
          nada de um botao "salvar" permanentemente aceso sem alteracao nenhuma. */}
      {sujo && (
        <div className="profile-settings__barra" role="status">
          <span>Você tem alterações não salvas.</span>
          <div>
            <SettingsButton onClick={() => {
              setNome(escolheu ? profile.display_name : '')
              setAccent(profile.accent)
              setBio(profile.bio)
              setAvatarNovo(null)
              setBannerNovo(null)
              setRemoverAvatar(false)
              setRemoverBanner(false)
              setErro(null)
            }}>Descartar</SettingsButton>
            <SettingsButton type="submit" tone="primary" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Salvar alterações'}
            </SettingsButton>
          </div>
        </div>
      )}
    </form>
  )
}

/** A primeira letra de verdade — nome que comeca com emoji nao vira quadrado. */
function inicial(nome: string): string {
  const letra = [...nome].find((caractere) => /\p{L}|\p{N}/u.test(caractere))
  return (letra ?? nome[0] ?? '?').toUpperCase()
}
