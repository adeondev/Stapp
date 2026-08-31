import { useEffect, useMemo, useState } from 'react'
import { isTauriRuntime, thumbnailDataUrl, type ScreenSource } from '../platform/screenCapture'
import type { VoiceTransport } from '../voice/VoiceTransport'
import type { ScreenPreset } from '../voice/preferences'
import { IconScreen, IconX } from './Icons'
import './screensharepicker.css'

interface Props {
  transport: VoiceTransport
  initialPreset: ScreenPreset
  onClose(): void
  onShare(sourceId: string | undefined, preset: ScreenPreset, includeAudio: boolean): Promise<boolean>
}

const PRESETS: Array<{ id: ScreenPreset; title: string; detail: string }> = [
  { id: 'economy', title: 'Econômico', detail: '720p · 15 FPS' },
  { id: 'balanced', title: 'Equilibrado', detail: '1080p · 30 FPS' },
  { id: 'fluid', title: 'Fluido', detail: '720p · até 30 FPS no app' },
  { id: 'original', title: 'Original', detail: 'Resolução original · até 30 FPS no app' },
]

export function ScreenSharePicker({ transport, initialPreset, onClose, onShare }: Props) {
  const native = isTauriRuntime()
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [preset, setPreset] = useState(initialPreset)
  const [includeAudio, setIncludeAudio] = useState(() => transport.getPreferences().shareAudio)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [loading, setLoading] = useState(native)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!native) return () => { active = false }
    void transport.listScreenSources()
      .then((available) => {
        if (!active) return
        setSources(available)
        if (!available.some((source) => source.kind === 'screen')) setTab('window')
        setLoading(false)
        return Promise.all(available.map(async (source) => {
          const thumbnail = await transport.captureScreenSourceThumbnail(source.id)
          if (active) setThumbnails((current) => ({ ...current, [source.id]: thumbnail }))
        }))
      })
      .catch((reason: unknown) => {
        if (!active) return
        setLoading(false)
        setError(reason instanceof Error ? reason.message : 'Não consegui listar as telas e janelas.')
      })
    return () => { active = false }
  }, [native, transport])

  const visible = useMemo(() => sources.filter((source) => source.kind === tab), [sources, tab])

  const share = async () => {
    if (native && !selected) return
    setSharing(true)
    setError(null)
    const ok = await onShare(selected ?? undefined, preset, includeAudio)
    setSharing(false)
    if (ok) onClose()
    else setError('Não consegui iniciar o compartilhamento dessa fonte.')
  }

  return (
    <div className="screenpicker" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="screenpicker__dialog" role="dialog" aria-modal="true" aria-labelledby="screenpicker-title">
        <header className="screenpicker__header">
          <div>
            <span>TRANSMISSÃO</span>
            <h2 id="screenpicker-title">Compartilhar tela</h2>
          </div>
          <button onClick={onClose} aria-label="fechar seletor"><IconX size={18} /></button>
        </header>

        {native ? (
          <>
            <div className="screenpicker__tabs" role="tablist" aria-label="tipo de fonte">
              <button role="tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>Telas</button>
              <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>Janelas</button>
            </div>
            <div className="screenpicker__sources" aria-busy={loading}>
              {loading && <div className="screenpicker__empty">Procurando telas e janelas…</div>}
              {!loading && visible.map((source) => {
                const thumbnail = thumbnailDataUrl(thumbnails[source.id] ?? null)
                return (
                  <button key={source.id} className="screenpicker__source"
                    aria-pressed={selected === source.id} onClick={() => setSelected(source.id)}>
                    <span className="screenpicker__preview">
                      {thumbnail ? <img src={thumbnail} alt="" /> : <IconScreen size={30} />}
                    </span>
                    <strong>{source.name}</strong>
                    <small>{source.width} × {source.height}</small>
                  </button>
                )
              })}
              {!loading && visible.length === 0 && (
                <div className="screenpicker__empty">Nenhuma {tab === 'screen' ? 'tela' : 'janela'} disponível.</div>
              )}
            </div>
          </>
        ) : (
          <div className="screenpicker__browser">
            <IconScreen size={36} />
            <strong>Escolha a fonte no navegador</strong>
            <p>A versão web usa o seletor seguro do próprio navegador. No aplicativo instalado, esta etapa acontece toda dentro do Stapp.</p>
          </div>
        )}

        <div className="screenpicker__quality" aria-label="qualidade da transmissão">
          {PRESETS.map((option) => (
            <button key={option.id} aria-pressed={preset === option.id} onClick={() => setPreset(option.id)}>
              <strong>{option.title}</strong><small>{option.detail}</small>
            </button>
          ))}
        </div>

        <label className="screenpicker__audio">
          <input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} />
          <span><strong>Compartilhar áudio</strong>
            <small>{native && tab === 'window'
              ? 'Envia somente o som do aplicativo escolhido.'
              : native
                ? 'Envia o som do computador sem as vozes da call do Stapp.'
                : 'O navegador informa quais fontes podem fornecer áudio.'}</small></span>
        </label>
        {native && <p className="screenpicker__note">Se o Windows não permitir separar o áudio com segurança, a transmissão continua apenas com vídeo.</p>}
        {error && <p className="screenpicker__error" role="alert">{error}</p>}

        <footer className="screenpicker__footer">
          <button className="screenpicker__cancel" onClick={onClose}>Cancelar</button>
          <button className="screenpicker__share" disabled={sharing || (native && !selected)} onClick={() => void share()}>
            {sharing ? 'Iniciando…' : native ? 'Compartilhar' : 'Abrir seletor do sistema'}
          </button>
        </footer>
      </section>
    </div>
  )
}
