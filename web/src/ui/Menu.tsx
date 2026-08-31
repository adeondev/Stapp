import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevronDown } from './Icons'
import './menu.css'

export interface MenuPosition {
  x: number
  y: number
  /** Optional identity/anchor used by shared menus to toggle from the same button. */
  menuKey?: string
  trigger?: HTMLElement
}

interface PopupMenuProps {
  position: MenuPosition
  label: string
  children: React.ReactNode
  onClose(): void
  className?: string
  trigger?: HTMLElement
}

export function PopupMenu({ position, label, children, onClose, className = '', trigger }: PopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(position)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const margin = 8
    const rect = menu.getBoundingClientRect()
    setPlaced({
      x: Math.max(margin, Math.min(position.x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(position.y, window.innerHeight - rect.height - margin)),
    })
    menu.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus()
  }, [position.x, position.y])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (trigger?.contains(event.target as Node)) return
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const close = () => onClose()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose, trigger])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return createPortal(
    <div ref={ref} className={`menu-surface ${className}`} role="menu" aria-label={label}
      style={{ left: placed.x, top: placed.y }} onKeyDown={onKeyDown}>
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ children, icon, danger = false, selected = false, checked, onClick, disabled = false }: {
  children: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  selected?: boolean
  checked?: boolean
  disabled?: boolean
  onClick(): void
}) {
  const checkable = checked !== undefined || selected
  return <button type="button" role={checkable ? 'menuitemcheckbox' : 'menuitem'}
    aria-checked={checkable ? (checked ?? selected) : undefined} disabled={disabled}
    className={`menu-item ${danger ? 'is-danger' : ''} ${selected ? 'is-selected' : ''}`}
    onClick={onClick}>
    <span className="menu-item__leading">{icon && <span className="menu-item__icon">{icon}</span>}
      <span className="menu-item__content">{children}</span></span>
    {checkable && <span className="menu-item__check">{(checked ?? selected) && <IconCheck />}</span>}
  </button>
}

export function MenuDivider() { return <div className="menu-divider" role="separator" /> }

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="menu-label">{children}</div>
}

export function MenuSlider({ label, value, onChange }: {
  label: string
  value: number
  onChange(value: number): void
}) {
  return <label className="menu-slider"><span>{label}</span><output>{value}%</output>
    <input type="range" min="0" max="200" value={value}
      onChange={(event) => onChange(Number(event.target.value))} /></label>
}

interface SelectOption { value: string; label: string; detail?: string; icon?: React.ReactNode }

export function DropdownSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: SelectOption[]
  onChange(value: string): void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]
  return <label className="dropdown-select"><span>{label}</span>
    <button ref={button} type="button" aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
      const rect = button.current?.getBoundingClientRect()
      if (rect) setPosition((current) => current ? null : { x: rect.left, y: rect.bottom + 4 })
    }}><span>{selected?.label ?? 'Escolher'}</span><IconChevronDown size={13} /></button>
    {position && <PopupMenu position={position} label={label} onClose={() => setPosition(null)} className="dropdown-select__menu">
      {options.map((option) => <MenuItem key={option.value} icon={option.icon} checked={option.value === value} onClick={() => {
        onChange(option.value)
        setPosition(null)
      }}><span>{option.label}</span>{option.detail && <small>{option.detail}</small>}</MenuItem>)}
    </PopupMenu>}
  </label>
}

interface MenuHostValue {
  open(position: MenuPosition, label: string, content: (close: () => void) => React.ReactNode): void
}

const MenuHostContext = createContext<MenuHostValue>({ open() {} })

export function MenuHost({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{
    position: MenuPosition
    label: string
    content: (close: () => void) => React.ReactNode
    menuKey?: string
    trigger?: HTMLElement
  } | null>(null)
  const close = () => setMenu(null)
  return <MenuHostContext.Provider value={{ open(position, label, content) {
    setMenu((current) => current?.menuKey && current.menuKey === position.menuKey
      ? null
      : { position, label, content, menuKey: position.menuKey, trigger: position.trigger })
  } }}>
    {children}
    {menu && <PopupMenu position={menu.position} label={menu.label} onClose={close} trigger={menu.trigger}>
      {menu.content(close)}
    </PopupMenu>}
  </MenuHostContext.Provider>
}

export function useMenuHost() { return useContext(MenuHostContext) }
