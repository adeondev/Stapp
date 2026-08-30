export interface PushToTalkBinding {
  readonly global: boolean
  dispose(): Promise<void>
}

export async function bindPushToTalk(
  shortcut: string,
  onPressed: (pressed: boolean) => void,
): Promise<PushToTalkBinding> {
  if ('__TAURI_INTERNALS__' in window) {
    const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
    await register(shortcut, (event) => {
      if (event.state === 'Pressed') onPressed(true)
      if (event.state === 'Released') onPressed(false)
    })
    return {
      global: true,
      async dispose() { await unregister(shortcut) },
    }
  }

  const matches = shortcutMatcher(shortcut)
  const down = (event: KeyboardEvent) => {
    if (!event.repeat && matches(event)) onPressed(true)
  }
  const up = (event: KeyboardEvent) => {
    if (matches(event)) onPressed(false)
  }
  const blur = () => onPressed(false)
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  return {
    global: false,
    async dispose() {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    },
  }
}

function shortcutMatcher(shortcut: string) {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.at(-1) ?? ''
  return (event: KeyboardEvent) => {
    const eventKey = event.code === 'Space' ? 'space' : event.key.toLowerCase()
    return eventKey === key
      && event.ctrlKey === parts.includes('control')
      && event.altKey === parts.includes('alt')
      && event.shiftKey === parts.includes('shift')
      && event.metaKey === parts.includes('meta')
  }
}
