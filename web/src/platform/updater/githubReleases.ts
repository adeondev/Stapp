import type { UpdateChannel } from './types'

export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GitHubReleaseItem {
  id: number
  tag_name: string
  name: string
  draft: boolean
  prerelease: boolean
  published_at?: string
  assets: GitHubReleaseAsset[]
}

export const GITHUB_RELEASES_URL = 'https://api.github.com/repos/adeondev/Stapp/releases'

/**
 * Filtra e seleciona a URL do manifesto `latest.json` correspondente ao canal desejado.
 */
export function selectReleaseEndpoint(
  releases: GitHubReleaseItem[],
  channel: UpdateChannel,
): string | null {
  for (const rel of releases) {
    if (rel.draft) continue
    if (channel === 'stable' && rel.prerelease) continue

    const updaterAsset = rel.assets.find((a) => a.name === 'latest.json')
    if (updaterAsset?.browser_download_url) {
      return updaterAsset.browser_download_url
    }
  }
  return null
}

/**
 * Consulta a API publica do GitHub para resolver dinamicamente o endpoint do `latest.json`.
 * Se o canal for 'beta', considera pre-releases.
 * Se o canal for 'stable', considera apenas releases estáveis.
 * Retorna null em caso de falha de rede/rate-limit para permitir fallback.
 */
export async function resolveUpdateEndpoint(
  channel: UpdateChannel,
  apiUrl = GITHUB_RELEASES_URL,
): Promise<string | null> {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!response.ok) {
      console.warn(`[GitHubReleases] Resposta nao sucedida da API (${response.status})`)
      return null
    }

    const releases = (await response.json()) as GitHubReleaseItem[]
    if (!Array.isArray(releases)) return null

    return selectReleaseEndpoint(releases, channel)
  } catch (err) {
    console.warn('[GitHubReleases] Erro ao consultar releases:', err)
    return null
  }
}
