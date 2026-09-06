// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMicrophoneTest } from './testMicrophone'

/* O teste de microfone era so um medidor: o grafo terminava no `AnalyserNode` e
   nada chegava na saida, entao ninguem nunca conseguiu se ouvir. O que estes
   casos travam e justamente o que faltava — existir um caminho ate a saida, o
   ganho responder ao liga/desliga, e tudo ser desmontado no fim. */

interface NoFalso {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  gain?: { value: number }
}

let nos: Record<string, NoFalso[]>
let destino: object
let saidaStream: MediaStream
let contextoFechado: boolean
let tracksParadas: number

function no(tipo: string): NoFalso {
  const item: NoFalso = { connect: vi.fn(), disconnect: vi.fn() }
  nos[tipo] = [...(nos[tipo] ?? []), item]
  return item
}

beforeEach(() => {
  nos = {}
  contextoFechado = false
  tracksParadas = 0
  destino = { __destino: true }
  saidaStream = { id: 'monitor' } as unknown as MediaStream

  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: () => { tracksParadas += 1 } }],
      })),
    },
  })

  class ContextoFalso {
    destination = destino
    createMediaStreamSource() { return no('source') }
    createAnalyser() {
      const item = no('analyser') as NoFalso & { fftSize: number; getByteTimeDomainData(d: Uint8Array): void }
      item.fftSize = 1024
      item.getByteTimeDomainData = (data: Uint8Array) => data.fill(128)
      return item
    }
    createGain() {
      const item = no('gain')
      item.gain = { value: 1 }
      return item
    }
    createMediaStreamDestination() {
      const item = no('streamDestination') as NoFalso & { stream: MediaStream }
      item.stream = saidaStream
      return item
    }
    close() { contextoFechado = true; return Promise.resolve() }
  }
  vi.stubGlobal('AudioContext', ContextoFalso)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startMicrophoneTest', () => {
  it('liga o retorno local ate um <audio>, e nao ao destino do contexto', async () => {
    const teste = await startMicrophoneTest({}, () => {}, { monitor: true, monitorVolume: 80 })

    // O ramo do retorno sai por um MediaStream proprio: e a unica forma de o
    // <audio> poder escolher o dispositivo de saida com setSinkId.
    const saida = nos.streamDestination?.[0]
    expect(saida).toBeTruthy()

    const ganho = nos.gain?.find((item) => item.gain && item.gain.value > 0)
    expect(ganho, 'o retorno precisa ter ganho audivel').toBeTruthy()
    expect(ganho?.gain?.value).toBeCloseTo(0.8)
    expect(ganho?.connect).toHaveBeenCalledWith(saida)

    const alto = document.querySelector('audio')
    expect(alto).toBeTruthy()
    expect((alto as HTMLAudioElement).srcObject).toBe(saidaStream)

    expect(teste.isMonitoring()).toBe(true)
    teste.stop()
  })

  it('mantem caminho ate a saida mesmo com o retorno desligado, senao o medidor le silencio', async () => {
    const teste = await startMicrophoneTest({}, () => {}, { monitor: false })

    // O Chrome so processa o grafo que chega em algum destino. Com o retorno
    // mudo, quem sustenta o analisador e um ganho zerado ligado ao destination.
    const mudo = nos.gain?.find((item) => item.gain?.value === 0)
    expect(mudo, 'precisa existir um ramo mudo ate a saida').toBeTruthy()
    expect(mudo?.connect).toHaveBeenCalledWith(destino)

    expect(teste.isMonitoring()).toBe(false)
    teste.stop()
  })

  it('liga, desliga e ajusta o volume sem reabrir o microfone', async () => {
    const abrir = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    const teste = await startMicrophoneTest({}, () => {}, { monitor: false, monitorVolume: 50 })
    expect(abrir).toHaveBeenCalledTimes(1)

    teste.setMonitor(true)
    expect(teste.isMonitoring()).toBe(true)
    const ganho = nos.gain?.find((item) => item.gain && item.gain.value > 0)
    expect(ganho?.gain?.value).toBeCloseTo(0.5)

    teste.setMonitorVolume(100)
    expect(ganho?.gain?.value).toBeCloseTo(1)

    teste.setMonitor(false)
    expect(ganho?.gain?.value).toBe(0)

    // Nada disso pode ter reaberto a captura — e o que garante que mexer no
    // teste nunca derruba o microfone de uma chamada em andamento.
    expect(abrir).toHaveBeenCalledTimes(1)
    teste.stop()
  })

  it('desmonta tudo ao parar: tracks, nos, contexto e o <audio>', async () => {
    const niveis: number[] = []
    const teste = await startMicrophoneTest({}, (n) => niveis.push(n), { monitor: true })

    expect(document.querySelector('audio')).toBeTruthy()
    teste.stop()

    expect(tracksParadas).toBe(1)
    expect(contextoFechado).toBe(true)
    expect(document.querySelector('audio')).toBeNull()
    expect(nos.source?.[0].disconnect).toHaveBeenCalled()
    expect(niveis.at(-1)).toBe(0)

    // Parar duas vezes nao pode explodir: o React chama cleanup em StrictMode.
    expect(() => teste.stop()).not.toThrow()
  })

  it('recusa fora de contexto seguro, antes de pedir o microfone', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    await expect(startMicrophoneTest({}, () => {})).rejects.toThrow(/segura/i)
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
})
