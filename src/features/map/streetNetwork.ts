import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { RoadClass, StreetOptions } from '../../types/domain'
import { fromGeo, toGeo } from '../pages/MissionHud'
import { useHome } from '../pages/homePosition'
import {
  HOME,
  METERS_PER_UNIT,
  chainRoute,
  detourAll,
  distance,
  obstacleHulls,
  pointInPolygon,
  type ChainNode,
  type Point,
  type Route,
} from '../pages/missionGeometry'

/**
 * Street network and building footprints for the planning area, from OpenStreetMap via the
 * Overpass API. Ground vehicles route along the streets and treat every building as an
 * obstacle, instead of drawing straight lines the way an aircraft would.
 */

export const DEFAULT_STREET_OPTIONS: StreetOptions = {
  classes: ['roads', 'service'],
  avoidMajor: true,
  approachMeters: 40,
}

export interface RoadWay {
  id: number
  name?: string
  cls: RoadClass
  major: boolean
  points: Point[]
  nodeIds: number[]
}

interface Edge {
  to: number
  w: number
  cls: RoadClass
  major: boolean
}

export interface StreetNetwork {
  key: string
  roads: RoadWay[]
  buildings: Point[][]
  nodes: Map<number, Point>
  adjacency: Map<number, Edge[]>
}

export interface StreetLeg {
  /** Target index (0-based); -1 is the return to base. */
  index: number
  offStreetMeters: number
  reachable: boolean
  reason?: string
}

export interface StreetRoute {
  route: Route | null
  legs: StreetLeg[]
  onStreetFraction: number
  /** Buildings within reach of the route, for display and for the live view. */
  obstacles: Point[][]
}

type Status = 'idle' | 'loading' | 'ready' | 'error'

/** What the map is looking at, in degrees, with the camera height in metres. */
export interface ViewRect {
  west: number
  south: number
  east: number
  north: number
  height: number
}

// ---- OSM fetch, tiled -----------------------------------------------------------------------------

/** Public Overpass instances that answer browser requests (CORS); tried in order. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/** Tile edge in degrees (~660 m). Data is fetched per tile and merged, so it follows the view. */
const TILE = 0.006
/** Above this camera height the view spans too much ground to fetch; only the grid tiles load. */
const MAX_VIEW_HEIGHT_M = 3500
const MAX_VIEW_TILES = 9
/**
 * Tiles fetched per request. Small requests answer in seconds on the public instances and show
 * up progressively; one big request for a dense city block times out.
 */
const BATCH = 2
/** Failed tiles are retried on their own, a few times, before the operator has to. */
const RETRY_DELAYS_MS = [6000, 15000, 40000]
/** Planning grid plus a margin, in screen units; its tiles always load. */
const BOUNDS = { x0: -120, y0: -120, x1: 1120, y1: 820 }
const ROAD_CLASS: Record<string, RoadClass> = {
  primary: 'roads',
  primary_link: 'roads',
  secondary: 'roads',
  secondary_link: 'roads',
  tertiary: 'roads',
  tertiary_link: 'roads',
  residential: 'roads',
  unclassified: 'roads',
  living_street: 'roads',
  road: 'roads',
  service: 'service',
  track: 'service',
  footway: 'paths',
  path: 'paths',
  pedestrian: 'paths',
  cycleway: 'paths',
  bridleway: 'paths',
}
const MAJOR = new Set(['primary', 'primary_link', 'secondary', 'secondary_link'])

interface OsmWay {
  id: number
  tags?: Record<string, string>
  nodes?: number[]
  geometry?: Array<{ lat: number; lon: number }>
}

interface TileState {
  status: 'loading' | 'ready' | 'error'
  ways: OsmWay[]
  error?: string
  attempts: number
}

const tiles = new Map<string, TileState>()
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version += 1
  listeners.forEach(fn => fn())
}

const tileKey = (lat: number, lng: number) => `${Math.floor(lat / TILE)}_${Math.floor(lng / TILE)}`
const tileBBox = (key: string) => {
  const [r, c] = key.split('_').map(Number)
  return `${(r * TILE).toFixed(5)},${(c * TILE).toFixed(5)},${((r + 1) * TILE).toFixed(5)},${((c + 1) * TILE).toFixed(5)}`
}

async function fetchOverpass(bboxes: string[]): Promise<OsmWay[]> {
  const body = bboxes.map(b => `way["highway"](${b});way["building"](${b});`).join('')
  const query = `[out:json][timeout:40];(${body});out geom;`
  let lastError: unknown = null
  for (const endpoint of ENDPOINTS) {
    // A dead mirror must not hang the chain: give each one a bounded wait, then move on.
    const abort = new AbortController()
    const timer = window.setTimeout(() => abort.abort(), 30_000)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const json = (await res.json()) as { elements?: OsmWay[] }
      return (json.elements ?? []).filter(e => e.geometry && e.nodes)
    } catch (err) {
      lastError = err
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Street data unavailable')
}

/**
 * Tiles are fetched one batch at a time through a single request, so a pan that needs several
 * tiles costs one round trip and never trips the public API's per-client connection limit.
 */
const queue: string[] = []
let pumpTimer = 0
let inFlight = false

function ensureTile(key: string) {
  const existing = tiles.get(key)
  if (existing && existing.status !== 'error') return
  tiles.set(key, { status: 'loading', ways: [], attempts: existing?.attempts ?? 0 })
  if (!queue.includes(key)) queue.push(key)
  emit()
  window.clearTimeout(pumpTimer)
  pumpTimer = window.setTimeout(pump, 250)
}

function pump() {
  if (inFlight || !queue.length) return
  const batch = queue.splice(0, BATCH)
  inFlight = true
  fetchOverpass(batch.map(tileBBox)).then(
    ways => {
      // Hand each way to every requested tile that holds one of its nodes; a way that merely
      // crosses a tile is kept on the first tile so nothing is lost.
      const bounds = batch.map(key => {
        const [r, c] = key.split('_').map(Number)
        return { key, s: r * TILE, w: c * TILE, n: (r + 1) * TILE, e: (c + 1) * TILE }
      })
      const perTile = new Map<string, OsmWay[]>(batch.map(k => [k, []]))
      for (const way of ways) {
        let placed = false
        for (const b of bounds) {
          if (way.geometry!.some(g => g.lat >= b.s && g.lat < b.n && g.lon >= b.w && g.lon < b.e)) {
            perTile.get(b.key)!.push(way)
            placed = true
          }
        }
        if (!placed) perTile.get(batch[0])!.push(way)
      }
      batch.forEach(key =>
        tiles.set(key, {
          status: 'ready',
          ways: perTile.get(key) ?? [],
          attempts: tiles.get(key)?.attempts ?? 0,
        }),
      )
      inFlight = false
      emit()
      pump()
    },
    err => {
      const error = err instanceof Error ? err.message : 'Street data unavailable'
      batch.forEach(key => {
        const attempts = (tiles.get(key)?.attempts ?? 0) + 1
        tiles.set(key, { status: 'error', ways: [], error, attempts })
        const delay = RETRY_DELAYS_MS[attempts - 1]
        if (delay !== undefined) window.setTimeout(() => ensureTile(key), delay)
      })
      inFlight = false
      emit()
      pump()
    },
  )
}

/** Tiles covering the planning grid, plus those in view when the camera is close enough. */
function wantedTiles(view: ViewRect | null) {
  const keys = new Set<string>()
  const cover = (west: number, south: number, east: number, north: number, limit: number) => {
    const cy = (south + north) / 2
    const cx = (west + east) / 2
    const list: Array<{ key: string; d: number }> = []
    for (let r = Math.floor(south / TILE); r <= Math.floor(north / TILE); r++)
      for (let c = Math.floor(west / TILE); c <= Math.floor(east / TILE); c++) {
        const lat = (r + 0.5) * TILE
        const lng = (c + 0.5) * TILE
        list.push({ key: `${r}_${c}`, d: Math.hypot(lat - cy, lng - cx) })
      }
    list
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .forEach(t => keys.add(t.key))
  }
  const sw = toGeo({ x: BOUNDS.x0, y: BOUNDS.y1 }, METERS_PER_UNIT)
  const ne = toGeo({ x: BOUNDS.x1, y: BOUNDS.y0 }, METERS_PER_UNIT)
  cover(sw.lng, sw.lat, ne.lng, ne.lat, 9)
  if (view && view.height < MAX_VIEW_HEIGHT_M && view.east > view.west && view.north > view.south)
    cover(view.west, view.south, view.east, view.north, MAX_VIEW_TILES)
  return [...keys].sort()
}

/** Merge the loaded tiles into one network, in screen units for the current home fix. */
function buildNetwork(keys: string[]): StreetNetwork {
  const toUnits = (g: { lat: number; lon: number }) => fromGeo(g.lat, g.lon, METERS_PER_UNIT)
  const roads: RoadWay[] = []
  const buildings: Point[][] = []
  const nodes = new Map<number, Point>()
  const adjacency = new Map<number, Edge[]>()
  const seen = new Set<number>()
  const link = (a: number, b: number, edge: Omit<Edge, 'to'>) => {
    adjacency.set(a, [...(adjacency.get(a) ?? []), { ...edge, to: b }])
    adjacency.set(b, [...(adjacency.get(b) ?? []), { ...edge, to: a }])
  }
  for (const key of keys) {
    const tile = tiles.get(key)
    if (!tile || tile.status !== 'ready') continue
    for (const way of tile.ways) {
      // A way crossing several tiles arrives from each of them; keep one copy.
      if (seen.has(way.id)) continue
      seen.add(way.id)
      const tags = way.tags ?? {}
      const geometry = way.geometry!
      const ids = way.nodes!
      if (tags.building) {
        const pts = geometry.map(toUnits)
        if (pts.length >= 3) buildings.push(pts)
        continue
      }
      const cls = ROAD_CLASS[tags.highway ?? '']
      if (!cls || tags.area === 'yes') continue
      const major = MAJOR.has(tags.highway ?? '')
      const points = geometry.map(toUnits)
      roads.push({ id: way.id, name: tags.name, cls, major, points, nodeIds: ids })
      ids.forEach((id, i) => nodes.set(id, points[i]))
      for (let i = 1; i < ids.length; i++) {
        link(ids[i - 1], ids[i], { w: distance(points[i - 1], points[i]), cls, major })
      }
    }
  }
  return { key: keys.join('|'), roads, buildings, nodes, adjacency }
}

/**
 * Street data for the planning grid and for whatever the map is looking at. Tiles are fetched
 * once and shared by every view; the merged network is rebuilt in grid units whenever the home
 * fix moves, so it always lines up with BASE.
 */
export function useStreetNetwork(enabled: boolean, view: ViewRect | null = null) {
  const home = useHome()
  const tick = useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => version,
  )
  const viewKey = view
    ? `${view.west.toFixed(4)},${view.south.toFixed(4)},${view.east.toFixed(4)},${view.north.toFixed(4)},${Math.round(view.height)}`
    : ''
  const wanted = useMemo(
    () => (enabled ? wantedTiles(view) : []),
    // The view key and home key are what actually change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, viewKey, home.key],
  )
  const wantedKey = wanted.join('|')
  useEffect(() => {
    wanted.forEach(ensureTile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey])
  const states = wanted.map(k => tiles.get(k))
  const loaded = states.filter(t => t?.status === 'ready').length
  const loading = states.some(t => !t || t.status === 'loading')
  const failed = states.find(t => t?.status === 'error')
  const network = useMemo(
    () => (enabled && loaded ? buildNetwork(wanted) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, wantedKey, loaded, tick, home.key],
  )
  const retry = useCallback(() => wanted.forEach(ensureTile), [wanted])
  const status: Status = !enabled
    ? 'idle'
    : loading
      ? 'loading'
      : failed && !loaded
        ? 'error'
        : 'ready'
  return {
    status,
    network,
    error: failed?.error,
    /** Tiles loaded out of the tiles wanted for the grid and the current view. */
    coverage: { loaded, wanted: wanted.length },
    retry,
  }
}

// ---- routing ------------------------------------------------------------------------------------

class Heap {
  private items: Array<{ id: number; f: number }> = []
  push(id: number, f: number) {
    const a = this.items
    a.push({ id, f })
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (a[parent].f <= a[i].f) break
      ;[a[parent], a[i]] = [a[i], a[parent]]
      i = parent
    }
  }
  pop() {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get size() {
    return this.items.length
  }
}

interface Snap {
  /** Virtual node id for the snapped point. */
  id: number
  point: Point
  a: number
  b: number
  dist: number
}

const allowed = (edge: Edge, opts: StreetOptions) => opts.classes.includes(edge.cls)
const cost = (edge: Edge, opts: StreetOptions) =>
  edge.w * (edge.cls === 'paths' ? 1.3 : 1) * (opts.avoidMajor && edge.major ? 2.5 : 1)

/** Nearest point on any allowed street to `p`, as a virtual node spliced into that edge. */
function snap(network: StreetNetwork, p: Point, opts: StreetOptions, id: number): Snap | null {
  let best: Snap | null = null
  for (const [a, edges] of network.adjacency) {
    const pa = network.nodes.get(a)!
    for (const e of edges) {
      if (e.to < a || !allowed(e, opts)) continue
      const pb = network.nodes.get(e.to)!
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2))
      const q = { x: pa.x + dx * t, y: pa.y + dy * t }
      const d = distance(p, q)
      if (!best || d < best.dist) best = { id, point: q, a, b: e.to, dist: d }
    }
  }
  return best
}

interface Found {
  ids: number[]
  points: Point[]
}

/** A* over a node map and an edge lookup; `toId` is reachable even through disallowed ways. */
function astar(
  nodes: Map<number, Point>,
  edgesOf: (id: number) => Edge[],
  fromId: number,
  toId: number,
  opts: StreetOptions,
): Found | null {
  const goal = nodes.get(toId)
  const startPoint = nodes.get(fromId)
  if (!goal || !startPoint) return null
  const g = new Map<number, number>([[fromId, 0]])
  const came = new Map<number, number>()
  const open = new Heap()
  open.push(fromId, distance(startPoint, goal))
  const closed = new Set<number>()
  while (open.size) {
    const { id } = open.pop()
    if (id === toId) {
      const ids: number[] = []
      let cur: number | undefined = id
      while (cur !== undefined) {
        ids.push(cur)
        cur = came.get(cur)
      }
      ids.reverse()
      return { ids, points: ids.map(i => nodes.get(i)!) }
    }
    if (closed.has(id)) continue
    closed.add(id)
    const here = g.get(id)!
    for (const e of edgesOf(id)) {
      if (!allowed(e, opts) && e.to !== toId && e.to !== fromId) continue
      const tentative = here + cost(e, opts)
      if (tentative >= (g.get(e.to) ?? Infinity)) continue
      g.set(e.to, tentative)
      came.set(e.to, id)
      open.push(e.to, tentative + distance(nodes.get(e.to)!, goal))
    }
  }
  return null
}

/** A* over the street graph between two snapped points; returns the point chain or null. */
function shortest(network: StreetNetwork, from: Snap, to: Snap, opts: StreetOptions) {
  const nodes = new Map(network.nodes)
  const adj = new Map<number, Edge[]>()
  const edgesOf = (id: number) => adj.get(id) ?? network.adjacency.get(id) ?? []
  const splice = (s: Snap) => {
    nodes.set(s.id, s.point)
    const pa = network.nodes.get(s.a)!
    const pb = network.nodes.get(s.b)!
    const base = network.adjacency.get(s.a)!.find(e => e.to === s.b)!
    const ea = { ...base, to: s.id, w: distance(pa, s.point) }
    const eb = { ...base, to: s.id, w: distance(pb, s.point) }
    adj.set(s.a, [...edgesOf(s.a), ea])
    adj.set(s.b, [...edgesOf(s.b), eb])
    adj.set(s.id, [
      ...(adj.get(s.id) ?? []),
      { ...base, to: s.a, w: ea.w },
      { ...base, to: s.b, w: eb.w },
    ])
  }
  splice(from)
  splice(to)
  // Snapped onto the same edge: drive straight along it.
  if ((from.a === to.a && from.b === to.b) || (from.a === to.b && from.b === to.a)) {
    adj.set(from.id, [
      ...(adj.get(from.id) ?? []),
      { to: to.id, w: distance(from.point, to.point), cls: 'roads', major: false },
    ])
  }
  return astar(nodes, edgesOf, from.id, to.id, opts)?.points ?? null
}

/** A snap that sits exactly on a graph node, so node-to-snap routes reuse `shortest`. */
function nodeSnap(network: StreetNetwork, id: number, virtualId: number): Snap | null {
  const point = network.nodes.get(id)
  const neighbour = network.adjacency.get(id)?.[0]
  if (!point || !neighbour) return null
  return { id: virtualId, point, a: id, b: neighbour.to, dist: 0 }
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Approach legs leave the street and steer around nearby hulls. */
function approachBuilder(hulls: Point[][]) {
  const nearHulls = (a: Point, b: Point) => {
    const pad = 60
    const x0 = Math.min(a.x, b.x) - pad
    const x1 = Math.max(a.x, b.x) + pad
    const y0 = Math.min(a.y, b.y) - pad
    const y1 = Math.max(a.y, b.y) + pad
    return hulls.filter(h => h.some(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1))
  }
  return (from: Point, to: Point): ChainNode[] =>
    detourAll(from, to, nearHulls(from, to)).map(p => ({ p, round: true }))
}

/** Buildings close to the chain, saved with the plan so the live view draws the same obstacles. */
function buildingsNear(network: StreetNetwork, pts: Point[], reach = 70) {
  return network.buildings
    .filter(b =>
      b.some(p => pts.some(q => Math.abs(q.x - p.x) < reach && Math.abs(q.y - p.y) < reach)),
    )
    .slice(0, 300)
}

export interface StreetCoverage {
  route: Route | null
  /** Street length inside the area, metres, and how much of it the route drives. */
  streetMeters: number
  coveredMeters: number
  segments: number
  obstacles: Point[][]
}

/**
 * Cover an area the way a rover can in a city: drive every allowed street segment inside the
 * polygon, taking the streets between them, then return to base. Segments the network cannot
 * reach are left out and reported through the covered length.
 */
export function createStreetCoverage(
  polygon: Point[],
  network: StreetNetwork,
  opts: StreetOptions & { turnRadius: number; clearance: number; userObstacles: Point[][] },
): StreetCoverage {
  const empty: StreetCoverage = {
    route: null,
    streetMeters: 0,
    coveredMeters: 0,
    segments: 0,
    obstacles: [],
  }
  if (polygon.length < 3) return empty
  // Allowed street segments whose middle lies inside the area.
  const edges = new Map<string, { a: number; b: number; len: number }>()
  for (const [a, list] of network.adjacency) {
    const pa = network.nodes.get(a)!
    for (const e of list) {
      if (e.to < a || !allowed(e, opts) || e.w < 0.5) continue
      const pb = network.nodes.get(e.to)!
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
      if (
        pointInPolygon(mid, polygon) ||
        (pointInPolygon(pa, polygon) && pointInPolygon(pb, polygon))
      )
        edges.set(edgeKey(a, e.to), { a, b: e.to, len: e.w })
    }
  }
  if (!edges.size) return empty
  const streetMeters = [...edges.values()].reduce((n, e) => n + e.len, 0) * METERS_PER_UNIT
  const hulls = obstacleHulls(
    [...network.buildings, ...opts.userObstacles],
    opts.clearance + opts.turnRadius * 0.35,
  )
  const approach = approachBuilder(hulls)
  const base = snap(network, HOME, opts, -1)
  if (!base) return { ...empty, streetMeters }
  const uncovered = new Set(edges.keys())
  let covered = 0
  const cover = (a: number, b: number) => {
    const key = edgeKey(a, b)
    const edge = edges.get(key)
    if (edge && uncovered.delete(key)) covered += edge.len
  }
  const nearestEndpoint = (from: Point) => {
    let best: { id: number; d: number } | null = null
    for (const key of uncovered) {
      const e = edges.get(key)!
      for (const id of [e.a, e.b]) {
        const d = distance(from, network.nodes.get(id)!)
        if (!best || d < best.d) best = { id, d }
      }
    }
    return best?.id
  }
  const street: Point[] = []
  const edgesOf = (id: number) => network.adjacency.get(id) ?? []
  // Out from base to the closest segment.
  const first = nearestEndpoint(base.point)
  if (first === undefined) return { ...empty, streetMeters }
  const firstSnap = nodeSnap(network, first, -2)
  const out = firstSnap ? shortest(network, base, firstSnap, opts) : null
  if (!out) return { ...empty, streetMeters }
  street.push(...out)
  let current = first
  let guard = 0
  while (uncovered.size && guard++ < 5000) {
    // Prefer to keep driving: an uncovered segment that starts where we are.
    const next = edgesOf(current).find(
      e => allowed(e, opts) && uncovered.has(edgeKey(current, e.to)),
    )
    if (next) {
      cover(current, next.to)
      current = next.to
      street.push(network.nodes.get(current)!)
      continue
    }
    // Otherwise take the streets to the nearest uncovered segment, covering anything on the way.
    const target = nearestEndpoint(network.nodes.get(current)!)
    if (target === undefined) break
    const hop = astar(network.nodes, edgesOf, current, target, opts)
    if (!hop) {
      // Unreachable from here: drop every segment touching that node and move on.
      for (const key of [...uncovered]) {
        const e = edges.get(key)!
        if (e.a === target || e.b === target) uncovered.delete(key)
      }
      continue
    }
    for (let i = 1; i < hop.ids.length; i++) cover(hop.ids[i - 1], hop.ids[i])
    street.push(...hop.points.slice(1))
    current = target
  }
  // Back to base along the streets.
  const lastSnap = nodeSnap(network, current, -3)
  const back = lastSnap ? shortest(network, lastSnap, base, opts) : null
  if (back) street.push(...back.slice(1))
  const chain: ChainNode[] = [
    { p: HOME, round: false },
    ...approach(HOME, street[0]),
    ...street.map(p => ({ p, round: true })),
    ...approach(street[street.length - 1], HOME),
    { p: HOME, round: false },
  ]
  const route = chainRoute(chain, opts.turnRadius)
  return {
    route,
    streetMeters,
    coveredMeters: covered * METERS_PER_UNIT,
    segments: edges.size,
    obstacles: buildingsNear(
      network,
      chain.map(n => n.p),
    ),
  }
}

/**
 * Route from BASE through the targets and back along the streets. Each target is reached by a
 * short off-street approach from the nearest allowed street, steering around buildings and any
 * drawn obstacles; targets further off the street than `approachMeters` are flagged.
 */
export function createStreetRoute(
  targets: Point[],
  network: StreetNetwork,
  opts: StreetOptions & {
    turnRadius: number
    clearance: number
    userObstacles: Point[][]
  },
): StreetRoute {
  const empty: StreetRoute = { route: null, legs: [], onStreetFraction: 0, obstacles: [] }
  if (!targets.length) return empty
  const margin = opts.clearance + opts.turnRadius * 0.35
  const hulls = obstacleHulls([...network.buildings, ...opts.userObstacles], margin)
  const approach = approachBuilder(hulls)
  let nextId = -1
  const stops = [HOME, ...targets, HOME]
  const snaps = stops.map(p => snap(network, p, opts, nextId--))
  const chain: ChainNode[] = [{ p: HOME, round: false }]
  const legs: StreetLeg[] = []
  let onStreet = 0
  let total = 0
  const addLength = (pts: Point[]) => {
    let len = 0
    for (let i = 1; i < pts.length; i++) len += distance(pts[i - 1], pts[i])
    return len
  }
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]
    const to = stops[i]
    const sFrom = snaps[i - 1]
    const sTo = snaps[i]
    const index = i === stops.length - 1 ? -1 : i - 1
    const off = sTo ? sTo.dist * METERS_PER_UNIT : Infinity
    let street: Point[] | null = null
    if (sFrom && sTo) street = shortest(network, sFrom, sTo, opts)
    if (!street) {
      // No street connection: drive overland, steering around what we know.
      const via = approach(from, to)
      chain.push(...via, { p: to, round: false })
      const len = addLength([from, ...via.map(v => v.p), to])
      total += len
      legs.push({
        index,
        offStreetMeters: off,
        reachable: false,
        reason: sTo ? 'No street connection' : 'No street in range',
      })
      continue
    }
    // Off-street from the previous stop to the street, along it, then off-street to the target.
    const out = approach(from, street[0])
    const inn = approach(street[street.length - 1], to)
    chain.push(...out)
    street.forEach((p, k) => chain.push({ p, round: k > 0 && k < street.length - 1 }))
    chain.push(...inn, { p: to, round: false })
    const streetLen = addLength(street)
    const legLen =
      addLength([from, ...out.map(v => v.p), street[0]]) +
      streetLen +
      addLength([street[street.length - 1], ...inn.map(v => v.p), to])
    onStreet += streetLen
    total += legLen
    legs.push({
      index,
      offStreetMeters: off,
      reachable: off <= opts.approachMeters,
      reason: off > opts.approachMeters ? 'Beyond approach limit' : undefined,
    })
  }
  const route = chainRoute(chain, opts.turnRadius)
  return {
    route,
    legs,
    onStreetFraction: total ? onStreet / total : 0,
    // Buildings close to the route become the plan's obstacles, drawn in both workspaces.
    obstacles: buildingsNear(
      network,
      chain.map(n => n.p),
    ),
  }
}

/** Building footprints that touch the area: inside it, or with the area's edge running through. */
export function buildingsInArea(network: StreetNetwork, polygon: Point[], limit = 400) {
  if (polygon.length < 3) return []
  return network.buildings
    .filter(b => b.some(p => pointInPolygon(p, polygon)) || polygon.some(p => pointInPolygon(p, b)))
    .slice(0, limit)
}
