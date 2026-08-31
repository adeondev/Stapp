import { memo, useEffect, useRef, useState } from 'react'
import { loadVoicePreferences } from '../../voice/preferences'
import './audioPlayer.css'

export interface RecordedVoice {
  file: File
  durationMs: number
  waveform: number[]
}

interface Props {
  onRecordingComplete(recording: RecordedVoice): void
  onCancel(): void
}

const MAX_RECORDING_MS = 20 * 60 * 1000

function selectFormat() {
  const formats = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mp4', 'm4a'],
    ['audio/webm', 'webm'],
  ] as const
  return formats.find(([mime]) => MediaRecorder.isTypeSupported(mime)) ?? ['', 'webm'] as const
}

function formatTime(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

async function makeWaveform(blob: Blob): Promise<number[]> {
  try {
    const context = new AudioContext()
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    const channel = buffer.getChannelData(0)
    const step = Math.max(1, Math.floor(channel.length / 64))
    const result = Array.from({ length: 64 }, (_, index) => {
      const start = index * step
      const end = Math.min(channel.length, start + step)
      let peak = 0
      for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(channel[cursor]))
      return Math.max(2, Math.min(255, Math.round(peak * 255)))
    })
    await context.close()
    return result
  } catch {
    return Array.from({ length: 64 }, () => 32)
  }
}

export const AudioRecorder = memo(function AudioRecorder({ onRecordingComplete, onCancel }: Props) {
  const [status, setStatus] = useState<'requesting' | 'recording' | 'processing' | 'error'>('requesting')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const canceled = useRef(false)

  useEffect(() => {
    let disposed = false
    let timer = 0

    const fail = (message: string) => {
      if (disposed) return
      setError(message)
      setStatus('error')
    }

    const start = async () => {
      try {
        const inputDeviceId = loadVoicePreferences().inputDeviceId
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
            channelCount: 1,
            sampleRate: 48_000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        })
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const [mimeType, extension] = selectFormat()
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64_000,
        })
        recorderRef.current = recorder
        chunksRef.current = []
        const actualMime = recorder.mimeType || mimeType || 'audio/webm'

        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (recorder.state === 'recording') recorder.stop()
          fail('O dispositivo de microfone foi desconectado.')
        })
        recorder.onerror = () => fail('O gravador encontrou um erro e preservou o rascunho.')
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.onstop = async () => {
          window.clearInterval(timer)
          stream.getTracks().forEach((track) => track.stop())
          if (canceled.current || disposed) return
          setStatus('processing')
          const durationMs = Math.min(MAX_RECORDING_MS, Math.max(0, performance.now() - startedAt.current))
          const blob = new Blob(chunksRef.current, { type: actualMime })
          if (blob.size === 0) return fail('A gravacao ficou vazia. Tente novamente.')
          const waveform = await makeWaveform(blob)
          const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: actualMime })
          if (!disposed) onRecordingComplete({ file, durationMs: Math.round(durationMs), waveform })
        }
        startedAt.current = performance.now()
        recorder.start(1_000)
        setStatus('recording')
        timer = window.setInterval(() => {
          const current = performance.now() - startedAt.current
          setElapsed(current)
          if (current >= MAX_RECORDING_MS && recorder.state === 'recording') recorder.stop()
        }, 200)
      } catch (cause) {
        const denied = cause instanceof DOMException && cause.name === 'NotAllowedError'
        fail(denied ? 'Permissao de microfone negada.' : 'Nao foi possivel iniciar o microfone configurado.')
      }
    }

    void start()
    return () => {
      disposed = true
      window.clearInterval(timer)
      if (recorderRef.current?.state === 'recording') {
        canceled.current = true
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [onRecordingComplete])

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }
  const cancel = () => {
    canceled.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    onCancel()
  }

  return (
    <div className="stapp-audio-recorder-bar" role={status === 'error' ? 'alert' : 'status'}>
      <div className="stapp-recorder-copy">
        {status === 'recording' && <span className="stapp-audio-record-pulse" />}
        <strong>{status === 'requesting' ? 'Solicitando microfone...' : status === 'processing' ? 'Preparando previa...' : error ?? formatTime(elapsed)}</strong>
        {status === 'recording' && <span>Gravando mensagem de voz</span>}
      </div>
      <div className="stapp-recorder-actions">
        <button type="button" onClick={cancel}>Cancelar</button>
        {status === 'recording' && <button type="button" className="is-primary" onClick={stop}>Parar</button>}
        {status === 'error' && <button type="button" className="is-primary" onClick={onCancel}>Fechar</button>}
      </div>
    </div>
  )
})
