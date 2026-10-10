export const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

/** Resolve with the first element matching `selector`, polling until `timeout` ms have passed. */
export function waitFor(selector: string, timeout = 8000): Promise<Element | null> {
  return new Promise(resolve => {
    const started = performance.now()
    const look = () => {
      const el = document.querySelector(selector)
      if (el) return resolve(el)
      if (performance.now() - started > timeout) return resolve(null)
      window.setTimeout(look, 80)
    }
    look()
  })
}

export async function clickFirst(selector: string): Promise<boolean> {
  const el = (await waitFor(selector, 3000)) as HTMLElement | null
  if (!el) return false
  el.click()
  return true
}

/**
 * Open or collapse a FloatingPanel by its data-panel-id and wait for the DOM to show it. Only
 * idempotent signals are used (never a toggle click), so a slow render can't flip it back.
 */
async function setPanel(id: string, open: boolean) {
  const panel = await waitFor(`[data-panel-id="${id}"]`, 5000)
  if (!panel) return
  const isOpen = () => !panel.classList.contains('collapsed')
  if (isOpen() === open) return
  const signalled = panel.hasAttribute('data-panel-signal')
  if (signalled) {
    panel.dispatchEvent(new CustomEvent('fortis:panel', { detail: { open } }))
  } else {
    // Older panel without the signal hook: one click on its header toggle.
    panel
      .querySelector<HTMLElement>(
        `.mp-header .mp-icon-btn[title="${open ? 'Expand' : 'Collapse'}"]`,
      )
      ?.click()
  }
  const started = performance.now()
  while (isOpen() !== open && performance.now() - started < 2000) {
    await sleep(50)
    // A render can lag behind a busy map: re-send the (idempotent) signal while we wait.
    if (signalled && (performance.now() - started) % 400 < 50)
      panel.dispatchEvent(new CustomEvent('fortis:panel', { detail: { open } }))
  }
  await sleep(80)
}

/** Expand a collapsed FloatingPanel (by its data-panel-id). */
export const openPanel = (id: string) => setPanel(id, true)

/** Collapse an expanded FloatingPanel so the panels beside it get the room they need. */
export const closePanel = (id: string) => setPanel(id, false)

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export const measure = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export const sameRect = (a: Rect | null, b: Rect | null) =>
  !!a &&
  !!b &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5
