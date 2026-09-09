import type { UpdateChannel } from './types'
import { compareSemver } from './semver'

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
 * Escolhe o manifesto `latest.json` da MAIOR versao entre as releases elegiveis.
 *
 * Antes esta funcao devolvia a primeira release que a API tivesse listado,
 * confiando que a ordem viesse sempre da mais nova para a mais velha. Essa ordem
 * nao e garantida, e quebrou de verdade: a API listou a v0.1.0-beta.9 antes da
 * v0.1.0-beta.10, criada cinco horas depois. Todo mundo ficava preso na beta.9,
 * porque o app pedia o manifesto dela e concluia que ja estava atualizado — e
 * quem ja estava na beta.10 via uma versao MENOR e tambem nao fazia nada.
 *
 * O canal `stable` so enxerga releases finais. O canal `beta` enxerga tambem as
 * pre-releases, inclusive uma final mais nova: pelo semver, 0.1.0 e maior que
 * 0.1.0-beta.3, e para quem esta numa beta antiga isso e legitimamente a
 * atualizacao a oferecer.
 */
export function selectReleaseEndpoint(
  releases: GitHubReleaseItem[],
  channel: UpdateChannel,
): string | null {
  let escolhida: { tag: string; url: string } | null = null

  for (const rel of releases) {
    if (rel.draft) continue
    if (channel === 'stable' && rel.prerelease) continue

    const updaterAsset = rel.assets.find((a) => a.name === 'latest.json')
    if (!updaterAsset?.browser_download_url) continue

    // compareSemver poe qualquer tag ilegivel abaixo de uma legivel, entao uma tag
    // fora do padrao so vence se nao houver nenhuma outra candidata.
    if (!escolhida || compareSemver(rel.tag_name, escolhida.tag) > 0) {
      escolhida = { tag: rel.tag_name, url: updaterAsset.browser_download_url }
    }
  }

  return escolhida?.url ?? null
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
