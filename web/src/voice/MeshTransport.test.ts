// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MeshTransport } from './MeshTransport'

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  readonly handlers = new Map<string, Array<(event: any) => void>>()
  connectionState = 'connected'
  remoteDescription: RTCSessionDescription | null = null
  addTrack = vi.fn()
  getSenders = vi.fn(() => [])
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer' }))
  setLocalDescription = vi.fn(async () => {})
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description as RTCSessionDescription
  })
  addIceCandidate = vi.fn(async () => {})
  close = vi.fn()

  constructor() { FakePeerConnection.instances.push(this) }
  addEventListener(event: string, handler: (event: any) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }
  emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload)
  }
}

const fakeAudioContext = {
  destination: {},
  resume: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  createAnalyser: vi.fn(() => ({
    fftSize: 0, disconnect: vi.fn(), connect: vi.fn(),
    getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(128)),
  })),
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
  createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
  createDynamicsCompressor: vi.fn(() => ({
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
    attack: { value: 0 }, release: { value: 0 },
    connect: vi.fn(), disconnect: vi.fn(),
  })),
}

describe('MeshTransport', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
    FakePeerConnection.instances.length = 0
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true, value: FakePeerConnection,
    })
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {
        destination = fakeAudioContext.destination
        resume = fakeAudioContext.resume
        close = fakeAudioContext.close
        createAnalyser = fakeAudioContext.createAnalyser
        createMediaStreamSource = fakeAudioContext.createMediaStreamSource
        createGain = fakeAudioContext.createGain
        createDynamicsCompressor = fakeAudioContext.createDynamicsCompressor
      },
    })
    fakeAudioContext.createGain.mockClear()
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true, value: vi.fn(async () => {}),
    })
    const localTrack = { enabled: true, stop: vi.fn(), kind: 'audio' }
    const localStream = {
      getTracks: () => [localTrack],
      getAudioTracks: () => [localTrack],
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => localStream),
        enumerateDevices: vi.fn(async () => []),
      },
    })
  })

  it('mantem inaudivel uma pessoa que cria a conexao depois do ensurdecimento', async () => {
    const transport = new MeshTransport(
      { backend: 'mesh', ice_servers: [], max_peers: 6 },
      { selfPeerId: 'self', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn() },
    )
    expect(await transport.join('sala')).toBe(true)
    transport.setDeafened(true)
    transport.handleServerMessage({
      t: 'rtc.signal', from: 'new-peer', payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'remote' } },
    })
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1))

    const remoteStream = { getTracks: () => [], getAudioTracks: () => [] }
    fakeAudioContext.createGain.mockClear()
    FakePeerConnection.instances[0]?.emit('track', { streams: [remoteStream] })
    const audio = document.querySelector<HTMLAudioElement>('audio')
    // Primeiro ganho criado durante o evento de track e o do PlaybackGraph.
    const graphGain = fakeAudioContext.createGain.mock.results[0]?.value
    expect(audio?.muted).toBe(true)
    expect(graphGain.gain.value).toBe(0)
    audio?.dispatchEvent(new Event('play'))
    expect(audio?.muted).toBe(true)
    if (audio) audio.muted = false
    transport.handleServerMessage({ t: 'voice.left', peer_id: 'outra-pessoa' })
    expect(audio?.muted).toBe(true)
    expect(graphGain.gain.value).toBe(0)
    transport.destroy()
  })

  it('nao deixa o elemento <audio> tocar em paralelo com o grafo de reproducao', async () => {
    const transport = new MeshTransport(
      { backend: 'mesh', ice_servers: [], max_peers: 6 },
      { selfPeerId: 'self', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn() },
    )
    expect(await transport.join('sala')).toBe(true)
    transport.handleServerMessage({
      t: 'rtc.signal', from: 'new-peer', payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'remote' } },
    })
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1))
    FakePeerConnection.instances[0]?.emit('track', {
      streams: [{ getTracks: () => [], getAudioTracks: () => [] }],
    })

    // Duas saidas simultaneas para a mesma fonte tem relogios independentes:
    // eco metalico e ganho dobrado. Com o grafo vivo o elemento fica mudo e
    // serve so de ancora de autoplay/setSinkId.
    const audio = document.querySelector<HTMLAudioElement>('audio')
    expect(audio?.muted).toBe(true)

    // Nem mesmo mexer no volume devolve o elemento ao caminho de audio.
    transport.setVoiceVolume('new-peer', 80)
    expect(audio?.muted).toBe(true)
    transport.setDeafened(true)
    expect(audio?.muted).toBe(true)
    transport.setDeafened(false)
    expect(audio?.muted).toBe(true)
    transport.destroy()
  })

  it('reaplica o volume local quando a faixa remota e criada', async () => {
    const transport = new MeshTransport(
      { backend: 'mesh', ice_servers: [], max_peers: 6 },
      { selfPeerId: 'self', send: vi.fn(), onSpeaking: vi.fn(), onError: vi.fn() },
    )
    expect(await transport.join('sala')).toBe(true)
    transport.setVoiceVolume('new-peer', 25)
    transport.handleServerMessage({
      t: 'rtc.signal', from: 'new-peer', payload: { kind: 'offer', sdp: { type: 'offer', sdp: 'remote' } },
    })
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1))
    fakeAudioContext.createGain.mockClear()
    FakePeerConnection.instances[0]?.emit('track', {
      streams: [{ getTracks: () => [], getAudioTracks: () => [] }],
    })
    // O volume vive no PlaybackGraph, nao no elemento: o primeiro ganho criado
    // durante o evento de track e o do grafo.
    const graphGain = fakeAudioContext.createGain.mock.results[0]?.value
    expect(graphGain.gain.value).toBeCloseTo(0.25)
    expect(document.querySelector<HTMLAudioElement>('audio')?.muted).toBe(true)
    transport.handleServerMessage({ t: 'voice.left', peer_id: 'outra-pessoa' })
    expect(transport.getVoiceVolume('new-peer')).toBe(25)
    transport.leave()
    expect(transport.getVoiceVolume('new-peer')).toBe(25)
    transport.destroy()
    expect(transport.getVoiceVolume('new-peer')).toBe(100)
  })
})
