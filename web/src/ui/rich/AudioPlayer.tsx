import { memo, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import './audioPlayer.css'

interface Props {
  src: string
  filename?: string
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export const AudioPlayer = memo(function AudioPlayer({ src, filename }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return

    // Cores dos tokens CSS do Stapp
    const style = getComputedStyle(document.documentElement)
    const accentColor = style.getPropertyValue('--accent').trim() || '#3b82f6'
    const dimColor = style.getPropertyValue('--text-dim').trim() || '#94a3b8'

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: dimColor,
      progressColor: accentColor,
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 36,
      url: src,
    })

    ws.on('ready', () => {
      setTotalDuration(ws.getDuration())
    })

    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime())
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => {
      setIsPlaying(false)
      setCurrentTime(0)
    })

    wavesurferRef.current = ws

    return () => {
      ws.destroy()
    }
  }, [src])

  function togglePlay() {
    if (!wavesurferRef.current) return
    wavesurferRef.current.playPause()
  }

  return (
    <div className="stapp-audio-player" title={filename}>
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
        <div ref={containerRef} className="stapp-audio-waveform" />
        <div className="stapp-audio-time">
          {formatDuration(currentTime)} / {formatDuration(totalDuration)}
        </div>
      </div>
    </div>
  )
})