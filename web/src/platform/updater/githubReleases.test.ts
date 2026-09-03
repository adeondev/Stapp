import { describe, expect, it, vi } from 'vitest'
import { selectReleaseEndpoint, resolveUpdateEndpoint, type GitHubReleaseItem } from './githubReleases'

const mockReleases: GitHubReleaseItem[] = [
  {
    id: 3,
    tag_name: 'v0.1.0-beta.3',
    name: 'Stapp Desktop v0.1.0-beta.3',
    draft: false,
    prerelease: true,
    assets: [
      {
        name: 'latest.json',
        browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.3/latest.json',
      },
      {
        name: 'Stapp_0.1.0-beta.3_x64-setup.exe',
        browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.3/Stapp_0.1.0-beta.3_x64-setup.exe',
      },
    ],
  },
  {
    id: 2,
    tag_name: 'v0.1.0',
    name: 'Stapp Desktop v0.1.0',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'latest.json',
        browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json',
      },
    ],
  },
  {
    id: 1,
    tag_name: 'v0.1.0-beta.1',
    name: 'Stapp Desktop v0.1.0-beta.1',
    draft: false,
    prerelease: true,
    assets: [],
  },
]

describe('githubReleases', () => {
  it('seleciona release beta mais recente quando canal for beta', () => {
    const url = selectReleaseEndpoint(mockReleases, 'beta')
    expect(url).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.3/latest.json')
  })

  it('seleciona primeira release estavel quando canal for stable', () => {
    const url = selectReleaseEndpoint(mockReleases, 'stable')
    expect(url).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json')
  })

  it('ignora drafts e releases sem asset latest.json', () => {
    const draftsOnly: GitHubReleaseItem[] = [
      {
        id: 99,
        tag_name: 'v9.9.9',
        name: 'Draft',
        draft: true,
        prerelease: false,
        assets: [{ name: 'latest.json', browser_download_url: 'https://example.com/draft/latest.json' }],
      },
    ]
    expect(selectReleaseEndpoint(draftsOnly, 'beta')).toBeNull()
    expect(selectReleaseEndpoint(draftsOnly, 'stable')).toBeNull()
  })

  it('resolveUpdateEndpoint faz fetch e retorna a url correspondente', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockReleases,
    })
    globalThis.fetch = mockFetch as any

    const betaUrl = await resolveUpdateEndpoint('beta', 'https://mock.test')
    expect(betaUrl).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.3/latest.json')

    const stableUrl = await resolveUpdateEndpoint('stable', 'https://mock.test')
    expect(stableUrl).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json')
  })

  it('resolveUpdateEndpoint retorna null graciosamente quando fetch falha', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'))
    globalThis.fetch = mockFetch as any

    const res = await resolveUpdateEndpoint('beta', 'https://mock.test')
    expect(res).toBeNull()
  })
})
