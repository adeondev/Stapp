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
  it('no canal beta escolhe a maior versao, inclusive uma final mais nova que a pre-release', () => {
    const url = selectReleaseEndpoint(mockReleases, 'beta')
    expect(url).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json')
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
  it('ignora a ordem da API e escolhe a versao mais alta (beta.10 depois da beta.9)', () => {
    // Foi exatamente isto que aconteceu em producao: a API listou a beta.9 antes da
    // beta.10, criada cinco horas depois, e o app ficou preso na beta.9.
    const foraDeOrdem: GitHubReleaseItem[] = [
    {
      id: 9,
      tag_name: 'v0.1.0-beta.9',
      name: 'Stapp Desktop v0.1.0-beta.9',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.9/latest.json' }],
    },
    {
      id: 10,
      tag_name: 'v0.1.0-beta.10',
      name: 'Stapp Desktop v0.1.0-beta.10',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.10/latest.json' }],
    },
    {
      id: 8,
      tag_name: 'v0.1.0-beta.8',
      name: 'Stapp Desktop v0.1.0-beta.8',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.8/latest.json' }],
    },
    ]

    expect(selectReleaseEndpoint(foraDeOrdem, 'beta')).toBe(
      'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.10/latest.json',
    )
  })

  it('compara pre-release numericamente: beta.10 vence beta.9 em qualquer ordem', () => {
    // Se a comparacao fosse de string, "beta.10" perderia de "beta.9" porque "1" < "9".
    const crescente: GitHubReleaseItem[] = [
      {
        id: 9,
        tag_name: 'v0.1.0-beta.9',
        name: 'Stapp Desktop v0.1.0-beta.9',
        draft: false,
        prerelease: true,
        assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.9/latest.json' }],
      },
      {
        id: 10,
        tag_name: 'v0.1.0-beta.10',
        name: 'Stapp Desktop v0.1.0-beta.10',
        draft: false,
        prerelease: true,
        assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.10/latest.json' }],
      },
    ]
    const decrescente: GitHubReleaseItem[] = [...crescente].reverse()

    expect(selectReleaseEndpoint(crescente, 'beta')).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.10/latest.json')
    expect(selectReleaseEndpoint(decrescente, 'beta')).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.10/latest.json')
  })

  it('no canal stable ignora pre-releases e pega a maior final', () => {
    const mistura: GitHubReleaseItem[] = [
    {
      id: 1,
      tag_name: 'v0.1.0',
      name: 'Stapp Desktop v0.1.0',
      draft: false,
      prerelease: false,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json' }],
    },
    {
      id: 2,
      tag_name: 'v0.2.0',
      name: 'Stapp Desktop v0.2.0',
      draft: false,
      prerelease: false,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.2.0/latest.json' }],
    },
    {
      id: 3,
      tag_name: 'v0.3.0-beta.1',
      name: 'Stapp Desktop v0.3.0-beta.1',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.3.0-beta.1/latest.json' }],
    },
    ]

    expect(selectReleaseEndpoint(mistura, 'stable')).toBe('https://github.com/adeondev/Stapp/releases/download/v0.2.0/latest.json')
    expect(selectReleaseEndpoint(mistura, 'beta')).toBe('https://github.com/adeondev/Stapp/releases/download/v0.3.0-beta.1/latest.json')
  })

  it('uma tag fora do padrao semver nunca vence uma legivel', () => {
    const comLixo: GitHubReleaseItem[] = [
    {
      id: 1,
      tag_name: 'nightly',
      name: 'Stapp Desktop nightly',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/nightly/latest.json' }],
    },
    {
      id: 2,
      tag_name: 'v0.1.0-beta.2',
      name: 'Stapp Desktop v0.1.0-beta.2',
      draft: false,
      prerelease: true,
      assets: [{ name: 'latest.json', browser_download_url: 'https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.2/latest.json' }],
    },
    ]

    expect(selectReleaseEndpoint(comLixo, 'beta')).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0-beta.2/latest.json')
  })

  it('resolveUpdateEndpoint faz fetch e retorna a url correspondente', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockReleases,
    })
    globalThis.fetch = mockFetch as any

    const betaUrl = await resolveUpdateEndpoint('beta', 'https://mock.test')
    expect(betaUrl).toBe('https://github.com/adeondev/Stapp/releases/download/v0.1.0/latest.json')

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
