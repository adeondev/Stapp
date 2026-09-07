import { useEffect, useState } from 'react'
import type { AccentName, Profile } from '../../protocol'
import type { VoiceSnapshot, VoiceTransport } from '../../voice/VoiceTransport'
import type { VoicePreferences } from '../../voice/preferences'
import type { UserMenuUpdater } from '../UserMenu'
import {
  IconAccount, IconAlert, IconCamera, IconInfo, IconPalette, IconRefresh,
} from '../Icons'
import { SettingsShell, type SettingsGroupDef } from './SettingsShell'
import {
  SettingsButton, SettingsGroup, SettingsRow, SettingsSection,
  SettingsSegmented, SettingsToggle, SettingsUnavailable,
} from './primitives'
import {
  loadNotificationPreferences, saveNotificationPreferences,
  type NotificationPreferences,
} from './notificationPreferences'
import { ProfileSettings } from './ProfileSettings'
import { VoiceVideoSettings } from './VoiceVideoSettings'
import {
  applyMotionPreference, applyTheme, loadCustomThemeSettings,
  loadMotionPreference, loadThemePreference,
  type AppTheme, type CustomThemeSettings, type MotionPreference,
} from './appearance'

/**
 * As configuracoes do Stapp, montadas.
 *
 * Existe para o `App` nao precisar conhecer categoria por categoria: ele passa o
 * que tem (perfil, transporte, atualizador) e recebe a tela pronta.
 *
 * Duas coisas que mudaram de lugar e nao sao detalhe:
 *
 * - **A tela nao depende mais de haver voz.** Antes as configuracoes so eram
 *   montadas quando existia transporte (`{voice.current && <VoiceSettings/>}`),
 *   entao sem voz nao havia configuracao alcancavel nenhuma. Agora quem se
 *   desabilita — dizendo o motivo — e apenas a categoria de voz.
 * - **Atualizacoes sairam do menu de contexto do usuario.** Canal beta e
 *   "verificar atualizacoes" viviam no `UserMenu`, que e o menu de acoes sobre
 *   uma PESSOA. Nao e ali que se procura configuracao do aplicativo.
 */

export interface AppSettingsProps {
  open: boolean
  onClose(): void
  /** Categoria a abrir. Muda conforme de onde a tela foi chamada. */
  initialCategory?: string

  profile: Profile
  avatarBase: string | null
  onSaveProfile(change: { display_name: string; accent: AccentName; bio: string; banner_color: string }): void
  onAvatar(file: File | null): Promise<void>
  onBanner(file: File | null): Promise<void>

  /** `null` quando o servidor nao tem voz ou a sessao ainda nao subiu. */
  transport: VoiceTransport | null
  snapshot: VoiceSnapshot
  onPreferencesChange?(preferences: VoicePreferences): void
  /** Motivo de a voz estar indisponivel, quando estiver. */
  voiceUnavailable?: string

  updater: UserMenuUpdater & { currentVersion: string }
  serverName: string
  protocolVersion: number
}

export function AppSettings({
  open, onClose, initialCategory,
  profile, avatarBase, onSaveProfile, onAvatar, onBanner,
  transport, snapshot, onPreferencesChange, voiceUnavailable,
  updater, serverName, protocolVersion,
}: AppSettingsProps) {
  const grupos: SettingsGroupDef[] = [
    {
      title: 'Conta',
      categories: [
        {
          id: 'profile',
          label: 'Perfil',
          icon: <IconAccount size={16} />,
          render: () => (
            <ProfileSettings
              profile={profile}
              avatarBase={avatarBase}
              onSave={onSaveProfile}
              onAvatar={onAvatar}
              onBanner={onBanner}
            />
          ),
        },
      ],
    },
    {
      title: 'Aplicativo',
      categories: [
        {
          id: 'voice',
          label: 'Voz e vídeo',
          icon: <IconCamera size={16} />,
          disabledReason: transport ? undefined : (voiceUnavailable ?? 'A voz não está disponível neste servidor.'),
          render: () => transport
            ? (
              <VoiceVideoSettings
                transport={transport}
                snapshot={snapshot}
                onPreferencesChange={onPreferencesChange}
              />
            )
            : (
              <SettingsUnavailable title="Voz indisponível">
                {voiceUnavailable ?? 'A voz não está disponível neste servidor.'}
              </SettingsUnavailable>
            ),
        },
        {
          id: 'notifications',
          label: 'Notificações',
          icon: <IconAlert size={16} />,
          render: () => <NotificationSettings />,
        },
        {
          id: 'appearance',
          label: 'Aparência',
          icon: <IconPalette size={16} />,
          render: () => <AppearanceSettings />,
        },
        {
          id: 'updates',
          label: 'Atualizações',
          icon: <IconRefresh size={16} />,
          render: () => <UpdateSettings updater={updater} />,
        },
        {
          id: 'about',
          label: 'Sobre',
          icon: <IconInfo size={16} />,
          render: () => (
            <AboutSettings
              version={updater.currentVersion}
              serverName={serverName}
              protocolVersion={protocolVersion}
            />
          ),
        },
      ],
    },
  ]

  return <SettingsShell open={open} onClose={onClose} groups={grupos} initialCategory={initialCategory} />
}

interface ThemeOption {
  id: AppTheme
  name: string
  desc: string
  railBg: string
  sidebarBg: string
  chatBg: string
  textColor: string
  accentColor: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'onix',
    name: 'Ônix',
    desc: 'Preto absoluto OLED (#000000), alto contraste.',
    railBg: '#000000',
    sidebarBg: '#09090b',
    chatBg: '#141416',
    textColor: '#ffffff',
    accentColor: '#209cee',
  },
  {
    id: 'escuro',
    name: 'Escuro',
    desc: 'Paleta dark moderna (#121214), tom atual e refinado.',
    railBg: '#151518',
    sidebarBg: '#1a1a1e',
    chatBg: '#242429',
    textColor: '#f4f4f5',
    accentColor: '#209cee',
  },
  {
    id: 'cinza',
    name: 'Cinza Neutro',
    desc: 'Esquema suave balanceado (padrão do Stapp).',
    railBg: '#1a1b1e',
    sidebarBg: '#232428',
    chatBg: '#2f3035',
    textColor: '#f2f3f5',
    accentColor: '#209cee',
  },
  {
    id: 'claro',
    name: 'Claro',
    desc: 'Fundo branco limpo (#ffffff), texto escuro de alto contraste.',
    railBg: '#eceff2',
    sidebarBg: '#f2f4f7',
    chatBg: '#ffffff',
    textColor: '#060607',
    accentColor: '#209cee',
  },
  {
    id: 'personalizado',
    name: 'Personalizado',
    desc: 'Defina seu próprio tom de fundo e cor de destaque.',
    railBg: '#121224',
    sidebarBg: '#16162a',
    chatBg: '#1a1a2e',
    textColor: '#f2f3f5',
    accentColor: '#6366f1',
  },
]

/**
 * Notificacoes nativas do sistema operacional.
 *
 * A categoria existia e sumiu; enquanto isso as notificacoes continuaram
 * disparando sempre, sem interruptor nenhum. Os tres itens sao os tres unicos
 * disparos que o app faz hoje (`platform/notifications.ts`) — nada de opcao
 * para o que nao existe.
 *
 * A permissao em si nao e pedida daqui: quem pede e o primeiro disparo, e um
 * dialogo do sistema aberto por uma tela de configuracao, sem nada acontecendo,
 * e o tipo de pedido que as pessoas negam por reflexo.
 */
function NotificationSettings() {
  const [preferencias, setPreferencias] = useState<NotificationPreferences>(loadNotificationPreferences)

  const alternar = (chave: keyof NotificationPreferences, valor: boolean) => {
    const proximo = { ...preferencias, [chave]: valor }
    setPreferencias(proximo)
    saveNotificationPreferences(proximo)
  }

  const suportado = typeof window !== 'undefined'
    && ('__TAURI_INTERNALS__' in window || 'Notification' in window)

  return (
    <SettingsSection
      title="Notificações do sistema"
      description="Avisos fora da janela do Stapp. Só aparecem quando o aplicativo está minimizado, escondido na bandeja ou sem foco — com a janela na frente, o aviso é o próprio app."
    >
      {!suportado && (
        <SettingsUnavailable title="Este navegador não tem notificações nativas">
          As notificações do sistema operacional existem no aplicativo desktop e nos navegadores
          que implementam a API de notificação. Os sons e os marcadores dentro do Stapp continuam
          funcionando normalmente.
        </SettingsUnavailable>
      )}
      <SettingsGroup>
        <SettingsToggle
          checked={preferencias.calls}
          onChange={(valor) => alternar('calls', valor)}
          disabled={!suportado}
          label="Chamadas recebidas"
          description="Quando alguém te liga ou te chama para uma sala de voz."
        />
        <SettingsToggle
          checked={preferencias.directMessages}
          onChange={(valor) => alternar('directMessages', valor)}
          disabled={!suportado}
          label="Mensagens diretas"
          description="Cada mensagem nova numa conversa direta que você ainda não leu."
        />
        <SettingsToggle
          checked={preferencias.mentions}
          onChange={(valor) => alternar('mentions', valor)}
          disabled={!suportado}
          label="Menções"
          description="Quando alguém cita você com @ num canal, incluindo @everyone."
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function AppearanceSettings() {
  const [theme, setTheme] = useState<AppTheme>(loadThemePreference)
  const [custom, setCustom] = useState<CustomThemeSettings>(loadCustomThemeSettings)
  const [motion, setMotion] = useState<MotionPreference>(loadMotionPreference)

  useEffect(() => applyMotionPreference(motion), [motion])

  const selecionarTema = (novo: AppTheme) => {
    setTheme(novo)
    applyTheme(novo, custom)
  }

  const atualizarCustom = (patch: Partial<CustomThemeSettings>) => {
    const proximo = { ...custom, ...patch }
    setCustom(proximo)
    if (theme === 'personalizado') {
      applyTheme('personalizado', proximo)
    }
  }

  return (
    <>
      <SettingsSection
        title="Tema"
        description="Escolha o esquema de cores que melhor combina com seu ambiente ou crie sua própria paleta."
      >
        <div className="theme-picker__grid" role="radiogroup" aria-label="Temas do aplicativo">
          {THEME_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.id}
              role="radio"
              aria-checked={theme === opt.id}
              aria-label={`Selecionar tema ${opt.name}`}
              className={`theme-card ${theme === opt.id ? 'is-active' : ''}`}
              onClick={() => selecionarTema(opt.id)}
            >
              <div className="theme-card__mockup">
                <div
                  className="theme-card__mockup-rail"
                  style={{ backgroundColor: opt.id === 'personalizado' ? custom.bg : opt.railBg }}
                >
                  <span
                    className="theme-card__mockup-dot"
                    style={{ backgroundColor: opt.id === 'personalizado' ? custom.accent : opt.accentColor }}
                  />
                </div>
                <div
                  className="theme-card__mockup-sidebar"
                  style={{
                    backgroundColor: opt.id === 'personalizado'
                      ? `color-mix(in srgb, ${custom.bg} 90%, white 10%)`
                      : opt.sidebarBg,
                  }}
                >
                  <div
                    className="theme-card__mockup-line"
                    style={{ backgroundColor: opt.id === 'claro' ? '#d0d4dc' : 'rgba(255,255,255,0.2)' }}
                  />
                  <div
                    className="theme-card__mockup-line"
                    style={{ backgroundColor: opt.id === 'claro' ? '#d0d4dc' : 'rgba(255,255,255,0.2)', width: '60%' }}
                  />
                </div>
                <div
                  className="theme-card__mockup-chat"
                  style={{
                    backgroundColor: opt.id === 'personalizado'
                      ? `color-mix(in srgb, ${custom.bg} 80%, white 20%)`
                      : opt.chatBg,
                  }}
                >
                  <div
                    className="theme-card__mockup-bubble"
                    style={{ backgroundColor: opt.id === 'claro' ? '#e4e7ec' : 'rgba(255,255,255,0.1)' }}
                  >
                    <span
                      className="theme-card__mockup-text"
                      style={{ backgroundColor: opt.id === 'claro' ? '#747f8d' : 'rgba(255,255,255,0.4)' }}
                    />
                  </div>
                  <div
                    className="theme-card__mockup-pill"
                    style={{ backgroundColor: opt.id === 'personalizado' ? custom.accent : opt.accentColor }}
                  />
                </div>
              </div>
              <div className="theme-card__info">
                <div className="theme-card__header">
                  <strong className="theme-card__name">{opt.name}</strong>
                  {theme === opt.id && <span className="theme-card__badge-active">Ativo</span>}
                </div>
                <span className="theme-card__desc">{opt.desc}</span>
              </div>
            </button>
          ))}
        </div>

        {theme === 'personalizado' && (
          <SettingsGroup title="Cores personalizadas">
            <SettingsRow
              label="Tom de fundo"
              description="Cor base para o aplicativo e superfícies."
              control={
                <div className="profile-settings__banner-cor">
                  <input
                    type="color"
                    value={custom.bg}
                    onChange={(e) => atualizarCustom({ bg: e.target.value })}
                    className="profile-settings__color-input"
                    aria-label="Selecionar tom de fundo personalizado"
                  />
                  <input
                    type="text"
                    value={custom.bg}
                    onChange={(e) => atualizarCustom({ bg: e.target.value })}
                    maxLength={9}
                    className="profile-settings__hex-input"
                    aria-label="Código hexadecimal do tom de fundo"
                  />
                </div>
              }
            />
            <SettingsRow
              label="Destaque principal"
              description="Cor de destaque para botões, indicadores e badges."
              control={
                <div className="profile-settings__banner-cor">
                  <input
                    type="color"
                    value={custom.accent}
                    onChange={(e) => atualizarCustom({ accent: e.target.value })}
                    className="profile-settings__color-input"
                    aria-label="Selecionar cor de destaque personalizada"
                  />
                  <input
                    type="text"
                    value={custom.accent}
                    onChange={(e) => atualizarCustom({ accent: e.target.value })}
                    maxLength={9}
                    className="profile-settings__hex-input"
                    aria-label="Código hexadecimal da cor de destaque"
                  />
                </div>
              }
            />
          </SettingsGroup>
        )}
      </SettingsSection>

      <SettingsSection
        title="Movimento"
        description="Por padrão o Stapp segue a preferência do sistema operacional. Aqui dá para reduzir só neste aplicativo."
      >
        <SettingsGroup>
          <SettingsSegmented<MotionPreference>
            label="Animações"
            value={motion}
            onChange={setMotion}
            options={[
              { value: 'system', label: 'Seguir o sistema', detail: 'Respeita "reduzir movimento" do SO.' },
              { value: 'reduced', label: 'Sempre reduzidas', detail: 'Desliga transições e animações aqui.' },
            ]}
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}

function UpdateSettings({ updater }: { updater: UserMenuUpdater & { currentVersion: string } }) {
  const [verificando, setVerificando] = useState(false)

  if (!updater.isDesktop) {
    return (
      <SettingsSection title="Atualizações">
        <SettingsUnavailable tone="info" title="Esta versão atualiza sozinha">
          No navegador não existe instalação para atualizar: recarregar a página já traz a versão
          mais nova que o servidor estiver servindo. O canal e a verificação manual existem só no
          aplicativo desktop.
        </SettingsUnavailable>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title="Atualizações" description="De onde o aplicativo desktop busca novas versões.">
      <SettingsGroup>
        <SettingsSegmented
          label="Canal"
          value={updater.channel}
          onChange={(value) => updater.setChannel(value)}
          options={[
            { value: 'stable', label: 'Estável', detail: 'Só versões publicadas como finais.' },
            { value: 'beta', label: 'Beta', detail: 'Recebe antes, com mais chance de defeito.' },
          ]}
        />
        <SettingsRow
          label="Versão instalada"
          control={<span className="voicevideo__status">{updater.currentVersion}</span>}
        />
        <SettingsRow
          label="Procurar agora"
          description="Consulta o canal escolhido e avisa se houver algo mais novo."
          control={
            <SettingsButton disabled={verificando} onClick={() => {
              setVerificando(true)
              void updater.checkForUpdates(true).finally(() => setVerificando(false))
            }}>
              {verificando ? 'Procurando…' : 'Verificar'}
            </SettingsButton>
          }
        />
      </SettingsGroup>
    </SettingsSection>
  )
}

function AboutSettings({ version, serverName, protocolVersion }: {
  version: string
  serverName: string
  protocolVersion: number
}) {
  return (
    <SettingsSection title="Sobre" description="O Stapp é auto-hospedado: este aplicativo fala só com o servidor em que você entrou.">
      <SettingsGroup>
        <SettingsRow label="Aplicativo" control={<span className="voicevideo__status">Stapp {version}</span>} />
        <SettingsRow label="Servidor" control={<span className="voicevideo__status">{serverName}</span>} />
        <SettingsRow
          label="Versão do protocolo"
          description="Cliente e servidor precisam falar a mesma versão para conectar."
          control={<span className="voicevideo__status">{protocolVersion}</span>}
        />
      </SettingsGroup>
    </SettingsSection>
  )
}
