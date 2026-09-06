// @vitest-environment jsdom

import { render, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Chat } from './Chat'

describe('Chat scroll anchoring with ResizeObserver', () => {
  let observedElements: Element[] = []
  let resizeCallback: (() => void) | null = null

  beforeEach(() => {
    observedElements = []
    resizeCallback = null

    globalThis.ResizeObserver = class MockResizeObserver {
      constructor(cb: () => void) {
        resizeCallback = cb
      }
      observe(el: Element) {
        observedElements.push(el)
      }
      unobserve(el: Element) {
        observedElements = observedElements.filter((e) => e !== el)
      }
      disconnect() {
        observedElements = []
      }
    } as unknown as typeof ResizeObserver
  })

  it('instancia ResizeObserver e observa o container de scroll e o conteudo', () => {
    const { container } = render(
      <Chat
        title="geral"
        kind="channel"
        scopeId="chan-1"
        messages={[
          {
            id: 'msg-1',
            author_id: 'u1',
            author_username: 'Alice',
            text: 'Ola!',
            ts: Date.now(),
          },
        ]}
        canSend={true}
        limits={{
          max_text_chars: 2000,
          max_upload_bytes: 10 * 1024 * 1024,
          max_attachments_per_message: 10,
        }}
        mentionables={[]}
        onSend={() => {}}
      />
    )

    expect(resizeCallback).toBeTruthy()
    const scrollEl = container.querySelector('.chat__scroll')
    const contentEl = container.querySelector('.chat__scroll-content')

    expect(scrollEl).toBeTruthy()
    expect(contentEl).toBeTruthy()
    expect(observedElements).toContain(scrollEl)
    expect(observedElements).toContain(contentEl)
  })

  it('ancora o scroll na base quando pinned está ativo e o conteúdo expande', () => {
    const { container } = render(
      <Chat
        title="geral"
        kind="channel"
        scopeId="chan-1"
        messages={[
          {
            id: 'msg-1',
            author_id: 'u1',
            author_username: 'Alice',
            text: 'Primeira',
            ts: Date.now(),
          },
        ]}
        canSend={true}
        limits={{
          max_text_chars: 2000,
          max_upload_bytes: 10 * 1024 * 1024,
          max_attachments_per_message: 10,
        }}
        mentionables={[]}
        onSend={() => {}}
      />
    )

    const scrollEl = container.querySelector('.chat__scroll') as HTMLDivElement
    expect(scrollEl).toBeTruthy()

    // Simula expansão do scrollHeight (ex: imagem carregando)
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 1200, configurable: true })
    Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true })

    act(() => {
      resizeCallback?.()
    })

    expect(scrollEl.scrollTop).toBe(1200)
  })

  it('preserva a posição absoluta de scroll quando o usuário estava lendo mensagens antigas', () => {
    const { container } = render(
      <Chat
        title="geral"
        kind="channel"
        scopeId="chan-1"
        messages={[
          {
            id: 'msg-1',
            author_id: 'u1',
            author_username: 'Alice',
            text: 'Primeira',
            ts: Date.now(),
          },
        ]}
        canSend={true}
        limits={{
          max_text_chars: 2000,
          max_upload_bytes: 10 * 1024 * 1024,
          max_attachments_per_message: 10,
        }}
        mentionables={[]}
        onSend={() => {}}
      />
    )

    const scrollEl = container.querySelector('.chat__scroll') as HTMLDivElement
    expect(scrollEl).toBeTruthy()

    // Simula que o usuário rolou para cima (posição 250 de um total de 1000)
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true })
    scrollEl.scrollTop = 250

    // Dispara onScroll para atualizar pinned = false
    act(() => {
      scrollEl.dispatchEvent(new Event('scroll'))
    })

    // Agora uma imagem carrega e aumenta o scrollHeight para 1600
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 1600, configurable: true })

    act(() => {
      resizeCallback?.()
    })

    // A rolagem absoluta deve ser preservada em 250
    expect(scrollEl.scrollTop).toBe(250)
  })
})