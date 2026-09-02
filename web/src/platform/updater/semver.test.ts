import { describe, expect, it } from 'vitest'
import { compareSemver, isGreaterThan, isLessThan, isSatisfied, parseSemver } from './semver'

describe('semver parsing and comparison', () => {
  it('faz o parse correto de versoes semver padrao e com prefixo v', () => {
    expect(parseSemver('0.1.0')).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: [],
      raw: '0.1.0',
    })

    expect(parseSemver('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      raw: 'v1.2.3',
    })

    expect(parseSemver('2.0.0-rc.1+build.123')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ['rc', 1],
      raw: '2.0.0-rc.1+build.123',
    })

    expect(parseSemver('invalido')).toBeNull()
    expect(parseSemver('')).toBeNull()
  })

  it('compara corretamente versoes normais', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('0.1.0', '0.1.1')).toBe(-1)
    expect(compareSemver('0.1.9', '0.2.0')).toBe(-1)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
    expect(compareSemver('v0.2.0', '0.1.9')).toBe(1)
  })

  it('respeita regras de precedencia de pre-releases', () => {
    // Release final tem precedencia maior que pre-release
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(1)

    // Pre-releases ordenados
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-beta')).toBe(-1)
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1)
    expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1)
  })

  it('avalia isLessThan e isGreaterThan', () => {
    expect(isLessThan('0.1.0', '0.1.1')).toBe(true)
    expect(isLessThan('0.1.1', '0.1.0')).toBe(false)
    expect(isLessThan('0.1.0', '0.1.0')).toBe(false)

    expect(isGreaterThan('0.2.0', '0.1.0')).toBe(true)
    expect(isGreaterThan('0.1.0', '0.2.0')).toBe(false)
  })

  it('valida satisfacao de versao minima com isSatisfied', () => {
    expect(isSatisfied('0.1.0', null)).toBe(true)
    expect(isSatisfied('0.1.0', undefined)).toBe(true)
    expect(isSatisfied('0.1.0', '')).toBe(true)
    expect(isSatisfied('0.2.0', '0.1.0')).toBe(true)
    expect(isSatisfied('0.1.0', '0.1.0')).toBe(true)
    expect(isSatisfied('0.1.0', '0.2.0')).toBe(false)
    expect(isSatisfied('0.1.0', 'v0.1.0')).toBe(true)
    expect(isSatisfied('v0.2.0', '0.1.5')).toBe(true)
  })
})
