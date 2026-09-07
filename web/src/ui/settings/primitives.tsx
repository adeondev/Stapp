import { useId } from 'react'
import { DropdownSelect } from '../Menu'
import { IconAlert, IconCheck } from '../Icons'
import './settings.css'

/**
 * As pecas das configuracoes.
 *
 * Antes existia uma tela so — "Voz e Vídeo" — e as pecas dela eram funcoes
 * privadas no rodape do proprio arquivo: `SettingsGroup`, `Toggle`, `Range`,
 * `Choice`. Fora dali, cada controle era marcacao a mao: o atalho do
 * push-to-talk era um `<label><input></label>` estilizado por um seletor
 * `:not()`, e havia tres controles segmentados desenhados de tres jeitos
 * diferentes para fazer a mesma coisa.
 *
 * Aqui as pecas sao publicas e sao poucas de proposito. Nao existe primitive
 * para o que aparece uma vez so — abstrair por antecipacao custaria mais do que
 * a repeticao que evitaria.
 */

/* ── Estrutura ───────────────────────────────────────────────────────────── */

export function SettingsSection({ title, description, children, actions }: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="settings-section">
      <header className="settings-section__head">
        <div>
          <h2 className="settings-section__title">{title}</h2>
          {description && <p className="settings-section__description">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  )
}

/** Um bloco de linhas relacionadas. A separacao e por tom de fundo, sem linha. */
export function SettingsGroup({ title, description, children, className = '' }: {
  title?: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`settings-group ${className}`}>
      {title && <h3 className="settings-group__title">{title}</h3>}
      {description && <p className="settings-group__description">{description}</p>}
      <div className="settings-group__rows">{children}</div>
    </div>
  )
}

/**
 * Rotulo e descricao a esquerda, controle a direita.
 *
 * `stacked` poe o controle abaixo do texto — para o que precisa de largura
 * (deslizante, campo de texto, segmentado com tres opcoes).
 */
export function SettingsRow({ label, description, control, htmlFor, stacked = false, danger = false }: {
  label: React.ReactNode
  description?: React.ReactNode
  control: React.ReactNode
  htmlFor?: string
  stacked?: boolean
  danger?: boolean
}) {
  const Rotulo = htmlFor ? 'label' : 'div'
  return (
    <div className={`settings-row ${stacked ? 'is-stacked' : ''} ${danger ? 'is-danger' : ''}`}>
      <Rotulo className="settings-row__copy" htmlFor={htmlFor}>
        <span className="settings-row__label">{label}</span>
        {description && <span className="settings-row__description">{description}</span>}
      </Rotulo>
      <div className="settings-row__control">{control}</div>
    </div>
  )
}

/* ── Controles ───────────────────────────────────────────────────────────── */

/**
 * Interruptor de verdade.
 *
 * Era um `<input type="checkbox">` cru com o desenho do sistema, que nao combina
 * com nada e muda de forma por sistema operacional. O input continua existindo
 * embaixo — e ele que da teclado, foco e leitura de tela de graca.
 */
export function SettingsToggle({ checked, onChange, label, description, disabled }: {
  checked: boolean
  onChange(value: boolean): void
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <SettingsRow
      htmlFor={id}
      label={label}
      description={description}
      control={
        <span className={`settings-switch ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}>
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="settings-switch__track" aria-hidden="true">
            <span className="settings-switch__thumb" />
          </span>
        </span>
      }
    />
  )
}

export function SettingsSelect({ label, description, value, options, onChange }: {
  label: string
  description?: React.ReactNode
  value: string
  options: { value: string; label: string; detail?: string; icon?: React.ReactNode }[]
  onChange(value: string): void
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      stacked
      control={<DropdownSelect label={label} value={value} options={options} onChange={onChange} />}
    />
  )
}

export function SettingsSlider({ label, description, value, min, max, step = 1, suffix = '', onChange }: {
  label: React.ReactNode
  description?: React.ReactNode
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange(value: number): void
}) {
  const id = useId()
  // O preenchimento e pintado na propria trilha por variavel CSS — mesmo padrao
  // do player de audio, e sem elemento extra por cima.
  const progresso = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <SettingsRow
      htmlFor={id}
      label={
        <span className="settings-slider__label">
          {label}
          <output className="settings-slider__value">{value}{suffix}</output>
        </span>
      }
      description={description}
      stacked
      control={
        <input
          id={id}
          className="settings-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ ['--progresso' as string]: `${progresso}%` }}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      }
    />
  )
}

/**
 * Escolha unica entre poucas opcoes.
 *
 * Substitui tres controles que faziam isto de tres jeitos: os cartoes de modo de
 * entrada, os de qualidade de camera e a fileira de tres botoes da supressao de
 * ruido. E um `radiogroup` de verdade, entao as setas do teclado funcionam.
 */
export function SettingsSegmented<T extends string>({ label, description, value, options, onChange, columns }: {
  label: string
  description?: React.ReactNode
  value: T
  options: { value: T; label: string; detail?: string }[]
  onChange(value: T): void
  columns?: number
}) {
  const mover = (delta: number) => {
    const atual = options.findIndex((item) => item.value === value)
    const proximo = options[(atual + delta + options.length) % options.length]
    if (proximo) onChange(proximo.value)
  }
  return (
    <SettingsRow
      label={label}
      description={description}
      stacked
      control={
        <div
          className="settings-segmented"
          role="radiogroup"
          aria-label={label}
          style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); mover(1) }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); mover(-1) }
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === value}
              tabIndex={option.value === value ? 0 : -1}
              className={`settings-segmented__option ${option.value === value ? 'is-active' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <span className="settings-segmented__title">
                {option.label}
                {option.value === value && <IconCheck size={16} />}
              </span>
              {option.detail && <small>{option.detail}</small>}
            </button>
          ))}
        </div>
      }
    />
  )
}

export function SettingsField({ label, description, value, onChange, placeholder, maxLength, multiline, hint }: {
  label: string
  description?: React.ReactNode
  value: string
  onChange(value: string): void
  placeholder?: string
  maxLength?: number
  multiline?: boolean
  hint?: React.ReactNode
}) {
  const id = useId()
  return (
    <SettingsRow
      htmlFor={id}
      label={label}
      description={description}
      stacked
      control={
        <div className="settings-field">
          {multiline ? (
            <textarea id={id} value={value} rows={3} maxLength={maxLength}
              placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          ) : (
            <input id={id} value={value} maxLength={maxLength}
              placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          )}
          <div className="settings-field__foot">
            <span>{hint}</span>
            {maxLength && <span className="settings-field__count">{value.length}/{maxLength}</span>}
          </div>
        </div>
      }
    />
  )
}

export function SettingsButton({ children, onClick, tone = 'neutral', disabled, type = 'button', icon }: {
  children: React.ReactNode
  onClick?(): void
  tone?: 'neutral' | 'primary' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  icon?: React.ReactNode
}) {
  return (
    <button type={type} className={`settings-button is-${tone}`} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  )
}

/** A area do que nao tem volta. Separada por tom, e sempre com o porque escrito. */
export function SettingsDangerZone({ title, description, children }: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="settings-danger">
      <div className="settings-danger__copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-danger__actions">{children}</div>
    </div>
  )
}

/**
 * O estado "esta parte nao esta disponivel agora, e por este motivo".
 *
 * Existe como peca porque aparece em varios lugares pelo mesmo tipo de razao —
 * contexto inseguro bloqueia microfone e camera, voz desligada no servidor
 * desliga a categoria inteira — e um aviso que muda de desenho a cada tela
 * parece defeito, nao explicacao.
 */
export function SettingsUnavailable({ title, children, tone = 'warning' }: {
  title: React.ReactNode
  children?: React.ReactNode
  tone?: 'warning' | 'info'
}) {
  return (
    <div className={`settings-unavailable is-${tone}`} role="status">
      <IconAlert size={20} filled />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  )
}
