export async function startMicrophoneTest(
  constraints: MediaTrackConstraints,
  onLevel: (level: number) => void,
  outputDeviceId?: string,
): Promise<() => void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false })
  const context = new AudioContext()

  if (outputDeviceId && 'setSinkId' in context) {
    void (context as AudioContext & { setSinkId(id: string): Promise<void> })
      .setSinkId(outputDeviceId)
      .catch(() => {})
  }

  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)

  // Grafo de retorno local audível (loopback):
  // Liga o microfone capturado até o destination permitindo escutar a própria voz
  const monitorGain = context.createGain()
  monitorGain.gain.value = 1.0
  source.connect(monitorGain)
  monitorGain.connect(context.destination)

  if (context.state === 'suspended') {
    void context.resume().catch(() => {})
  }

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
    try {
      monitorGain.disconnect()
      source.disconnect()
      analyser.disconnect()
    } catch {
      // Ignora erro se já desconectado
    }
    stream.getTracks().forEach((track) => track.stop())
    void context.close().catch(() => {})
    onLevel(0)
  }
}
