export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
  raw: string
}

/**
 * Faz o parse de uma string semver (com ou sem prefixo 'v').
 */
export function parseSemver(versionStr: string): ParsedSemver | null {
  if (!versionStr || typeof versionStr !== 'string') return null
  const clean = versionStr.trim().replace(/^v/i, '')
  
  // Expressao regular compativel com SemVer 2.0.0
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(clean)
  if (!match) return null

  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const patch = parseInt(match[3], 10)

  const prerelease: Array<string | number> = match[4]
    ? match[4].split('.').map((part) => {
        const num = parseInt(part, 10)
        return isNaN(num) || num.toString() !== part ? part : num
      })
    : []

  return { major, minor, patch, prerelease, raw: versionStr }
}

/**
 * Compara duas versoes SemVer (a e b).
 * Retorna:
 *  -1 se a < b
 *   0 se a == b
 *   1 se a > b
 */
export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)

  if (!parsedA && !parsedB) return 0
  if (!parsedA) return -1
  if (!parsedB) return 1

  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor > parsedB.minor ? 1 : -1
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch > parsedB.patch ? 1 : -1
  }

  // Pre-releases: versao normal tem precedencia MAIOR que pre-release
  if (parsedA.prerelease.length === 0 && parsedB.prerelease.length > 0) return 1
  if (parsedA.prerelease.length > 0 && parsedB.prerelease.length === 0) return -1
  if (parsedA.prerelease.length > 0 && parsedB.prerelease.length > 0) {
    const maxLen = Math.max(parsedA.prerelease.length, parsedB.prerelease.length)
    for (let i = 0; i < maxLen; i++) {
      const partA = parsedA.prerelease[i]
      const partB = parsedB.prerelease[i]
      if (partA === undefined) return -1
      if (partB === undefined) return 1
      if (partA === partB) continue

      const typeA = typeof partA
      const typeB = typeof partB
      if (typeA === 'number' && typeB === 'number') {
        return (partA as number) > (partB as number) ? 1 : -1
      }
      if (typeA === 'number' && typeB === 'string') return -1
      if (typeA === 'string' && typeB === 'number') return 1
      return String(partA) > String(partB) ? 1 : -1
    }
  }

  return 0
}

/**
 * Verifica se a versao atual eh estritamente menor que a versao alvo.
 */
export function isLessThan(current: string, target: string): boolean {
  return compareSemver(current, target) < 0
}

/**
 * Verifica se a versao atual eh estritamente maior que a versao alvo.
 */
export function isGreaterThan(current: string, target: string): boolean {
  return compareSemver(current, target) > 0
}

/**
 * Verifica se a versao atual satisfaz o requisito minimo exigido (current >= minRequired).
 */
export function isSatisfied(current: string, minRequired?: string | null): boolean {
  if (!minRequired) return true
  return compareSemver(current, minRequired) >= 0
}
