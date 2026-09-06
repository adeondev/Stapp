import { describe, expect, it, vi } from 'vitest'
import { attachmentContentUrl, updatePendingAttachment, uploadMediaFile } from './mediaUpload'

describe('uploadMediaFile', () => {
  it('envia multipart ao proprio servidor com destino e token', async () => {
    const opened = vi.fn()
    const header = vi.fn()
    let sent: FormData | undefined
    vi.stubGlobal('XMLHttpRequest', function MockXHR(this: any) {
      this.upload = {}
      this.open = opened
      this.setRequestHeader = header
      this.send = vi.fn((body: FormData) => {
        sent = body
        this.status = 201
        this.response = { attachment_id: 'att-123' }
        this.onload?.()
      })
      this.abort = vi.fn()
    })

    const file = new File(['conteudo'], 'foto.jpg', { type: 'image/jpeg' })
    const id = await uploadMediaFile(
      'ws://127.0.0.1:8787',
      'fake-token',
      file,
      { kind: 'direct', id: 'user-2' },
    )

    expect(id).toBe('att-123')
    expect(opened).toHaveBeenCalledWith('POST', 'http://127.0.0.1:8787/attachments', true)
    expect(header).toHaveBeenCalledWith('Authorization', 'Bearer fake-token')
    expect(sent?.get('scope_kind')).toBe('direct')
    expect(sent?.get('scope_id')).toBe('user-2')
    expect((sent?.get('file') as File).name).toBe('foto.jpg')
  })

  it('nao repete automaticamente um erro 4xx', async () => {
    const send = vi.fn()
    vi.stubGlobal('XMLHttpRequest', function MockXHR(this: any) {
      this.upload = {}
      this.open = vi.fn()
      this.setRequestHeader = vi.fn()
      this.send = send.mockImplementation(() => {
        this.status = 415
        this.responseText = 'formato incompativel'
        this.onload?.()
      })
      this.abort = vi.fn()
    })

    await expect(uploadMediaFile(
      'ws://127.0.0.1:8787',
      'token',
      new File(['x'], 'a.exe'),
      { kind: 'channel', id: 'geral' },
    )).rejects.toThrow('formato incompativel')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('aplica timeout de 60s e recupera via retry resetando progresso para 0%', async () => {
    let callCount = 0
    const progressValues: number[] = []
    vi.stubGlobal('XMLHttpRequest', function MockXHR(this: any) {
      this.upload = {}
      this.open = vi.fn()
      this.setRequestHeader = vi.fn()
      this.send = vi.fn(() => {
        callCount += 1
        expect(this.timeout).toBe(60_000)
        if (callCount === 1) {
          this.ontimeout?.()
        } else {
          this.status = 201
          this.response = { attachment_id: 'att-recovered' }
          this.onload?.()
        }
      })
      this.abort = vi.fn()
    })

    const onProgress = (p: number) => progressValues.push(p)
    const id = await uploadMediaFile(
      'ws://127.0.0.1:8787',
      'token',
      new File(['dados'], 'doc.pdf'),
      { kind: 'channel', id: 'geral' },
      onProgress,
    )

    expect(id).toBe('att-recovered')
    expect(callCount).toBe(2)
    expect(progressValues).toContain(0)
  })

  it('detecta estagnacao de progresso apos 15s e aciona retry', async () => {
    vi.useFakeTimers()
    try {
      let callCount = 0
      let abortCalled = false
      vi.stubGlobal('XMLHttpRequest', function MockXHR(this: any) {
        this.upload = {}
        this.open = vi.fn()
        this.setRequestHeader = vi.fn()
        this.abort = vi.fn(() => {
          abortCalled = true
          this.onabort?.()
        })
        this.send = vi.fn(() => {
          callCount += 1
          if (callCount === 1) {
            // Estagna sem resposta
          } else {
            this.status = 201
            this.response = { attachment_id: 'att-after-stall' }
            this.onload?.()
          }
        })
      })

      const uploadPromise = uploadMediaFile(
        'ws://127.0.0.1:8787',
        'token',
        new File(['dados'], 'doc.pdf'),
        { kind: 'channel', id: 'geral' },
      )

      // Avança 15s para estourar o watchdog de estagnação e aguarda delay de retry
      await vi.advanceTimersByTimeAsync(15_001)
      await vi.advanceTimersByTimeAsync(2_000)

      const id = await uploadPromise
      expect(id).toBe('att-after-stall')
      expect(abortCalled).toBe(true)
      expect(callCount).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('metadados e acesso privado', () => {
  it('salva duracao e waveform da mensagem de voz antes do envio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await updatePendingAttachment('ws://127.0.0.1:8787', 'token', 'voice-1', {
      duration_ms: 1_234,
      waveform: [10, 25, 80],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/attachments/voice-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ duration_ms: 1_234, waveform: [10, 25, 80] }),
      }),
    )
  })

  it('troca o id por um ticket temporario sem expor o token de sessao na URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ content_url: '/attachments/file-1/content?ticket=temporary' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(attachmentContentUrl('ws://127.0.0.1:8787', 'secret', 'file-1'))
      .resolves.toBe('http://127.0.0.1:8787/attachments/file-1/content?ticket=temporary')
  })
})
