import { describe, expect, it, vi } from 'vitest'
import { uploadMediaFile } from './mediaUpload'

describe('uploadMediaFile', () => {
  it('executa o ciclo completo de presign, PUT e confirm', async () => {
    const mockFile = new File(['teste de conteudo'], 'foto.jpg', { type: 'image/jpeg' })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/attachments/presign')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              attachment_id: 'att-123',
              upload_url: 'http://localhost:9000/stapp-media/uploads/att-123.jpg',
              download_url: '/attachments/files/uploads/att-123.jpg',
              s3_key: 'uploads/att-123.jpg',
            }),
        })
      }
      if (url.includes('/attachments/confirm')) {
        return Promise.resolve({
          ok: true,
        })
      }
      return Promise.reject(new Error('URL desconhecida'))
    })

    globalThis.fetch = fetchMock as any

    // Mock XMLHttpRequest
    const openMock = vi.fn()
    const setRequestHeaderMock = vi.fn()
    const sendMock = vi.fn(function (this: any) {
      this.status = 200
      if (this.onload) this.onload()
    })

    function MockXHR() {
      return {
        open: openMock,
        setRequestHeader: setRequestHeaderMock,
        send: sendMock,
        upload: {},
        status: 200,
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXHR)

    const attachmentId = await uploadMediaFile('http://127.0.0.1:8787', 'fake-token', mockFile)

    expect(attachmentId).toBe('att-123')
    expect(openMock).toHaveBeenCalledWith('PUT', 'http://localhost:9000/stapp-media/uploads/att-123.jpg', true)
    expect(setRequestHeaderMock).toHaveBeenCalledWith('Content-Type', 'image/jpeg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('converte o endereco ws:// do perfil para HTTP antes de chamar o servidor', async () => {
    const mockFile = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/attachments/presign')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              attachment_id: 'att-9',
              upload_url: 'http://localhost:9000/stapp-media/att-9.jpg',
              download_url: '/attachments/files/att-9.jpg',
              s3_key: 'att-9.jpg',
            }),
        })
      }
      return Promise.resolve({ ok: true })
    })
    globalThis.fetch = fetchMock as any

    vi.stubGlobal(
      'XMLHttpRequest',
      function MockXHR() {
        return {
          open: vi.fn(),
          setRequestHeader: vi.fn(),
          send: vi.fn(function (this: any) {
            this.status = 200
            if (this.onload) this.onload()
          }),
          upload: {},
          status: 200,
        }
      }
    )

    await uploadMediaFile('ws://127.0.0.1:8787', 'fake-token', mockFile)

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/attachments/presign')
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8787/attachments/confirm')
  })
})