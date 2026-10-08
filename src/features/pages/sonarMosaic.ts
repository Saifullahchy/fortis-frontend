import type { TelemetryFrame } from './missionSimulator'
import { seabedDepth } from './missionSimulator'
import { METERS_PER_UNIT, type Point } from './missionGeometry'

/**
 * Forward-looking sonar model shared by the fan tile and the map mosaic. Returns are synthesised
 * from the same bathymetry the simulator uses, so the bottom band moves with the craft and the
 * shoals it reports. A real sonar replaces `computeReturns()` with the device's ping data.
 */
export const FAN_DEG = 120
export const BEAMS = 96
export const BINS = 110
export const RANGE_M = 50
export const PING_MS = 250

/** Deterministic speckle, stable between frames except where `t` (the ping count) changes. */
export function hash(x: number, y: number, t: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + t * 0.37) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Seabed reflectivity at a world cell: sediment patches (hard sand bright, silt dark), sand
 * ripples, per-cell speckle, and sparse objects (rock, debris) that stand proud of the bottom.
 * Tied to the world cell, so every ping that sees a spot agrees about it and overlapping
 * swaths mosaic cleanly.
 */
function seabedCell(px: number, py: number) {
  const mx = px * METERS_PER_UNIT
  const my = py * METERS_PER_UNIT
  // Sediment: broad patches, 15–40 m across.
  const patch =
    0.5 +
    0.5 * Math.sin(mx / 23 + 0.7 * Math.sin(my / 31)) * Math.cos(my / 27 + 0.5 * Math.sin(mx / 19))
  const sediment = 0.35 + 0.5 * patch
  // Ripples: fine bands across the prevailing current, broken up by noise.
  const ripple =
    0.5 +
    0.5 *
      Math.sin(
        (mx * 0.62 + my * 0.78) * 2.1 + 1.5 * hash(Math.floor(mx / 4), Math.floor(my / 4), 0),
      )
  const speckle = hash(Math.round(px * 2), Math.round(py * 2), 0)
  // Speckle dominates, as it does in real backscatter; ripples are a faint modulation.
  const reflectivity = sediment * (0.78 + 0.22 * ripple) * (0.45 + 0.55 * speckle)
  // Objects: one coarse cell in ~45 holds something 0.4–1.6 m high.
  const cx = Math.floor(mx / 5)
  const cy = Math.floor(my / 5)
  const h = hash(cx * 7, cy * 13, 1)
  const object = h > 0.978 ? 0.4 + ((h - 0.978) / 0.022) * 1.2 : 0
  return { reflectivity, object }
}

/**
 * Intensity 0–1 per beam and range bin (row-major, BEAMS × BINS) for one ping, in slant range
 * as the sonar sees it: the water column before the first bottom return, a bright first return,
 * backscatter that fades with grazing angle and range, and acoustic shadows behind objects.
 */
export function computeReturns(
  frame: TelemetryFrame,
  underwater: boolean,
  gain: number,
  t: number,
  /** Mosaic flavour: full range and grazing compensation, no first-return highlight. */
  flat = false,
): Float32Array {
  const out = new Float32Array(BEAMS * BINS)
  const half = (FAN_DEG / 2) * (Math.PI / 180)
  const hd = (frame.heading * Math.PI) / 180
  const water = frame.water
  const g = 0.5 + gain / 100
  const depth = underwater ? (water?.depth ?? 0) : 0
  for (let b = 0; b < BEAMS; b++) {
    const rel = -half + (b / (BEAMS - 1)) * 2 * half
    const bearing = hd + rel
    const sx = Math.sin(bearing) / METERS_PER_UNIT
    const sy = -Math.cos(bearing) / METERS_PER_UNIT
    let shadowUntil = 0
    for (let i = 0; i < BINS; i++) {
      const r = ((i + 0.5) / BINS) * RANGE_M
      const px = frame.position.x + sx * r
      const py = frame.position.y + sy * r
      const bottom = Math.max(0.5, seabedDepth({ x: px, y: py }, METERS_PER_UNIT) - depth)
      const noise = hash(b, i, t)
      // Water column: nothing to echo before the beam reaches the bottom.
      if (r < bottom) {
        out[b * BINS + i] = noise * noise * 0.06 * g
        continue
      }
      const cell = seabedCell(px, py)
      const ground = Math.sqrt(r * r - bottom * bottom)
      // Grazing angle: steep near nadir (bright), shallow far out (dim); TVG recovers most of
      // the spreading loss but not all of it.
      const grazing = bottom / r
      const tvg = 1 - 0.45 * (r / RANGE_M) ** 2
      const first = flat ? 0 : Math.exp(-((r - bottom) ** 2) / (2 * (0.5 + bottom * 0.08) ** 2))
      let v = flat
        ? (0.12 + 0.78 * cell.reflectivity) * 0.9
        : (0.18 + 0.82 * cell.reflectivity) * (0.35 + 0.65 * grazing) * tvg
      v = v * (0.75 + 0.5 * noise) + first * 0.55
      // An object stands proud: bright face toward the sonar, then a shadow as long as its
      // height divided by the grazing slope.
      if (cell.object > 0 && r > shadowUntil) {
        v = Math.min(1, v + 0.5 + cell.object * 0.3)
        shadowUntil = r + (cell.object * ground) / bottom
      } else if (r < shadowUntil) {
        v *= 0.08
      }
      out[b * BINS + i] = Math.min(1, v * g)
    }
  }
  return out
}

// ---- world mosaic ------------------------------------------------------------------------------

/** 2 px per planning unit (0.2 m/px) over the grid plus a margin all round. */
const PX_PER_UNIT = 2
const MARGIN = 150
const W = (800 + 2 * MARGIN) * PX_PER_UNIT
const H = (700 + 2 * MARGIN) * PX_PER_UNIT
/** How often the map's copy of the mosaic is refreshed (a texture upload each time). */
const REFRESH_MS = 500

interface Mosaic {
  /** Everything painted so far. */
  master: HTMLCanvasElement
  /** Double buffer handed to the map; a swap changes identity, which is what reloads it. */
  buffers: [HTMLCanvasElement, HTMLCanvasElement]
  front: 0 | 1
  dirty: boolean
  lastPing: number
  lastRefresh: number
  lastElapsed: number
}

/** One mosaic per craft, kept for the life of the session. */
const mosaics = new Map<string, Mosaic>()

const blank = () => {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return c
}

function mosaicFor(key: string): Mosaic {
  let m = mosaics.get(key)
  if (!m) {
    m = {
      master: blank(),
      buffers: [blank(), blank()],
      front: 0,
      dirty: false,
      lastPing: 0,
      lastRefresh: 0,
      lastElapsed: 0,
    }
    mosaics.set(key, m)
  }
  return m
}

/** Mosaic extent in planning units; the map places the image over this rectangle. */
export const MOSAIC_BOUNDS: { min: Point; max: Point } = {
  min: { x: -MARGIN, y: -MARGIN },
  max: { x: 800 + MARGIN, y: 700 + MARGIN },
}

export function clearMosaic(key: string) {
  const m = mosaicFor(key)
  m.master.getContext('2d')!.clearRect(0, 0, W, H)
  for (const b of m.buffers) b.getContext('2d')!.clearRect(0, 0, W, H)
  m.dirty = false
  m.lastPing = 0
}

/**
 * Paints the current ping into the craft's mosaic (throttled to the ping rate). Returns are
 * laid down as a point cloud in world coordinates, so coverage accumulates under the track as
 * the craft moves; a new run (elapsed time going backwards) starts a fresh mosaic.
 */
export function pingMosaic(
  key: string,
  frame: TelemetryFrame,
  underwater: boolean,
  gain: number,
  now: number,
) {
  const m = mosaicFor(key)
  if (frame.elapsedSeconds < m.lastElapsed) clearMosaic(key)
  m.lastElapsed = frame.elapsedSeconds
  if (now - m.lastPing < PING_MS) return
  m.lastPing = now
  const t = Math.floor(now / PING_MS)
  const returns = computeReturns(frame, underwater, gain, t, true)
  const ctx = m.master.getContext('2d')!
  const half = (FAN_DEG / 2) * (Math.PI / 180)
  const hd = (frame.heading * Math.PI) / 180
  const pxPerM = PX_PER_UNIT / METERS_PER_UNIT
  const depth = underwater ? (frame.water?.depth ?? 0) : 0
  const beamHalf = half / (BEAMS - 1)
  ctx.save()
  ctx.translate(
    (frame.position.x + MARGIN) * PX_PER_UNIT,
    (frame.position.y + MARGIN) * PX_PER_UNIT,
  )
  ctx.rotate(hd)
  for (let b = 0; b < BEAMS; b++) {
    const rel = -half + (b / (BEAMS - 1)) * 2 * half
    // Feather the outer beams so adjacent swaths blend instead of showing a hard edge.
    const edge = Math.min(1, ((half - Math.abs(rel)) / half) * 7)
    const bearing = hd + rel
    const sx = Math.sin(bearing) / METERS_PER_UNIT
    const sy = -Math.cos(bearing) / METERS_PER_UNIT
    for (let i = 0; i < BINS; i++) {
      const r0 = (i / BINS) * RANGE_M
      const r1 = ((i + 1) / BINS) * RANGE_M
      const rm = (r0 + r1) / 2
      const px = frame.position.x + sx * rm
      const py = frame.position.y + sy * rm
      const bottom = Math.max(0.5, seabedDepth({ x: px, y: py }, METERS_PER_UNIT) - depth)
      // Slant-range correction: the water column is dropped (nadir gap) and each bin lands at
      // its ground range on the seabed, not at the range the sonar measured.
      if (r1 <= bottom) continue
      const g0 = Math.sqrt(Math.max(0, r0 * r0 - bottom * bottom))
      const g1 = Math.sqrt(r1 * r1 - bottom * bottom)
      const v = returns[b * BINS + i]
      const far = Math.min(1, (RANGE_M - rm) / (RANGE_M * 0.12))
      const alpha = 0.94 * edge * far
      if (alpha < 0.05) continue
      ctx.beginPath()
      ctx.arc(0, 0, g1 * pxPerM, rel - beamHalf - Math.PI / 2, rel + beamHalf - Math.PI / 2)
      ctx.arc(0, 0, g0 * pxPerM, rel + beamHalf - Math.PI / 2, rel - beamHalf - Math.PI / 2, true)
      ctx.closePath()
      // Survey palette: near-black olive for silt and shadow, bright yellow for hard returns.
      const l = 4 + v * 56
      ctx.fillStyle = `hsla(${48 + v * 8} ${50 + v * 35}% ${l}% / ${alpha})`
      ctx.fill()
    }
  }
  ctx.restore()
  m.dirty = true
}

/**
 * The canvas the map should show right now. Swaps to a fresh copy of the master at the refresh
 * rate while new pings are landing; identity changes only then, which is what makes the map
 * material re-upload its texture.
 */
export function mosaicImage(key: string, now: number): HTMLCanvasElement {
  const m = mosaicFor(key)
  if (m.dirty && now - m.lastRefresh >= REFRESH_MS) {
    const back = m.buffers[m.front === 0 ? 1 : 0]
    const ctx = back.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(m.master, 0, 0)
    m.front = m.front === 0 ? 1 : 0
    m.dirty = false
    m.lastRefresh = now
  }
  return m.buffers[m.front]
}
