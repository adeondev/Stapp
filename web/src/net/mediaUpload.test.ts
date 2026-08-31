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
})