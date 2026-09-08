import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTauriRuntime, thumbnailDataUrl, type ScreenSource } from '../platform/screenCapture'
import type { ScreenShareResult, VoiceTransport } from '../voice/VoiceTransport'
import type { ScreenPreset } from '../voice/preferences'
import { IconScreen } from './Icons'
import { Modal, ModalHeader, useModalTitleId } from './Overlay'
import './screensharepicker.css'

interface Props {
  transport: VoiceTransport
  initialPreset: ScreenPreset
  onClose(): void
  onShare(
    sourceId: string | undefined,
    preset: ScreenPreset,
    includeAudio: boolean,
    sourceWidth?: number,
    sourceHeight?: number,
  ): Promise<ScreenShareResult>
}

const PRESETS: Array<{ id: ScreenPreset; title: string; detail: string }> = [
  { id: 'economy', title: 'Econômico', detail: '720p · 15 FPS' },
  { id: 'balanced', title: 'Equilibrado', detail: '1080p · 30 FPS' },
  { id: 'fluid', title: 'Fluido', detail: '720p · até 60 FPS' },
  { id: '1080p60', title: '1080p60', detail: '1080p · até 60 FPS' },
  { id: 'original', title: 'Original', detail: 'Resolução original · até 60 FPS' },
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
  const [refreshing, setRefreshing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const thumbnailsRef = useRef<Record<string, string | null>>({})
  thumbnailsRef.current = thumbnails

  const refreshSources = useCallback(async (showLoading = false) => {
    if (!native) return
    if (showLoading) setLoading(true)
    setRefreshing(true)
    try {
      const available = await transport.listScreenSources()
      setSources(available)
      setSelected((prev) => (prev && available.some((s) => s.id === prev) ? prev : null))
      if (!available.some((source) => source.kind === 'screen')) {
        setTab((current) => current === 'screen' ? 'window' : current)
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não consegui listar as telas e janelas.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [native, transport])

  const visible = useMemo(() => sources.filter((source) => source.kind === tab), [sources, tab])

  const handleManualRefresh = useCallback(async () => {
    await refreshSources(false)
    await Promise.all(visible.map(async (source) => {
      try {
        const thumbnail = await transport.captureScreenSourceThumbnail(source.id)
        setThumbnails((prev) => ({ ...prev, [source.id]: thumbnail }))
      } catch {
        setThumbnails((prev) => ({ ...prev, [source.id]: null }))
      }
    }))
  }, [refreshSources, transport, visible])

  useEffect(() => {
    if (!native) return
    const missing = visible.filter((s) => thumbnailsRef.current[s.id] === undefined)
    if (missing.length === 0) return

    let cancelled = false
    void Promise.all(missing.map(async (source) => {
      try {
        const thumbnail = await transport.captureScreenSourceThumbnail(source.id)
        if (!cancelled) {
          setThumbnails((prev) => ({ ...prev, [source.id]: thumbnail }))
        }
      } catch {
        if (!cancelled) {
          setThumbnails((prev) => ({ ...prev, [source.id]: null }))
        }
      }
    }))

    return () => {
      cancelled = true
    }
  }, [native, visible, transport])

  useEffect(() => {
    if (!native) return
    let active = true
    void refreshSources(true)
    const timer = window.setInterval(() => {
      if (active) void refreshSources(false)
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [native, refreshSources])

  const tituloId = useModalTitleId()

  const share = async () => {
    if (native && !selected) return
    setSharing(true)
    setError(null)
    const selectedSource = sources.find((s) => s.id === selected)
    const resultado = await onShare(
      selected ?? undefined,
      preset,
      includeAudio,
      selectedSource?.width,
      selectedSource?.height,
    )
    setSharing(false)
    if (resultado === true) {
      onClose()
      return
    }
    // Quem fechou o seletor do sistema nao errou nada: o modal continua aberto
    // para escolher de novo, e sem mensagem de erro.
    if (resultado === 'canceled') return
    setError('Não consegui iniciar o compartilhamento dessa fonte.')
  }

  /* O scrim, o Escape, a armadilha de foco e a devolucao de foco vem do
     `<Modal>`. Este dialogo era um dos tres que NAO fechavam no Escape. */
  return (
    <Modal open onClose={onClose} size="lg" labelledBy={tituloId} className="screenpicker__dialog">
      <>
        <ModalHeader overline="Transmissão" title="Compartilhar tela" titleId={tituloId} onClose={onClose} />

        {native ? (
          <>
            <div className="screenpicker__tabs" role="tablist" aria-label="tipo de fonte">
              <button role="tab" aria-selected={tab === 'screen'} onClick={() => setTab('screen')}>Telas</button>
              <button role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>Janelas</button>
              <button
                type="button"
                className="screenpicker__refresh"
                title="Atualizar telas e janelas"
                aria-label="Atualizar telas e janelas"
                disabled={refreshing}
                onClick={() => void handleManualRefresh()}
              >
                {refreshing ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>
            <div className="screenpicker__sources" aria-busy={loading}>
              {loading && <div className="screenpicker__empty">Procurando telas e janelas…</div>}
              {!loading && visible.map((source) => {
                const thumbnail = thumbnailDataUrl(thumbnails[source.id] ?? null)
                return (
                  <button key={source.id} className="screenpicker__source"
                    aria-pressed={selected === source.id} onClick={() => setSelected(source.id)}>
                    <span className="screenpicker__preview">
                      {thumbnail ? <img src={thumbnail} alt="" /> : <IconScreen size={32} />}
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
            <IconScreen size={32} />
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
      </>
    </Modal>
  )
}
