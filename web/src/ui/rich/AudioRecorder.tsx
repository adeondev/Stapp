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
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mp4', 'm4a'],
  ] as const
  if (typeof MediaRecorder === 'undefined') return ['', 'webm'] as const
  return formats.find(([mime]) => {
    try { return MediaRecorder.isTypeSupported(mime) } catch { return false }
  }) ?? ['', 'webm'] as const
}

function formatTime(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function normalizeWaveform(samples: number[]): number[] {
  if (samples.length === 0) {
    return Array.from({ length: 64 }, () => 32)
  }
  if (samples.length <= 64) {
    const result: number[] = []
    for (let i = 0; i < 64; i++) {
      const idx = Math.floor((i / 64) * samples.length)
      result.push(samples[idx] ?? 32)
    }
    return result
  }
  const step = samples.length / 64
  const result: number[] = []
  for (let i = 0; i < 64; i++) {
    const start = Math.floor(i * step)
    const end = Math.min(samples.length, Math.floor((i + 1) * step))
    let peak = 0
    for (let j = start; j < end; j++) {
      if (samples[j] > peak) peak = samples[j]
    }
    result.push(Math.max(4, Math.min(255, peak)))
  }
  return result
}

export const AudioRecorder = memo(function AudioRecorder({ onRecordingComplete, onCancel }: Props) {
  const [status, setStatus] = useState<'requesting' | 'recording' | 'processing' | 'error'>('requesting')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const samplesRef = useRef<number[]>([])
  const startedAt = useRef(0)
  const canceled = useRef(false)

  useEffect(() => {
    let disposed = false
    let timer = 0
    let sampleTimer = 0
    let audioCtx: AudioContext | null = null

    const fail = (message: string) => {
      if (disposed) return
      setError(message)
      setStatus('error')
    }

    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          return fail('O microfone exige uma conexão segura (HTTPS) ou o aplicativo Desktop.')
        }

        const prefs = loadVoicePreferences()
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: prefs.echoCancellation,
          noiseSuppression: prefs.noiseMode !== 'off',
          autoGainControl: prefs.autoGainControl,
        }
        if (prefs.inputDeviceId && prefs.inputDeviceId !== 'default') {
          audioConstraints.deviceId = { ideal: prefs.inputDeviceId }
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream

        // Setup real-time waveform capture
        try {
          const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          if (AudioCtxClass) {
            audioCtx = new AudioCtxClass()
            const source = audioCtx.createMediaStreamSource(stream)
            const analyser = audioCtx.createAnalyser()
            analyser.fftSize = 256
            analyser.smoothingTimeConstant = 0.3
            source.connect(analyser)
            const dataArray = new Uint8Array(analyser.frequencyBinCount)

            sampleTimer = window.setInterval(() => {
              if (recorderRef.current?.state !== 'recording') return
              analyser.getByteFrequencyData(dataArray)
              let max = 0
              for (let i = 0; i < dataArray.length; i++) {
                if (dataArray[i] > max) max = dataArray[i]
              }
              samplesRef.current.push(Math.max(4, max))
            }, 100)
          }
        } catch {
          // AudioContext optional fallback
        }

        const [mimeType, extension] = selectFormat()
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64_000,
        })
        recorderRef.current = recorder
        chunksRef.current = []
        samplesRef.current = []
        const actualMime = recorder.mimeType || mimeType || 'audio/webm'

        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (recorder.state === 'recording') recorder.stop()
          fail('O dispositivo de microfone foi desconectado.')
        })

        recorder.onerror = () => fail('O gravador encontrou um erro e preservou o rascunho.')
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
        }

        recorder.onstop = () => {
          window.clearInterval(timer)
          window.clearInterval(sampleTimer)
          audioCtx?.close().catch(() => {})
          stream.getTracks().forEach((track) => track.stop())
          if (canceled.current || disposed) return
          const durationMs = Math.min(MAX_RECORDING_MS, Math.max(0, performance.now() - startedAt.current))
          const blob = new Blob(chunksRef.current, { type: actualMime })
          if (blob.size === 0) return fail('A gravação ficou vazia. Tente novamente.')
          const waveform = normalizeWaveform(samplesRef.current)
          const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: actualMime })
          if (!disposed) onRecordingComplete({ file, durationMs: Math.round(durationMs), waveform })
        }

        startedAt.current = performance.now()
        recorder.start(250)
        setStatus('recording')
        timer = window.setInterval(() => {
          const current = performance.now() - startedAt.current
          setElapsed(current)
          if (current >= MAX_RECORDING_MS && recorder.state === 'recording') recorder.stop()
        }, 200)
      } catch (cause) {
        const denied = cause instanceof DOMException && cause.name === 'NotAllowedError'
        fail(denied ? 'Permissão de microfone negada pelo navegador.' : 'Não foi possível iniciar o microfone configurado.')
      }
    }

    void start()
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.clearInterval(sampleTimer)
      audioCtx?.close().catch(() => {})
      if (recorderRef.current?.state === 'recording') {
        canceled.current = true
        try { recorderRef.current.stop() } catch {}
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [onRecordingComplete])

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const cancel = () => {
    canceled.current = true
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop() } catch {}
    }
    onCancel()
  }

  return (
    <div className="stapp-audio-recorder-bar" role={status === 'error' ? 'alert' : 'status'}>
      <div className="stapp-recorder-copy">
        {status === 'recording' && <span className="stapp-audio-record-pulse" />}
        <strong>{status === 'requesting' ? 'Solicitando microfone...' : status === 'processing' ? 'Preparando prévia...' : error ?? formatTime(elapsed)}</strong>
        {status === 'recording' && <span>Gravando mensagem de voz</span>}
      </div>
      <div className="stapp-recorder-actions">
        <button type="button" onClick={cancel}>Cancelar</button>
        {status === 'recording' && <button type="button" className="is-primary" onClick={stop}>Concluir</button>}
        {status === 'error' && <button type="button" className="is-primary" onClick={onCancel}>Fechar</button>}
      </div>
    </div>
  )
})
