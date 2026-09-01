import { memo, useEffect, useRef, useState } from 'react'
import { IconSpeaker, IconVolumeLow, IconVolumeOff } from '../Icons'
import './audioPlayer.css'

interface Props {
  src: string
  filename?: string
  initialDurationSec?: number
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

const CHAVE_VOLUME = 'stapp:volume-audio'

/**
 * O volume vale para todos os players, nao para um so.
 *
 * Ajustar em cada nota de voz separadamente seria inutil — quem baixa o volume
 * quer baixar o do proximo audio tambem. Fica no navegador de quem escuta: e
 * preferencia de escuta, nao dado da conversa, entao nao tem por que ir para o
 * servidor.
 */
function volumeGuardado(): number {
  try {
    const bruto = localStorage.getItem(CHAVE_VOLUME)
    const valor = bruto === null ? 1 : Number(bruto)
    return Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : 1
  } catch {
    // Aba anonima ou site data bloqueado: o acessor em si pode estourar.
    return 1
  }
}

function guardarVolume(valor: number) {
  try {
    localStorage.setItem(CHAVE_VOLUME, String(valor))
  } catch {
    // Sem persistir, o volume so vale para esta sessao. Nao e motivo de erro.
  }
}

/**
 * Toca o audio pelo proprio <audio> do navegador, com barra de progresso.
 *
 * ARMADILHA QUE JA CUSTOU TEMPO: a versao anterior desenhava a onda com o
 * WaveSurfer, que **baixa o arquivo por `fetch`** para decodificar. O anexo e
 * servido por outra origem no dev (web em :5173, servidor em :8787) e a rota
 * `/attachments/files` so manda `cross-origin-resource-policy` — nao manda
 * `access-control-allow-origin`. Isso basta para `<img>`/`<audio>`, mas nao
 * para `fetch`. O resultado era o player parado em `0:00 / 0:00`, sem onda e
 * sem tocar, com o `GET` respondendo 200 o tempo todo. Elemento de midia nao
 * passa por CORS; por isso a reproducao aqui nao depende de baixar nada.
 */
export const AudioPlayer = memo(function AudioPlayer({ src, filename, initialDurationSec }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDurationSec && initialDurationSec > 0 ? initialDurationSec : 0)
  const [volume, setVolume] = useState(volumeGuardado)
  /** Ultimo volume audivel, para o botao de mudo saber ao que voltar. */
  const antesDoMudo = useRef(volume || 1)
  /** Varredura em curso para descobrir a duracao — veja `aoCarregarMetadados`. */
  const medindo = useRef(false)

  // O `volume` do elemento nao e atributo: so da para escrever nele.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    medindo.current = false
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(initialDurationSec && initialDurationSec > 0 ? initialDurationSec : 0)
  }, [src, initialDurationSec])

  /**
   * O webm que sai do `MediaRecorder` nao tem duracao no cabecalho: o navegador
   * devolve `Infinity` e a barra ficaria sem fim. Mandar o cursor para um ponto
   * absurdo forca a varredura ate o fim do arquivo, e o proprio navegador
   * corrige a duracao. Depois o cursor volta para zero.
   */
  function aoCarregarMetadados() {
    const el = audioRef.current
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration)
      return
    }
    medindo.current = true
    try {
      el.currentTime = 1e101
    } catch {
      medindo.current = false
    }
  }

  function aoMudarDuracao() {
    const el = audioRef.current
    if (!el) return
    if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
  }

  function aoAvancar() {
    const el = audioRef.current
    if (!el) return
    if (medindo.current) {
      medindo.current = false
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
      el.currentTime = 0
      setCurrentTime(0)
      return
    }
    setCurrentTime(el.currentTime)
  }

  function togglePlay() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  function mudarVolume(event: React.ChangeEvent<HTMLInputElement>) {
    const valor = Number(event.target.value)
    if (valor > 0) antesDoMudo.current = valor
    setVolume(valor)
    guardarVolume(valor)
  }

  function alternarMudo() {
    const valor = volume > 0 ? 0 : antesDoMudo.current || 1
    setVolume(valor)
    guardarVolume(valor)
  }

  function buscar(event: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current
    const alvo = Number(event.target.value)
    setCurrentTime(alvo)
    if (el && Number.isFinite(alvo)) el.currentTime = alvo
  }

  const progresso = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div className="stapp-audio-player" title={filename}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={aoCarregarMetadados}
        onDurationChange={aoMudarDuracao}
        onTimeUpdate={aoAvancar}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false)
          setCurrentTime(0)
        }}
      />

      <button
        type="button"
        className="stapp-audio-play-btn"
        onClick={togglePlay}
        title={isPlaying ? 'Pausar' : 'Reproduzir'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>

      <div className="stapp-audio-waveform-wrapper">
        <input
          type="range"
          className="stapp-audio-slider"
          min={0}
          max={duration > 0 ? duration : 0}
          step="any"
          value={currentTime}
          disabled={duration <= 0}
          onChange={buscar}
          style={{ ['--progresso' as string]: `${progresso}%` }}
          aria-label="Posição do áudio"
        />
        <div className="stapp-audio-time">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>

      <div className="stapp-audio-volume">
        <button
          type="button"
          className="stapp-audio-volume-btn"
          onClick={alternarMudo}
          title={volume > 0 ? 'Silenciar' : 'Voltar o som'}
        >
          {volume === 0 ? (
            <IconVolumeOff size={15} />
          ) : volume < 0.5 ? (
            <IconVolumeLow size={15} />
          ) : (
            <IconSpeaker size={15} />
          )}
        </button>
        <input
          type="range"
          className="stapp-audio-volume-slider"
          min={0}
          max={1}
          step="any"
          value={volume}
          onChange={mudarVolume}
          style={{ ['--progresso' as string]: `${volume * 100}%` }}
          aria-label="Volume"
        />
      </div>
    </div>
  )
})
