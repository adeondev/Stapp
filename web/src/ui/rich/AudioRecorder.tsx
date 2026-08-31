import { memo, useEffect, useRef, useState } from 'react'
import './audioPlayer.css'

interface Props {
  onRecordingComplete(file: File): void
  onCancel(): void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export const AudioRecorder = memo(function AudioRecorder({ onRecordingComplete, onCancel }: Props) {
  const [seconds, setSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function startRecording() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'

        const recorder = new MediaRecorder(stream, { mimeType })
        chunksRef.current = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          // O prefixo `voice-note-` e o que marca a gravacao como nota de voz na
          // hora de exibir. O tipo continua sendo o mime real: ele vai para o S3
          // como Content-Type e um `audio/voice` inventado deixaria o <audio>
          // sem conseguir tocar o arquivo depois.
          const filename = `voice-note-${Date.now()}.webm`
          const file = new File([blob], filename, { type: mimeType })
          onRecordingComplete(file)
        }

        recorder.start(200)
        mediaRecorderRef.current = recorder

        timerRef.current = setInterval(() => {
          setSeconds((s) => s + 1)
        }, 1000)
      } catch (err) {
        console.error('Falha ao acessar microfone:', err)
        onCancel()
      }
    }

    void startRecording()

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (stream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [onCancel, onRecordingComplete])

  function finish() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  function cancel() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    onCancel()
  }

  return (
    <div className="stapp-audio-recorder-bar">
      <div className="flex items-center gap-2">
        <div className="stapp-audio-record-pulse" />
        <span className="text-xs font-mono text-[var(--accent)] font-semibold">
          {formatTime(seconds)}
        </span>
        <span className="text-xs text-[var(--text-soft)]">Gravando áudio...</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs text-[var(--text-dim)] hover:text-[var(--text)] p-1 rounded transition-colors cursor-pointer"
          onClick={cancel}
          title="Cancelar gravação"
        >
          Cancelar
        </button>
        <button
          type="button"
          className="bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer"
          onClick={finish}
          title="Enviar gravação"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Enviar
        </button>
      </div>
    </div>
  )
})