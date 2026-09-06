import { useEffect, useRef, useState } from 'react'
import { Modal } from '../Overlay'
import { IconX } from '../Icons'
import { IconButton } from '../IconButton'
import './settings.css'

/**
 * A casca das configuracoes: trilho de categorias a esquerda, painel a direita.
 *
 * Antes nao havia casca nenhuma. "Configurações" era um modal unico de Voz e
 * Vídeo, com cinco cartoes empilhados numa coluna so; o perfil vivia noutro
 * modal e as opcoes de atualizacao viviam dentro do menu de contexto do proprio
 * usuario. Tres lugares para o que e uma coisa so.
 *
 * Um detalhe que era bug de verdade: o modal antigo so era montado quando havia
 * transporte de voz (`{voice.current && <VoiceSettings .../>}`), entao sem voz
 * nao existia NENHUMA configuracao alcancavel. Aqui a casca nao depende de voz;
 * quem depende e a categoria de voz, que se desabilita explicando o motivo.
 */

export interface SettingsCategory {
  id: string
  label: string
  icon: React.ReactNode
  render(): React.ReactNode
  /** Motivo pelo qual a categoria nao pode ser aberta agora. */
  disabledReason?: string
  danger?: boolean
}

export interface SettingsGroupDef {
  /** Titulo do grupo no trilho. Ausente = grupo sem cabecalho. */
  title?: string
  categories: SettingsCategory[]
}

export function SettingsShell({ open, onClose, groups, initialCategory }: {
  open: boolean
  onClose(): void
  groups: SettingsGroupDef[]
  initialCategory?: string
}) {
  const todas = groups.flatMap((grupo) => grupo.categories)
  const primeira = todas.find((item) => !item.disabledReason)?.id ?? todas[0]?.id ?? ''
  const [ativa, setAtiva] = useState(initialCategory ?? primeira)
  const painel = useRef<HTMLDivElement>(null)

  // Reabrir volta para a categoria pedida; sem isto a tela reabria no ultimo
  // lugar visitado, que raramente e o que a pessoa quer da segunda vez.
  useEffect(() => {
    if (open) setAtiva(initialCategory ?? primeira)
    // `primeira` muda junto com as categorias; so importa no momento de abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCategory])

  // Trocar de categoria rola o painel de volta ao topo. Sem isso a segunda
  // categoria abre no meio, na altura em que a anterior estava.
  useEffect(() => {
    painel.current?.scrollTo({ top: 0 })
  }, [ativa])

  const atual = todas.find((item) => item.id === ativa) ?? todas[0]

  const mover = (delta: number) => {
    const alcancaveis = todas.filter((item) => !item.disabledReason)
    const indice = alcancaveis.findIndex((item) => item.id === ativa)
    const proxima = alcancaveis[(indice + delta + alcancaveis.length) % alcancaveis.length]
    if (proxima) setAtiva(proxima.id)
  }

  return (
    <Modal open={open} onClose={onClose} size="full" label="Configurações" className="settings-modal">
      <div className="settings">
        <nav
          className="settings__rail"
          aria-label="Categorias das configurações"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); mover(1) }
            if (event.key === 'ArrowUp') { event.preventDefault(); mover(-1) }
          }}
        >
          {groups.map((grupo, indice) => (
            <div key={grupo.title ?? indice}>
              {indice > 0 && <div className="settings__rail-divider" />}
              {grupo.title && <h2 className="settings__rail-title">{grupo.title}</h2>}
              {grupo.categories.map((categoria) => (
                <button
                  key={categoria.id}
                  type="button"
                  className={`settings__tab ${categoria.id === ativa ? 'is-active' : ''} ${categoria.danger ? 'is-danger' : ''}`}
                  aria-current={categoria.id === ativa ? 'page' : undefined}
                  disabled={Boolean(categoria.disabledReason)}
                  title={categoria.disabledReason}
                  onClick={() => setAtiva(categoria.id)}
                >
                  {categoria.icon}
                  <span className="settings__tab-label">{categoria.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings__pane">
          <header className="settings__pane-head">
            <h1 className="settings__pane-title">{atual?.label}</h1>
            <span className="settings__close">
              <IconButton label="Fechar" icon={<IconX size={20} />} onClick={onClose} showTitle={false} />
              <kbd>ESC</kbd>
            </span>
          </header>
          <div className="settings__scroll" ref={painel}>
            {atual?.render()}
          </div>
        </div>
      </div>
    </Modal>
  )
}
