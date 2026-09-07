/**
 * Preferencia de movimento.
 *
 * O padrao continua sendo o do sistema: `theme.css` ja tem um bloco
 * `prefers-reduced-motion` que zera transicoes e animacoes. O que faltava era
 * poder **forcar** a reducao sem mexer no sistema inteiro — em maquina lenta ou
 * por vontade propria.
 *
 * A preferencia vira um atributo na raiz, e nao uma classe em cada componente:
 * `data-motion="reduced"` reaproveita exatamente as mesmas regras do bloco de
 * media, entao nao existe uma segunda lista de coisas para desligar.
 */

export type MotionPreference = 'system' | 'reduced'

const CHAVE = 'stapp.appearance.motion'

export function loadMotionPreference(): MotionPreference {
  try {
    return localStorage.getItem(CHAVE) === 'reduced' ? 'reduced' : 'system'
  } catch {
    // Aba anonima ou armazenamento bloqueado: cai no padrao do sistema.
    return 'system'
  }
}

export function applyMotionPreference(value: MotionPreference) {
  if (typeof document === 'undefined') return
  if (value === 'reduced') document.documentElement.setAttribute('data-motion', 'reduced')
  else document.documentElement.removeAttribute('data-motion')
  try {
    if (value === 'reduced') localStorage.setItem(CHAVE, 'reduced')
    else localStorage.removeItem(CHAVE)
  } catch {
    // Sem armazenamento a escolha vale so para esta sessao — melhor do que nada.
  }
}
