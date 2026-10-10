import { ChevronDown, ChevronUp, GripHorizontal } from '../icons'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

export interface PanelPos {
  x: number
  y: number
}

/** Outcome of dropping a panel: re-dock it, nudge it to a clear spot, or leave it where it is. */
export type DropResult = 'dock' | { x: number; y: number } | null

interface DockApi {
  drop: (id: string, rect: DOMRect) => DropResult
}
const DockContext = createContext<DockApi | null>(null)

/**
 * Drag a panel around inside its host (the nearest `[data-drag-host]`, else its offset parent).
 * A dragged panel switches to fixed positioning so it can leave a docked stack cleanly; `onDrop`
 * may claim it back (returning true), which clears the floating position.
 */
export function useDragPanel(onDrop?: (rect: DOMRect) => DropResult) {
  const ref = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<PanelPos | null>(null)
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input')) return
    const panel = ref.current
    const host =
      (panel?.closest('[data-drag-host]') as HTMLElement | null) ??
      (panel?.offsetParent as HTMLElement | null)
    if (!panel || !host) return
    event.preventDefault()
    const box = panel.getBoundingClientRect()
    const area = host.getBoundingClientRect()
    const offsetX = event.clientX - box.left
    const offsetY = event.clientY - box.top
    const move = (next: globalThis.PointerEvent) =>
      setPos({
        x: Math.min(Math.max(area.left, next.clientX - offsetX), area.right - box.width),
        y: Math.min(Math.max(area.top, next.clientY - offsetY), area.bottom - box.height),
      })
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      if (!ref.current || !onDrop) return
      const result = onDrop(ref.current.getBoundingClientRect())
      if (result === 'dock') setPos(null)
      else if (result) setPos(result)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const style: CSSProperties | undefined = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', zIndex: 40 }
    : undefined
  return { ref, style, startDrag, floating: pos !== null }
}

/**
 * A vertical stack of FloatingPanels. Panels dropped back over the column re-dock in the slot
 * they were dropped on, so the stack always reflows and nothing overlays another panel; panels
 * dropped out over the map stay floating.
 */
export function PanelDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{ id: string }>[]
  const [order, setOrder] = useState<string[]>([])
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? order.length + items.findIndex(c => c.props.id === id) : i
  }
  const ordered = [...items].sort((a, b) => rank(a.props.id) - rank(b.props.id))
  const drop = (id: string, rect: DOMRect): DropResult => {
    const dock = ref.current
    if (!dock) return null
    const bounds = dock.getBoundingClientRect()
    const overlap = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)
    if (overlap <= 0) return null
    if (overlap < rect.width * 0.5) {
      // Touching the column but not over it: slide clear so nothing overlays the stack.
      const gap = 10
      const host = dock.parentElement?.getBoundingClientRect()
      const leftOfDock = bounds.left - gap - rect.width
      const rightOfDock = bounds.right + gap
      const fitsRight = host ? rightOfDock + rect.width <= host.right : false
      const x = rect.left < bounds.left || !fitsRight ? leftOfDock : rightOfDock
      return { x: Math.max(host?.left ?? 0, x), y: rect.top }
    }
    const centreY = rect.top + rect.height / 2
    const docked = Array.from(dock.children)
      .filter(el => el instanceof HTMLElement && !el.classList.contains('floating'))
      .map(el => el as HTMLElement)
      .filter(el => el.dataset.panelId && el.dataset.panelId !== id)
      .map(el => {
        const r = el.getBoundingClientRect()
        return { id: el.dataset.panelId!, y: r.top + r.height / 2 }
      })
    const before = docked.filter(d => d.y < centreY).map(d => d.id)
    const after = docked.filter(d => d.y >= centreY).map(d => d.id)
    const placed = new Set([...before, id, ...after])
    const rest = items.map(c => c.props.id).filter(x => !placed.has(x))
    setOrder([...before, id, ...after, ...rest])
    return 'dock'
  }
  return (
    <DockContext.Provider value={{ drop }}>
      <div ref={ref} className="panel-dock">
        {ordered}
      </div>
    </DockContext.Provider>
  )
}

/**
 * The shared draggable, collapsible panel used over the map on both the Planning and Live
 * Flight workspaces, so the two pages read as one product.
 */
export function FloatingPanel({
  id,
  icon,
  title,
  subtitle,
  actions,
  className = '',
  defaultOpen = true,
  placement,
  children,
}: {
  /** Stable id, required inside a PanelDock so it can re-dock and reorder the panel. */
  id?: string
  icon: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
  defaultOpen?: boolean
  /** Where the panel starts before the operator drags it (any inset/width CSS). */
  placement?: CSSProperties
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const dock = useContext(DockContext)
  const { ref, style, startDrag, floating } = useDragPanel(
    dock && id ? rect => dock.drop(id, rect) : undefined,
  )
  // Automation (the guided demo) can open or collapse a panel by dispatching
  // `fortis:panel` on the element with `detail: { open: boolean }`.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onSignal = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail
      if (typeof detail?.open === 'boolean') setOpen(detail.open)
    }
    el.addEventListener('fortis:panel', onSignal)
    return () => el.removeEventListener('fortis:panel', onSignal)
  }, [ref])
  return (
    <aside
      ref={ref}
      data-panel-id={id}
      data-panel-signal=""
      className={`mission-panel ${className}${open ? '' : ' collapsed'}${floating ? ' floating' : ''}`}
      style={{ ...placement, ...style }}
    >
      <header className="mp-header" onPointerDown={startDrag} title="Drag to move">
        <GripHorizontal className="mp-grip" />
        <span className="mp-icon">{icon}</span>
        <div className="mp-title">
          <b>{title}</b>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {actions}
        <button
          className="mp-icon-btn"
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
        </button>
      </header>
      {open && children}
    </aside>
  )
}
