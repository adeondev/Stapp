import { describe, expect, it } from 'vitest'
import { consultaDeMencao } from './MentionAutocomplete'

describe('consultaDeMencao', () => {
  it('abre no arroba que comeca uma palavra', () => {
    expect(consultaDeMencao('@dan', 4)).toBe('dan')
    expect(consultaDeMencao('fala @al', 8)).toBe('al')
    // Arroba sozinho ainda abre: e o comeco da busca.
    expect(consultaDeMencao('oi @', 4)).toBe('')
  })

  it('nao abre no meio de uma palavra', () => {
    // Senao digitar um e-mail abriria o popup a cada tecla.
    expect(consultaDeMencao('daniel@empresa', 14)).toBeNull()
  })

  it('fecha quando o nome ja terminou', () => {
    expect(consultaDeMencao('@daniel ja falou', 16)).toBeNull()
  })

  it('so olha o que esta antes do cursor', () => {
    expect(consultaDeMencao('@daniel', 3)).toBe('da')
  })
})
