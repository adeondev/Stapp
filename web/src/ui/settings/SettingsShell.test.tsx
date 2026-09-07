// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '../Overlay'
import { SettingsShell } from './SettingsShell'
import { SettingsSelect } from './primitives'
import { IconMic } from '../Icons'

/* O `<select>` das configuracoes "nao abria". Ele abria: o `PopupMenu` vai para
   o `document.body` por portal, e estava em `z-index: 300` — abaixo do
   `--z-modal: 400` do proprio dialogo de configuracoes. A lista nascia atras do
   scrim, invisivel e sem receber clique.
   O conserto e uma camada nova (`--z-menu`, acima de `--z-modal`) — e camada o
   jsdom nao aplica, porque ele nao carrega CSS. O que da para travar aqui e a
   outra metade: a lista aparece no DOM ao clicar, e ela nasce FORA do dialogo,
   como irma dele no `body`. E justamente por serem irmaos que quem decide o que
   fica na frente e a camada, e nao a arvore. */

function Casca({ onChange = vi.fn() }: { onChange?(valor: string): void }) {
  return (
    <SettingsShell
      open
      onClose={vi.fn()}
      groups={[{
        title: 'Aplicativo',
        categories: [{
          id: 'voice',
          label: 'Voz e vídeo',
          icon: <IconMic size={16} />,
          render: () => (
            <SettingsSelect
              label="Microfone"
              value="mic-1"
              options={[
                { value: 'mic-1', label: 'Microfone (Realtek Audio)' },
                { value: 'mic-2', label: 'Headset USB' },
              ]}
              onChange={onChange}
            />
          ),
        }],
      }]}
    />
  )
}

/** O botao que abre a lista. O `<label>` em volta rouba o nome acessivel dele,
    entao o alvo e o texto da opcao escolhida. */
function gatilho(): HTMLElement {
  const alvo = screen.getByText('Microfone (Realtek Audio)').closest('button')
  if (!alvo) throw new Error('o gatilho do dropdown sumiu')
  return alvo
}

describe('dropdown dentro das configurações', () => {
  it('abre a lista de opções e devolve a escolha', async () => {
    const usuario = userEvent.setup()
    const onChange = vi.fn()
    render(<Casca onChange={onChange} />)

    expect(screen.queryByRole('menu', { name: 'Microfone' })).toBeNull()

    await usuario.click(gatilho())
    const menu = await screen.findByRole('menu', { name: 'Microfone' })
    expect(menu).toBeTruthy()

    await usuario.click(screen.getByRole('menuitemcheckbox', { name: /Headset USB/ }))
    expect(onChange).toHaveBeenCalledWith('mic-2')
    expect(screen.queryByRole('menu', { name: 'Microfone' })).toBeNull()
  })

  it('desenha a lista acima do diálogo, e não atrás do scrim', async () => {
    const usuario = userEvent.setup()
    render(<Casca />)
    await usuario.click(gatilho())

    const menu = await screen.findByRole('menu', { name: 'Microfone' })
    const dialogo = screen.getByRole('dialog')
    // Os dois sao filhos diretos do `body` (portal): nenhum contem o outro,
    // entao quem decide o que fica na frente e a camada, nao a arvore.
    expect(menu.closest('.overlay')).toBeNull()
    expect(dialogo.closest('.overlay')).not.toBeNull()
    expect(menu.className).toContain('menu-surface')
  })
})

/* Dialogo dentro de dialogo virou caso real com o enquadramento de imagem, que
   abre por cima das configuracoes. Os dois escutam `keydown` na janela em
   captura, e quem monta primeiro recebe primeiro — Escape no de cima fechava o
   de baixo e levava os dois. */
describe('diálogo sobre diálogo', () => {
  it('Escape fecha só o de cima', async () => {
    const usuario = userEvent.setup()
    const fecharFundo = vi.fn()
    const fecharTopo = vi.fn()
    render(
      <>
        <Modal open onClose={fecharFundo} label="Configurações">
          <p>fundo</p>
        </Modal>
        <Modal open onClose={fecharTopo} label="Enquadrar o avatar">
          <p>topo</p>
        </Modal>
      </>,
    )

    await usuario.keyboard('{Escape}')
    expect(fecharTopo).toHaveBeenCalledTimes(1)
    expect(fecharFundo).not.toHaveBeenCalled()
  })
})
