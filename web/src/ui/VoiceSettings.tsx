import { useEffect, useRef, useState } from 'react'
import type { DiagnosticReport, MediaDeviceLists, VoiceSnapshot, VoiceTransport } from '../voice/VoiceTransport'
import { DEFAULT_VOICE_PREFERENCES, resetVoicePreferences, type VoicePreferences } from '../voice/preferences'
import { IconCamera, IconHeadphones, IconMic, IconScreen, IconX } from './Icons'
import { DropdownSelect } from './Menu'
import './voicesettings.css'

interface Props {
  open: boolean
  transport: VoiceTransport
  snapshot: VoiceSnapshot
  onClose(): void
  onPreferencesChange?(preferences: VoicePreferences): void
}

const EMPTY_DEVICES: MediaDeviceLists = { inputs: [], outputs: [], cameras: [] }

export function VoiceSettings({ open, transport, snapshot, onClose, onPreferencesChange }: Props) {
  const [preferences, setPreferences] = useState<VoicePreferences>(() => transport.getPreferences())
  const [devices, setDevices] = useState(EMPTY_DEVICES)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const preview = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open) return
    setPreferences(transport.getPreferences())
    void transport.enumerateDevices().then(setDevices).catch(() => setDevices(EMPTY_DEVICES))
  }, [open, transport])

  useEffect(() => {
    if (open) return
    setTesting(false)
    setPreviewing(false)
  }, [open])

  useEffect(() => {
    if (!testing) return
    let stop: (() => void) | undefined
    void transport.startMicrophoneTest(setLevel).then((cleanup) => { stop = cleanup }).catch(() => setTesting(false))
    return () => stop?.()
  }, [testing, transport])

  useEffect(() => {
    const element = preview.current
    if (!open || !previewing || !element) return
    let disposed = false
    let stop: (() => void) | undefined
    setPreviewError(null)
    void transport.startCameraPreview(element).then((cleanup) => {
      if (disposed) cleanup()
      else stop = cleanup
    }).catch(() => {
      if (!disposed) {
        setPreviewing(false)
        setPreviewError('Não consegui abrir a câmera. Confira a permissão e o dispositivo.')
      }
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [open, preferences.cameraDeviceId, preferences.cameraQuality, previewing, transport])

  if (!open) return null

  const update = <K extends keyof VoicePreferences>(key: K, value: VoicePreferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    onPreferencesChange?.(next)
    void transport.updatePreferences({ [key]: value })
  }

  const copyReport = async () => {
    const next = await transport.diagnosticReport()
    setReport(next)
    await navigator.clipboard.writeText(JSON.stringify(next, null, 2))
  }

  return <div className="voicesettings__scrim" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="voicesettings" role="dialog" aria-modal="true" aria-labelledby="voice-settings-title">
      <header><div><span>Configurações</span><h2 id="voice-settings-title">Voz e Vídeo</h2></div>
        <button onClick={onClose} aria-label="fechar"><IconX size={18} /></button></header>
      <div className="voicesettings__body">
        <SettingsGroup icon={<IconMic />} title="Dispositivos de voz">
          <div className="voicesettings__columns">
            <Select label="Entrada" value={preferences.inputDeviceId}
              icon={<IconMic />} onChange={(value) => update('inputDeviceId', value)} devices={devices.inputs} />
            <Select label="Saída" value={preferences.outputDeviceId}
              icon={<IconHeadphones />} onChange={(value) => update('outputDeviceId', value)} devices={devices.outputs} />
          </div>
          <Range label="Volume de entrada" value={preferences.inputVolume} min={0} max={200}
            onChange={(value) => update('inputVolume', value)} suffix="%" />
          <Range label="Volume de saída" value={preferences.outputVolume} min={0} max={200}
            onChange={(value) => update('outputVolume', value)} suffix="%" />
          <button className={`voicesettings__test ${testing ? 'is-active' : ''}`} onClick={() => setTesting((value) => !value)}>
            {testing ? 'Parar teste do microfone' : 'Testar microfone'}</button>
          <div className="voicesettings__meter" aria-label={`nível do microfone ${Math.round(level * 100)}%`}>
            <span style={{ width: `${level * 100}%` }} /></div>
        </SettingsGroup>

        <SettingsGroup icon={<IconMic />} title="Entrada e processamento">
          <div className="voicesettings__choice" role="group" aria-label="modo de entrada">
            <Choice active={preferences.inputMode === 'voice_activity'} onClick={() => update('inputMode', 'voice_activity')}
              title="Atividade de voz" detail="O microfone abre quando você fala." />
            <Choice active={preferences.inputMode === 'push_to_talk'} onClick={() => update('inputMode', 'push_to_talk')}
              title="Push-to-Talk" detail={'__TAURI_INTERNALS__' in window ? 'Atalho global no aplicativo.' : 'Funciona só com a janela em foco.'} />
          </div>
          {preferences.inputMode === 'push_to_talk' && <div className="voicesettings__columns">
            <label>Atalho<input value={preferences.pttShortcut}
              onChange={(event) => update('pttShortcut', event.target.value)} /></label>
            <Range label="Atraso ao soltar" value={preferences.pttReleaseDelay} min={0} max={2000}
              onChange={(value) => update('pttReleaseDelay', value)} suffix=" ms" />
          </div>}
          <Toggle checked={preferences.automaticSensitivity} onChange={(value) => update('automaticSensitivity', value)}
            title="Sensibilidade automática" detail="Ajusta o limiar de atividade de voz ao ambiente." />
          {!preferences.automaticSensitivity && <Range label="Sensibilidade" value={preferences.sensitivity} min={-100} max={0}
            onChange={(value) => update('sensitivity', value)} suffix=" dB" />}
          <Toggle checked={preferences.echoCancellation} onChange={(value) => update('echoCancellation', value)}
            title="Cancelamento de eco" detail="Reduz o som dos alto-falantes voltando ao microfone." />
          <Toggle checked={preferences.autoGainControl} onChange={(value) => update('autoGainControl', value)}
            title="Ganho automático" detail="Mantém a voz em um volume consistente." />
          <div className="voicesettings__noise"><span>Supressão de ruído</span>
            <div>{(['off', 'standard', 'enhanced'] as const).map((mode) =>
              <button key={mode} className={preferences.noiseMode === mode ? 'is-active' : ''}
                onClick={() => update('noiseMode', mode)}>{({ off: 'Desligado', standard: 'Padrão', enhanced: 'RNNoise' })[mode]}</button>)}</div>
            <small>RNNoise roda localmente em WASM; nenhuma amostra sai do dispositivo.</small></div>
          {preferences.noiseMode === 'enhanced' && <ProcessorStatus snapshot={snapshot} />}
        </SettingsGroup>

        <SettingsGroup icon={<IconCamera />} title="Câmera">
          <Select label="Câmera" value={preferences.cameraDeviceId}
            icon={<IconCamera />} onChange={(value) => update('cameraDeviceId', value)} devices={devices.cameras} />
          <div className="voicesettings__choice">
            <Choice active={preferences.cameraQuality === '720p'} onClick={() => update('cameraQuality', '720p')}
              title="720p / 30" detail="Padrão e mais leve." />
            <Choice active={preferences.cameraQuality === '1080p'} onClick={() => update('cameraQuality', '1080p')}
              title="1080p / 30" detail="Mais nítido e mais pesado." />
          </div>
          <button className={`voicesettings__test ${previewing ? 'is-active' : ''}`}
            onClick={() => setPreviewing((value) => !value)}>
            {previewing ? 'Fechar prévia da câmera' : 'Testar câmera'}
          </button>
          <div className={`voicesettings__camera-preview ${previewing ? 'is-visible' : ''} ${preferences.mirrorPreview ? 'is-mirrored' : ''}`}>
            <video ref={preview} autoPlay muted playsInline aria-label="prévia local da câmera" />
          </div>
          {previewError && <span className="voicesettings__preview-error" role="status">{previewError}</span>}
          <Toggle checked={preferences.mirrorPreview} onChange={(value) => update('mirrorPreview', value)}
            title="Espelhar minha prévia" detail="Só muda o que você vê; os outros recebem a imagem normal." />
          <Toggle checked={preferences.showSelf} onChange={(value) => update('showSelf', value)}
            title="Mostrar minha câmera" detail="Mantém sua prévia visível na grade." />
        </SettingsGroup>

        <SettingsGroup icon={<IconScreen />} title="Transmissão e aparência">
          <DropdownSelect label="Qualidade padrão" value={preferences.screenPreset} onChange={(value) =>
            update('screenPreset', value as VoicePreferences['screenPreset'])} options={[
              { value: 'economy', label: 'Econômico', detail: '720p · 15 FPS', icon: <IconScreen /> },
              { value: 'balanced', label: 'Equilibrado', detail: '1080p · 30 FPS', icon: <IconScreen /> },
              { value: 'fluid', label: 'Fluido', detail: '720p · até 60 FPS', icon: <IconScreen /> },
              { value: 'original', label: 'Original', detail: 'Resolução original', icon: <IconScreen /> },
            ]} />
          <Toggle checked={preferences.shareAudio} onChange={(value) => update('shareAudio', value)}
            title="Compartilhar áudio por padrão" detail="O seletor lembra a última escolha feita." />
          <Toggle checked={preferences.showVideoOffParticipants}
            onChange={(value) => update('showVideoOffParticipants', value)}
            title="Mostrar pessoas sem vídeo" detail="Exibe o avatar delas na grade." />
          <Range label="Atenuar sons do Stapp enquanto alguém fala" value={preferences.attenuation} min={0} max={100}
            onChange={(value) => update('attenuation', value)} suffix="%" />
        </SettingsGroup>

        <SettingsGroup title="Diagnóstico">
          <div className="voicesettings__diagnostic"><div><strong>{snapshot.status}</strong>
            <span>Relatório sem token, SDP, ICE ou endereço IP.</span></div>
            <button onClick={copyReport}>Copiar relatório</button></div>
          {report && <pre>{JSON.stringify(report, null, 2)}</pre>}
        </SettingsGroup>

        <button className="voicesettings__reset" onClick={() => {
          const defaults = resetVoicePreferences()
          setPreferences(defaults)
          onPreferencesChange?.(defaults)
          void transport.updatePreferences({ ...DEFAULT_VOICE_PREFERENCES })
        }}>Redefinir opções de voz e vídeo</button>
      </div>
    </section>
  </div>
}

function SettingsGroup({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="voicesettings__group"><h3>{icon}{title}</h3>{children}</section>
}

function Select({ label, value, devices, icon, onChange }: {
  label: string
  value: string
  devices: MediaDeviceInfo[]
  icon: React.ReactNode
  onChange(value: string): void
}) {
  return <DropdownSelect label={label} value={value} onChange={onChange}
    options={[{ value: '', label: 'Padrão do sistema', icon }, ...devices.map((device, index) => ({
      value: device.deviceId, label: device.label || `${label} ${index + 1}`, icon,
    }))]} />
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
    return <small className="voicesettings__processor-status is-fallback">
      RNNoise indisponível nesta tentativa; supressão padrão ativa. Sua preferência foi mantida.
    </small>
  }
  return null
}

function Range({ label, value, min, max, suffix, onChange }: {
  label: string; value: number; min: number; max: number; suffix: string; onChange(value: number): void
}) {
  return <label className="voicesettings__range"><span>{label}</span><output>{value}{suffix}</output>
    <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange(value: boolean): void; title: string; detail: string }) {
  return <label className="voicesettings__toggle"><span><strong>{title}</strong><small>{detail}</small></span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}

function Choice({ active, onClick, title, detail }: { active: boolean; onClick(): void; title: string; detail: string }) {
  return <button className={active ? 'is-active' : ''} onClick={onClick}><strong>{title}</strong><small>{detail}</small></button>
}
