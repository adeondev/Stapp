export async function startMicrophoneTest(
  constraints: MediaTrackConstraints,
  onLevel: (level: number) => void,
): Promise<() => void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const sample of data) {
      const centered = (sample - 128) / 128
      sum += centered * centered
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
  }, 60)
  return () => {
    window.clearInterval(timer)
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    void context.close()
    onLevel(0)
  }
}
