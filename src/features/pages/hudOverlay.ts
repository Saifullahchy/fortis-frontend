import { Cartesian2, Cartesian3, SceneTransforms, type Scene, type Viewer } from 'cesium'

/**
 * Tracking HUD drawn over the Cesium canvas: corner brackets and a callout card with a leader
 * line. It is 2D-canvas, redrawn on `scene.postRender`, so it never competes with Cesium geometry.
 */

export interface HudTarget {
  position: Cartesian3
  title: string
  details: string[]
}

const STYLE = {
  line: '#22e0ff',
  glow: 'rgba(0, 244, 255, 0.4)',
  accent: '#39d0ff',
  cardBg: 'rgba(4, 12, 16, 0.82)',
  title: 'rgba(232, 240, 244, 0.96)',
  detail: 'rgba(147, 161, 173, 0.92)',
  fontTitle: '600 13px "JetBrains Mono", monospace',
  fontDetail: '500 11px "JetBrains Mono", monospace',
}

const nearFarScale = (d: number, near: number, nv: number, far: number, fv: number) => {
  const t = Math.min(Math.max((d - near) / (far - near), 0), 1)
  return nv + (fv - nv) * t
}
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b)

function cornerBracket(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hw: number,
  hh: number,
) {
  const x0 = sx - hw
  const y0 = sy - hh
  const x1 = sx + hw
  const y1 = sy + hh
  const seg = Math.max(4, Math.floor(Math.min(hw, hh) * 0.55))
  ctx.moveTo(x0, y0 + seg)
  ctx.lineTo(x0, y0)
  ctx.lineTo(x0 + seg, y0)
  ctx.moveTo(x1 - seg, y0)
  ctx.lineTo(x1, y0)
  ctx.lineTo(x1, y0 + seg)
  ctx.moveTo(x1, y1 - seg)
  ctx.lineTo(x1, y1)
  ctx.lineTo(x1 - seg, y1)
  ctx.moveTo(x0 + seg, y1)
  ctx.lineTo(x0, y1)
  ctx.lineTo(x0, y1 - seg)
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fit(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

const toWindow = (scene: Scene, p: Cartesian3) =>
  SceneTransforms.worldToWindowCoordinates(scene, p, new Cartesian2())

/** Draws the glowing bracket layer (screen-blended) and the callout layer (normal blend). */
export function drawHud(
  viewer: Viewer,
  surface: HTMLCanvasElement,
  cards: HTMLCanvasElement,
  target: HudTarget | null,
) {
  const s = fit(surface)
  const c = fit(cards)
  s.ctx.clearRect(0, 0, s.w, s.h)
  c.ctx.clearRect(0, 0, c.w, c.h)
  if (!target) return
  const scene = viewer.scene
  const cam = scene.camera.positionWC

  // Tracked asset: large bracket, leader and callout card.
  const win = toWindow(scene, target.position)
  if (!win) return
  const bs = nearFarScale(Cartesian3.distance(cam, target.position), 1000, 3, 8_000_000, 0.5)
  const hw = clamp(14 * bs, 7, 48)
  const hh = clamp(11 * bs, 5, 38)
  s.ctx.beginPath()
  cornerBracket(s.ctx, win.x, win.y, hw, hh)
  s.ctx.lineWidth = 1.25
  s.ctx.strokeStyle = STYLE.line
  s.ctx.stroke()

  const padX = 13
  const padY = 9
  const titleH = 13
  const lineH = 17
  c.ctx.font = STYLE.fontTitle
  let width = c.ctx.measureText(target.title).width
  c.ctx.font = STYLE.fontDetail
  for (const d of target.details) width = Math.max(width, c.ctx.measureText(d).width)
  const w = Math.ceil(width + padX * 2)
  const h = padY * 2 + titleH + target.details.length * lineH
  const anchorR = clamp(10 * bs, 6, 30)
  const gap = anchorR + Math.max(16, anchorR + 10)
  const x = clamp(win.x - w / 2, 6, c.w - w - 6)
  const y = clamp(win.y - gap - h, 6, c.h - h - 6)

  c.ctx.beginPath()
  c.ctx.moveTo(win.x, win.y - anchorR)
  c.ctx.lineTo(win.x, y + h)
  c.ctx.lineWidth = 1.35
  c.ctx.lineCap = 'round'
  c.ctx.strokeStyle = 'rgba(147, 213, 228, 0.58)'
  c.ctx.stroke()
  c.ctx.beginPath()
  roundedRect(c.ctx, x, y, w, h, 5)
  c.ctx.fillStyle = STYLE.cardBg
  c.ctx.fill()
  c.ctx.strokeStyle = 'rgba(107, 232, 255, 0.72)'
  c.ctx.lineWidth = 1
  c.ctx.stroke()
  c.ctx.beginPath()
  roundedRect(c.ctx, x, y, w, 2, 1)
  c.ctx.fillStyle = STYLE.accent
  c.ctx.fill()
  c.ctx.textAlign = 'center'
  c.ctx.textBaseline = 'alphabetic'
  const cx = x + w / 2
  const base = y + padY + titleH - 2
  c.ctx.fillStyle = STYLE.title
  c.ctx.font = STYLE.fontTitle
  c.ctx.fillText(target.title, cx, base)
  c.ctx.fillStyle = STYLE.detail
  c.ctx.font = STYLE.fontDetail
  target.details.forEach((d, i) => c.ctx.fillText(d, cx, base + (i + 1) * lineH))
}
