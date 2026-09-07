import { useEffect, useState } from 'react'
import type { AccentName, Profile } from '../../protocol'
import type { VoiceSnapshot, VoiceTransport } from '../../voice/VoiceTransport'
import type { VoicePreferences } from '../../voice/preferences'
import type { UserMenuUpdater } from '../UserMenu'
import {
  IconAccount, IconCamera, IconInfo, IconPalette, IconRefresh,
} from '../Icons'
import { SettingsShell, type SettingsGroupDef } from './SettingsShell'
import {
  SettingsButton, SettingsGroup, SettingsRow, SettingsSection,
  SettingsSegmented, SettingsUnavailable,
} from './primitives'
import { ProfileSettings } from './ProfileSettings'
import { VoiceVideoSettings } from './VoiceVideoSettings'
import { applyMotionPreference, loadMotionPreference, type MotionPreference } from './appearance'

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
  onSaveProfile(change: { display_name: string; accent: AccentName; bio: string; banner_color?: string }): void
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

function AppearanceSettings() {
  const [motion, setMotion] = useState<MotionPreference>(loadMotionPreference)
  useEffect(() => applyMotionPreference(motion), [motion])

  return (
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
