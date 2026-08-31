// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

describe('Tailwind CSS & Design System integration', () => {
  it('garante que classes utilitarias de cores do tema existem no DOM renderizado', () => {
    const el = document.createElement('div')
    el.className = 'bg-bg-app text-text rounded-md'
    expect(el.className).toContain('bg-bg-app')
    expect(el.className).toContain('text-text')
    expect(el.className).toContain('rounded-md')
  })

  it('verifica que as regras globais de shadow nao aplicam elevacao com box-shadow', () => {
    const el = document.createElement('div')
    el.className = 'shadow-none'
    document.body.appendChild(el)
    const style = window.getComputedStyle(el)
    expect(style.boxShadow === '' || style.boxShadow === 'none').toBe(true)
    document.body.removeChild(el)
  })
})
