export interface CallGridLayoutResult {
  columns: number
  rows: number
  tileWidth: number
  tileHeight: number
}

/**
 * Calcula dinamicamente o número ideal de colunas e linhas para dispor
 * `count` participantes em um contêiner de dimensões dadas, maximizando a área
 * útil dos tiles com aspect ratio alvo (padrão 16:9) e evitando qualquer transbordo.
 */
export function calculateCallGridLayout(
  count: number,
  containerWidth: number,
  containerHeight: number,
  targetAspectRatio = 16 / 9,
  gap = 12,
): CallGridLayoutResult {
  if (count <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return {
      columns: 1,
      rows: 1,
      tileWidth: 0,
      tileHeight: 0,
    }
  }

  let bestLayout: CallGridLayoutResult = {
    columns: 1,
    rows: count,
    tileWidth: 0,
    tileHeight: 0,
  }
  let maxArea = -1

  for (let c = 1; c <= count; c++) {
    const r = Math.ceil(count / c)

    const availWidth = Math.max(0, containerWidth - (c - 1) * gap)
    const availHeight = Math.max(0, containerHeight - (r - 1) * gap)

    if (availWidth <= 0 || availHeight <= 0) continue

    const maxTileWidth = availWidth / c
    const maxTileHeight = availHeight / r

    // Verifica restrição por largura vs altura de acordo com a proporção de aspecto alvo
    const widthConstrainedHeight = maxTileWidth / targetAspectRatio
    const heightConstrainedWidth = maxTileHeight * targetAspectRatio

    let tileWidth: number
    let tileHeight: number

    if (widthConstrainedHeight <= maxTileHeight) {
      tileWidth = maxTileWidth
      tileHeight = widthConstrainedHeight
    } else {
      tileWidth = heightConstrainedWidth
      tileHeight = maxTileHeight
    }

    const area = tileWidth * tileHeight

    // Maximizamos a área útil do tile.
    // Se a área for virtualmente idêntica (dentro de 0.5%), favorecemos a configuração
    // com menor número de slots ociosos (c * r - count).
    const isSignificantlyBetter = area > maxArea * 1.001
    const isSimilar = Math.abs(area - maxArea) <= maxArea * 0.005
    const fewerEmptySlots = c * r < bestLayout.columns * bestLayout.rows

    if (isSignificantlyBetter || (isSimilar && fewerEmptySlots)) {
      maxArea = area
      bestLayout = {
        columns: c,
        rows: r,
        tileWidth: Math.floor(tileWidth),
        tileHeight: Math.floor(tileHeight),
      }
    }
  }

  return bestLayout
}
