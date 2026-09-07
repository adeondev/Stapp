import { useEffect, useRef, useState } from 'react'
import type { DiagnosticReport, MediaDeviceLists, VoiceSnapshot, VoiceTransport } from '../../voice/VoiceTransport'
import { deduplicateDevices, type MicrophoneTest } from '../../voice/testMicrophone'
import { DEFAULT_VOICE_PREFERENCES, resetVoicePreferences, type VoicePreferences } from '../../voice/preferences'
import { IconCamera, IconHeadphones, IconMic } from '../Icons'
import {
  SettingsButton, SettingsDangerZone, SettingsField, SettingsGroup, SettingsRow,
  SettingsSection, SettingsSegmented, SettingsSelect, SettingsSlider, SettingsToggle,
  SettingsUnavailable,
} from './primitives'
import './voiceVideoSettings.css'

/**
 * Voz e Vídeo, agora como uma categoria das configuracoes.
 *
 * O conteudo e o mesmo de antes; o que mudou e que ele deixou de ser um modal
 * proprio (com scrim proprio, z-index proprio e primitives privadas) e passou a
 * usar as pecas compartilhadas. Tres controles segmentados que eram desenhados
 * de tres jeitos diferentes viraram o mesmo `SettingsSegmented`, e o interruptor
 * deixou de ser um `<input type="checkbox">` com o desenho do sistema.
 *
 * A novidade de comportamento e o **retorno do microfone**: durante o teste da
 * para ouvir a propria voz. Antes o teste so media o nivel — o grafo terminava
 * no analisador e nada chegava na saida.
 */

const EMPTY_DEVICES: MediaDeviceLists = { inputs: [], outputs: [], cameras: [] }

export interface VoiceVideoSettingsProps {
  transport: VoiceTransport
  snapshot: VoiceSnapshot
  onPreferencesChange?(preferences: VoicePreferences): void
}

export function VoiceVideoSettings({ transport, snapshot, onPreferencesChange }: VoiceVideoSettingsProps) {
  const [preferences, setPreferences] = useState<VoicePreferences>(() => transport.getPreferences())
  const [devices, setDevices] = useState(EMPTY_DEVICES)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [testError, setTestError] = useState<string | null>(null)
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const micTest = useRef<MicrophoneTest | null>(null)

  const isSecure = typeof window === 'undefined'
    || (window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia))

  useEffect(() => {
    setPreferences(transport.getPreferences())
    void transport.enumerateDevices().then(setDevices).catch(() => setDevices(EMPTY_DEVICES))
  }, [transport])

  /* O teste abre uma captura PROPRIA, separada da que a chamada publica: ligar
     ou desligar daqui nunca mexe numa call em andamento. O `handle` fica numa
     ref para o retorno local poder mudar de volume, de saida e de microfone em
     tempo real sem recriar o teste ou desmontar a interface. */
  useEffect(() => {
    if (!testing) return
    let vivo = true
    setTestError(null)
    void transport.startMicrophoneTest(setLevel).then((handle) => {
      if (!vivo) {
        handle.stop()
        return
      }
      micTest.current = handle
    }).catch((err) => {
      setTesting(false)
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Permissão de microfone negada pelo navegador.'
        : (err instanceof Error ? err.message : 'Não foi possível iniciar o teste de microfone.')
      setTestError(msg)
    })
    return () => {
      vivo = false
      micTest.current?.stop()
      micTest.current = null
    }
  }, [testing, transport])

  // Retorno, volume, saida e entrada mudam no grafo vivo sem recriar a captura
  useEffect(() => { micTest.current?.setMonitor(preferences.monitorMic) }, [preferences.monitorMic])
  useEffect(() => { micTest.current?.setMonitorVolume(preferences.monitorVolume) }, [preferences.monitorVolume])
  useEffect(() => { void micTest.current?.setOutputDevice(preferences.outputDeviceId) }, [preferences.outputDeviceId])
  useEffect(() => { void micTest.current?.setInputDevice(preferences.inputDeviceId) }, [preferences.inputDeviceId])

  /* Se o dispositivo em uso for arrancado no meio do teste, o navegador nao
     avisa por erro — a barra so congela. `devicechange` e o unico sinal.
     `mediaDevices` pode existir sem a parte de eventos (WebView antiga, jsdom),
     e sem esta guarda o painel inteiro quebra ao abrir o teste nessas maquinas. */
  useEffect(() => {
    const midia = navigator.mediaDevices
    if (!testing || typeof midia?.addEventListener !== 'function') return
    const aoTrocar = () => {
      void transport.enumerateDevices().then(setDevices).catch(() => undefined)
    }
    midia.addEventListener('devicechange', aoTrocar)
    return () => midia.removeEventListener('devicechange', aoTrocar)
  }, [testing, transport])

  useEffect(() => {
    const element = preview.current
    if (!previewing || !element) return
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
  }, [preferences.cameraDeviceId, preferences.cameraQuality, previewing, transport])

  // Sair da categoria precisa parar captura: o efeito de limpeza cobre isso, mas
  // deixar o estado ligado faria o teste renascer sozinho ao voltar.
  useEffect(() => () => {
    setTesting(false)
    setPreviewing(false)
  }, [])

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

  /* O medidor devolve 0..1 numa escala linear de amplitude; a sensibilidade e
     dB. Para as duas coisas caberem no mesmo eixo, o limiar em dB vira a mesma
     escala linear do medidor — e nao o contrario, porque converter a barra para
     dB faria a parte util dela sumir no canto esquerdo. O `* 4` repete o ganho
     que `startMicrophoneTest` aplica ao RMS. */
  const limiarLinear = Math.min(1, 10 ** (preferences.sensitivity / 20) * 4)
  const posicaoDoLimiar = Math.round(limiarLinear * 100)
  const acimaDoLimiar = testing && level >= limiarLinear

  const dispositivos = (lista: MediaDeviceInfo[], rotulo: string, icon: React.ReactNode) => [
    { value: '', label: 'Padrão do sistema', icon },
    ...deduplicateDevices(lista).map((device, index) => ({
      value: device.deviceId,
      label: device.label || `${rotulo} ${index + 1}`,
      icon,
    })),
  ]

  return (
    <>
      {!isSecure && (
        <SettingsUnavailable title="Microfone e câmera bloqueados pelo navegador">
          Em conexões HTTP remotas o navegador bloqueia dispositivos de mídia. Para usar voz e
          vídeo, conecte via HTTPS ou use o aplicativo desktop.
        </SettingsUnavailable>
      )}

      <SettingsSection title="Dispositivos" description="Entrada, saída e um teste para conferir antes de entrar numa chamada.">
        <SettingsGroup>
          <SettingsSelect label="Microfone" value={preferences.inputDeviceId}
            options={dispositivos(devices.inputs, 'Microfone', <IconMic size={16} />)}
            onChange={(value) => update('inputDeviceId', value)} />
          <SettingsSelect label="Saída de áudio" value={preferences.outputDeviceId}
            options={dispositivos(devices.outputs, 'Alto-falante', <IconHeadphones size={16} />)}
            onChange={(value) => update('outputDeviceId', value)} />
          <SettingsSlider label="Volume de entrada" value={preferences.inputVolume} min={0} max={200}
            suffix="%" onChange={(value) => update('inputVolume', value)} />
          <SettingsSlider label="Volume de saída" value={preferences.outputVolume} min={0} max={200}
            suffix="%" onChange={(value) => update('outputVolume', value)} />
        </SettingsGroup>

        <SettingsGroup title="Testar microfone"
          description="Abre uma captura só para o teste. Não interfere numa chamada em andamento.">
          <SettingsRow
            label={testing ? 'Teste em andamento' : 'Fale para ver o nível'}
            description={testing ? 'Fale normalmente — a barra acompanha o que o microfone capta.' : undefined}
            control={
              <SettingsButton tone={testing ? 'danger' : 'neutral'} onClick={() => setTesting((v) => !v)}>
                {testing ? 'Parar teste' : 'Testar'}
              </SettingsButton>
            }
          />
          <div className="voicevideo__meter" aria-label={`Nível do microfone: ${Math.round(level * 100)}%`}>
            <span style={{ width: `${level * 100}%` }} />
          </div>
          {testError && <SettingsUnavailable title="Não consegui abrir o microfone">{testError}</SettingsUnavailable>}
          <SettingsToggle
            checked={preferences.monitorMic}
            onChange={(value) => update('monitorMic', value)}
            label="Ouvir minha própria voz durante o teste"
            description="Só enquanto o teste está ligado. Sem fone de ouvido pode dar microfonia."
          />
          {preferences.monitorMic && (
            <SettingsSlider label="Volume do retorno" value={preferences.monitorVolume}
              min={0} max={100} suffix="%" onChange={(value) => update('monitorVolume', value)} />
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Entrada e processamento" description="Como o microfone abre e o que é feito com o som antes de sair daqui.">
        <SettingsGroup>
          <SettingsSegmented
            label="Modo de entrada"
            value={preferences.inputMode}
            onChange={(value) => update('inputMode', value)}
            options={[
              { value: 'voice_activity', label: 'Atividade de voz', detail: 'O microfone abre quando você fala.' },
              {
                value: 'push_to_talk',
                label: 'Push-to-Talk',
                detail: '__TAURI_INTERNALS__' in window ? 'Atalho global no aplicativo.' : 'Funciona só com a janela em foco.',
              },
            ]}
          />
          {preferences.inputMode === 'push_to_talk' && (
            <>
              <SettingsField label="Atalho" value={preferences.pttShortcut}
                onChange={(value) => update('pttShortcut', value)}
                hint="Exemplo: Control+Space" />
              <SettingsSlider label="Atraso ao soltar" value={preferences.pttReleaseDelay}
                min={0} max={2000} step={10} suffix=" ms"
                description="Mantém o microfone aberto por um instante depois de soltar a tecla."
                onChange={(value) => update('pttReleaseDelay', value)} />
            </>
          )}
        </SettingsGroup>

        <SettingsGroup title="Sensibilidade de entrada (VAD)"
          description="Controle o limiar a partir do qual o microfone capta a sua voz e acende o anel verde de fala.">
          <SettingsToggle checked={preferences.automaticSensitivity}
            onChange={(value) => update('automaticSensitivity', value)}
            label="Sensibilidade automática"
            description="Calibra o limiar continuamente com base no ruído ambiente." />
          <SettingsSlider
            label="Sensibilidade do microfone"
            value={preferences.sensitivity}
            min={-100}
            max={0}
            suffix=" dB"
            description={preferences.automaticSensitivity ? 'Valor de referência manual para a calibração automática.' : 'Fale normalmente e confira abaixo: o limiar precisa ficar à esquerda de onde a barra chega.'}
            onChange={(value) => update('sensitivity', value)}
          />
          {/* O deslizante sozinho e um numero em dB, que ninguem consegue julgar
              sem ouvir. Aqui ele ganha o volume de entrada ao vivo e a marca do
              limiar no mesmo eixo: da para ver, enquanto fala, se a voz passa
              do ponto em que o anel verde acende. */}
          <SettingsRow
            label="Nível de entrada agora"
            description={testing
              ? 'A marca é o limiar atual. Enquanto a barra passa dela, o microfone está aberto.'
              : 'Ligue o teste de microfone acima para ver a sua voz aqui.'}
            stacked
            control={
              <div className={`voicevideo__vad ${acimaDoLimiar ? 'is-open' : ''}`}
                role="meter"
                aria-label="Nível de entrada comparado ao limiar de voz"
                aria-valuenow={Math.round(level * 100)}
                aria-valuemin={0}
                aria-valuemax={100}>
                <span className="voicevideo__vad-fill" style={{ width: `${level * 100}%` }} />
                <span className="voicevideo__vad-mark" style={{ left: `${posicaoDoLimiar}%` }} aria-hidden="true" />
              </div>
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Processamento">
          <SettingsToggle checked={preferences.echoCancellation}
            onChange={(value) => update('echoCancellation', value)}
            label="Cancelamento de eco"
            description="Reduz o som dos alto-falantes voltando ao microfone." />
          <SettingsToggle checked={preferences.autoGainControl}
            onChange={(value) => update('autoGainControl', value)}
            label="Ganho automático"
            description="Mantém a voz em um volume consistente." />
          <SettingsSegmented
            label="Supressão de ruído"
            description="O RNNoise roda localmente em WebAssembly; nenhuma amostra sai do dispositivo."
            value={preferences.noiseMode}
            onChange={(value) => update('noiseMode', value)}
            options={[
              { value: 'off', label: 'Desligada' },
              { value: 'standard', label: 'Padrão', detail: 'A do navegador.' },
              { value: 'enhanced', label: 'RNNoise', detail: 'Mais pesada e mais eficaz.' },
            ]}
          />
          {preferences.noiseMode === 'enhanced' && <ProcessorStatus snapshot={snapshot} />}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Câmera">
        <SettingsGroup>
          <SettingsSelect label="Câmera" value={preferences.cameraDeviceId}
            options={dispositivos(devices.cameras, 'Câmera', <IconCamera size={16} />)}
            onChange={(value) => update('cameraDeviceId', value)} />
          <SettingsSegmented
            label="Qualidade"
            value={preferences.cameraQuality}
            onChange={(value) => update('cameraQuality', value)}
            options={[
              { value: '720p', label: '720p · 30 FPS', detail: 'Padrão e mais leve.' },
              { value: '1080p', label: '1080p · 30 FPS', detail: 'Mais nítido e mais pesado.' },
            ]}
          />
          <SettingsRow
            label="Prévia"
            description="Abre a câmera só para você conferir enquadramento e luz."
            control={
              <SettingsButton tone={previewing ? 'danger' : 'neutral'} onClick={() => setPreviewing((v) => !v)}>
                {previewing ? 'Fechar prévia' : 'Testar câmera'}
              </SettingsButton>
            }
          />
          <div className={`voicevideo__camera ${previewing ? 'is-visible' : ''} ${preferences.mirrorPreview ? 'is-mirrored' : ''}`}>
            <video ref={preview} autoPlay muted playsInline aria-label="Prévia local da câmera" />
          </div>
          {previewError && <SettingsUnavailable title="Não consegui abrir a câmera">{previewError}</SettingsUnavailable>}
          <SettingsToggle checked={preferences.mirrorPreview}
            onChange={(value) => update('mirrorPreview', value)}
            label="Espelhar minha prévia"
            description="Só muda o que você vê; as outras pessoas recebem a imagem normal." />
          <SettingsToggle checked={preferences.showSelf}
            onChange={(value) => update('showSelf', value)}
            label="Mostrar minha câmera na grade"
            description="Mantém a sua prévia visível junto com as outras pessoas." />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Transmissão de tela">
        <SettingsGroup>
          <SettingsSegmented
            label="Qualidade padrão"
            value={preferences.screenPreset}
            onChange={(value) => update('screenPreset', value)}
            options={[
              { value: 'economy', label: 'Econômico', detail: '720p · 15 FPS' },
              { value: 'balanced', label: 'Equilibrado', detail: '1080p · 30 FPS' },
              { value: 'fluid', label: 'Fluido', detail: '720p · até 60 FPS' },
              { value: 'original', label: 'Original', detail: 'Resolução da fonte' },
            ]}
          />
          <SettingsToggle checked={preferences.shareAudio}
            onChange={(value) => update('shareAudio', value)}
            label="Compartilhar áudio por padrão"
            description="O seletor lembra a última escolha feita." />
          <SettingsToggle checked={preferences.showVideoOffParticipants}
            onChange={(value) => update('showVideoOffParticipants', value)}
            label="Mostrar quem está sem vídeo"
            description="Exibe o avatar dessas pessoas na grade da chamada." />
          <SettingsSlider label="Atenuar sons do Stapp enquanto alguém fala"
            value={preferences.attenuation} min={0} max={100} suffix="%"
            onChange={(value) => update('attenuation', value)} />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Diagnóstico" description="Um retrato do estado da voz, sem token, SDP, ICE ou endereço IP.">
        <SettingsGroup>
          <SettingsRow label="Estado atual"
            control={<span className="voicevideo__status">{statusLegivel(snapshot.status)}</span>} />
          <SettingsRow label="Relatório"
            description="Copia um JSON com o estado do transporte para colar num chamado."
            control={<SettingsButton onClick={copyReport}>Copiar relatório</SettingsButton>} />
          {report && <pre className="voicevideo__report">{JSON.stringify(report, null, 2)}</pre>}
        </SettingsGroup>

        <SettingsDangerZone
          title="Redefinir voz e vídeo"
          description="Volta todas as opções desta página ao padrão. Não afeta a sua conta nem as conversas."
        >
          <SettingsButton tone="danger" onClick={() => {
            const defaults = resetVoicePreferences()
            setPreferences(defaults)
            onPreferencesChange?.(defaults)
            void transport.updatePreferences({ ...DEFAULT_VOICE_PREFERENCES })
          }}>Redefinir</SettingsButton>
        </SettingsDangerZone>
      </SettingsSection>
    </>
  )
}

function ProcessorStatus({ snapshot }: { snapshot: VoiceSnapshot }) {
  const processor = snapshot.audioProcessor
  if (processor.status === 'starting') {
    return <p className="voicevideo__processor">Iniciando RNNoise em 48 kHz…</p>
  }
  if (processor.status === 'active' && processor.effective === 'rnnoise') {
    return <p className="voicevideo__processor is-active">RNNoise ativo em 48 kHz.</p>
  }
  if (processor.status === 'fallback') {
    return (
      <p className="voicevideo__processor is-fallback">
        RNNoise indisponível nesta tentativa; supressão padrão ativa. Sua preferência foi mantida.
      </p>
    )
  }
  return null
}

function statusLegivel(status: VoiceSnapshot['status']) {
  return ({
    idle: 'Desconectado', requesting: 'Conectando…', connecting: 'Conectando áudio…',
    connected: 'Voz conectada', reconnecting: 'Reconectando…',
  })[status]
}
