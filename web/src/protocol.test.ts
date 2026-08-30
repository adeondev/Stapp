import { describe, expect, it } from 'vitest'
import rustProtocol from '../../server/src/protocol.rs?raw'
import { PROTOCOL_VERSION } from './protocol'

describe('paridade de protocolo', () => {
  it('mantem a versao Rust e TypeScript iguais', () => {
    const version = rustProtocol.match(/PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/)?.[1]
    expect(Number(version)).toBe(PROTOCOL_VERSION)
  })
})
