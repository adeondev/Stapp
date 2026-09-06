import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAttachmentTicketCache,
  getAttachmentTicket,
  invalidateAttachmentTicket,
  resolveAttachmentUrl,
} from './attachmentTickets'
import * as mediaUpload from './mediaUpload'

vi.mock('./mediaUpload', () => ({
  attachmentContentUrl: vi.fn(),
}))

describe('attachmentTickets', () => {
  const serverUrl = 'http://localhost:9000'
  const accessToken = 'test-token'

  beforeEach(() => {
    clearAttachmentTicketCache()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('resolveAttachmentUrl', () => {
    it('mant�m URLs absolutas ou data/blob', () => {
      expect(resolveAttachmentUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
      expect(resolveAttachmentUrl('data:image/png;base64,...')).toBe('data:image/png;base64,...')
      expect(resolveAttachmentUrl('blob:http://localhost/123')).toBe('blob:http://localhost/123')
    })

    it('resolve URLs relativas adicionando base HTTP do servidor', () => {
      expect(resolveAttachmentUrl('files/pic.jpg', 'ws://localhost:9000')).toBe('http://localhost:9000/files/pic.jpg')
      expect(resolveAttachmentUrl('/files/pic.jpg', 'wss://example.com/ws')).toBe('https://example.com/files/pic.jpg')
    })
  })

  describe('getAttachmentTicket', () => {
    it('deduplica chamadas simult�neas em voo para o mesmo anexo', async () => {
      let resolveFetch!: (url: string) => void
      const fetchPromise = new Promise<string>((resolve) => {
        resolveFetch = resolve
      })
      vi.mocked(mediaUpload.attachmentContentUrl).mockReturnValue(fetchPromise)

      const p1 = getAttachmentTicket(serverUrl, accessToken, 'att-dup')
      const p2 = getAttachmentTicket(serverUrl, accessToken, 'att-dup')

      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(1)

      resolveFetch('http://localhost:9000/content/att-dup')
      const [r1, r2] = await Promise.all([p1, p2])

      expect(r1).toBe('http://localhost:9000/content/att-dup')
      expect(r2).toBe('http://localhost:9000/content/att-dup')
    })

    it('utiliza cache TTL e n�o refaz requisi��o dentro do per�odo', async () => {
      vi.mocked(mediaUpload.attachmentContentUrl).mockResolvedValue('http://localhost:9000/content/att-cached')

      const r1 = await getAttachmentTicket(serverUrl, accessToken, 'att-cached', { ttlMs: 60_000 })
      expect(r1).toBe('http://localhost:9000/content/att-cached')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(1)

      // Avan�a 30 segundos (dentro do TTL)
      vi.advanceTimersByTime(30_000)

      const r2 = await getAttachmentTicket(serverUrl, accessToken, 'att-cached', { ttlMs: 60_000 })
      expect(r2).toBe('http://localhost:9000/content/att-cached')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(1)

      // Avan�a al�m do TTL (60s total)
      vi.advanceTimersByTime(31_000)

      const r3 = await getAttachmentTicket(serverUrl, accessToken, 'att-cached', { ttlMs: 60_000 })
      expect(r3).toBe('http://localhost:9000/content/att-cached')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(2)
    })

    it('permite for�ar renova��o com forceRefresh ignorando o cache', async () => {
      vi.mocked(mediaUpload.attachmentContentUrl)
        .mockResolvedValueOnce('http://localhost:9000/content/v1')
        .mockResolvedValueOnce('http://localhost:9000/content/v2')

      const r1 = await getAttachmentTicket(serverUrl, accessToken, 'att-force')
      expect(r1).toBe('http://localhost:9000/content/v1')

      const r2 = await getAttachmentTicket(serverUrl, accessToken, 'att-force', { forceRefresh: true })
      expect(r2).toBe('http://localhost:9000/content/v2')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(2)
    })

    it('isolar falhas: erro em um anexo n�o afeta a requisi��o de outro', async () => {
      vi.mocked(mediaUpload.attachmentContentUrl).mockImplementation(async (_server, _token, id) => {
        if (id === 'att-err') {
          throw new Error('404 Not Found')
        }
        return `http://localhost:9000/content/${id}`
      })

      const pError = getAttachmentTicket(serverUrl, accessToken, 'att-err')
      const pSuccess = getAttachmentTicket(serverUrl, accessToken, 'att-ok')

      await expect(pError).rejects.toThrow('404 Not Found')
      await expect(pSuccess).resolves.toBe('http://localhost:9000/content/att-ok')
    })

    it('limpa requisi��o em voo ap�s rejei��o permitindo retry posterior', async () => {
      vi.mocked(mediaUpload.attachmentContentUrl)
        .mockRejectedValueOnce(new Error('Network temporary drop'))
        .mockResolvedValueOnce('http://localhost:9000/content/att-retry')

      await expect(getAttachmentTicket(serverUrl, accessToken, 'att-retry')).rejects.toThrow(
        'Network temporary drop',
      )

      const recovered = await getAttachmentTicket(serverUrl, accessToken, 'att-retry')
      expect(recovered).toBe('http://localhost:9000/content/att-retry')
    })

    it('permite invalida��o expl�cita de chave �nica via invalidateAttachmentTicket', async () => {
      vi.mocked(mediaUpload.attachmentContentUrl).mockResolvedValue('http://localhost:9000/content/att-inv')

      await getAttachmentTicket(serverUrl, accessToken, 'att-inv')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(1)

      invalidateAttachmentTicket(serverUrl, 'att-inv')

      await getAttachmentTicket(serverUrl, accessToken, 'att-inv')
      expect(mediaUpload.attachmentContentUrl).toHaveBeenCalledTimes(2)
    })
  })
})
