// Sem isto o React Testing Library nao desmonta o que cada teste renderizou —
// o DOM de um caso vaza para o proximo e as buscas encontram elemento errado.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

const createStorage = () => {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key]
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

const mockStorage = createStorage()
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  configurable: true,
  writable: true,
})
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  })
}

afterEach(cleanup)
