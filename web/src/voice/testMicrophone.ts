/**
 * Teste de microfone: medidor de nivel **e** retorno local.
 *
 * O retorno nao existia. O grafo era `getUserMedia -> MediaStreamSource ->
 * AnalyserNode` e acabava ali: nada chegava em `ctx.destination`, nao havia
 * `GainNode` nem `<audio>`, e o sinal era lido so para calcular o RMS da barra.
 * Ou seja, "testar microfone" media, mas nunca deixou ninguem se ouvir.
 *
 * Tres coisas que nao sao detalhe:
 *
 * - **O retorno sai por um `<audio>`, nao por `ctx.destination`.** E a unica
 *   forma de respeitar o dispositivo de saida escolhido: `setSinkId` existe no
 *   elemento de midia, e `AudioContext.destination` nao pode ser redirecionado
 *   na maioria dos navegadores.
 * - **O medidor precisa de caminho ate a saida.** O Chrome so processa o grafo
 *   que chega em algum destino; um `AnalyserNode` num ramo solto le silencio.
 *   Com o monitor desligado, o analisador continua ligado a um `GainNode(0)`
 *   que vai ate o destino — mesmo truque do `MeshTransport`, e pelo mesmo
 *   motivo. Sem ele a barra fica parada com o retorno desligado.
 * - **A chamada em andamento nao e tocada.** Este `getUserMedia` e uma captura
 *   propria, separada da que o LiveKit publica. Comecar ou parar o teste nao
 *   mexe na track publicada nem no processador de ruido.
 *
 * O `echoCancellation` e forcado enquanto o retorno esta ligado: sem fone, ouvir
 * a si mesmo pelos alto-falantes realimenta o microfone.
 */

export interface MicrophoneTestOptions {
  /** Ouvir a propria voz. Quando `false`, so o medidor funciona. */
  monitor?: boolean
  /** Volume do retorno, 0..100. */
  monitorVolume?: number
  /** Dispositivo de saida do retorno. Vazio = padrao do sistema. */
  outputDeviceId?: string
}

export interface MicrophoneTest {
  /** Desmonta tudo: timer, grafo, `<audio>`, contexto e tracks. */
  stop(): void
  /** Liga/desliga o retorno sem reabrir o microfone. */
  setMonitor(enabled: boolean): void
  /** 0..100. Aplicado na hora, sem reabrir nada. */
  setMonitorVolume(volume: number): void
  /** Troca a saida do retorno durante o teste. */
  setOutputDevice(deviceId: string): Promise<void>
  /** `true` se o retorno esta audivel neste instante. */
  isMonitoring(): boolean
}

/** `HTMLMediaElement.setSinkId` ainda nao esta na lib padrao do TS. */
type ComSink = HTMLAudioElement & { setSinkId?(deviceId: string): Promise<void> }

const nivelDe = (volume: number) => Math.min(1, Math.max(0, volume / 100))

export async function startMicrophoneTest(
  constraints: MediaTrackConstraints,
  onLevel: (level: number) => void,
  options: MicrophoneTestOptions = {},
): Promise<MicrophoneTest> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('O microfone exige conexão segura (HTTPS) ou o aplicativo Desktop.')
  }

  const { monitor = false, monitorVolume = 60, outputDeviceId = '' } = options

  const stream = await navigator.mediaDevices.getUserMedia({
    // Com retorno ligado, cancelar eco deixa de ser preferencia e vira defesa
    // contra realimentacao — quem testa quase nunca esta de fone.
    audio: monitor ? { ...constraints, echoCancellation: true } : constraints,
    video: false,
  })

  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)

  // Ramo mudo que apenas garante caminho ate a saida, para o Chrome processar o
  // grafo mesmo com o retorno desligado. Ver o comentario no topo.
  const dreno = context.createGain()
  dreno.gain.value = 0
  analyser.connect(dreno)
  dreno.connect(context.destination)

  // Ramo do retorno: sai por um MediaStream proprio para poder ir num <audio>
  // com `setSinkId`, e assim respeitar o dispositivo de saida escolhido.
  const ganho = context.createGain()
  ganho.gain.value = monitor ? nivelDe(monitorVolume) : 0
  source.connect(ganho)
  const saida = context.createMediaStreamDestination()
  ganho.connect(saida)

  const alto = document.createElement('audio') as ComSink
  alto.autoplay = true
  alto.srcObject = saida.stream
  // Fora da arvore visivel: e so o cano de audio, nao tem controle nenhum.
  alto.style.display = 'none'
  document.body.appendChild(alto)

  const aplicarSaida = async (deviceId: string) => {
    if (!deviceId || typeof alto.setSinkId !== 'function') return
    try {
      await alto.setSinkId(deviceId)
    } catch {
      // Sem permissao ou dispositivo sumiu: o retorno sai pelo padrao do
      // sistema. Nao vale derrubar o teste inteiro por causa disso.
    }
  }
  await aplicarSaida(outputDeviceId)
  // Alguns navegadores exigem gesto antes de tocar; o teste sempre nasce de um
  // clique, mas a promessa e ignorada de proposito para nao virar erro fatal.
  // `play()` tambem pode devolver `undefined` (implementacoes antigas e jsdom),
  // entao nao da para encadear `.catch` direto.
  void Promise.resolve(alto.play()).catch(() => undefined)

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

  let monitorando = monitor
  let volumeAtual = monitorVolume
  let parado = false

  return {
    stop() {
      if (parado) return
      parado = true
      window.clearInterval(timer)
      source.disconnect()
      analyser.disconnect()
      dreno.disconnect()
      ganho.disconnect()
      alto.pause()
      alto.srcObject = null
      alto.remove()
      stream.getTracks().forEach((track) => track.stop())
      void context.close()
      onLevel(0)
    },
    setMonitor(enabled: boolean) {
      if (parado) return
      monitorando = enabled
      ganho.gain.value = enabled ? nivelDe(volumeAtual) : 0
    },
    setMonitorVolume(volume: number) {
      if (parado) return
      volumeAtual = volume
      if (monitorando) ganho.gain.value = nivelDe(volume)
    },
    async setOutputDevice(deviceId: string) {
      if (parado) return
      await aplicarSaida(deviceId)
    },
    isMonitoring() {
      return monitorando && !parado
    },
  }
}
