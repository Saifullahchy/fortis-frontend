export type Point = { x: number; y: number }
export type Pattern = 'figure8' | 'racetrack' | 'zigzag'
export interface Route {
  path: string
  length: number
  start: Point
  end: Point
}

export const METERS_PER_UNIT = 0.4
export const HOME: Point = { x: 90, y: 630 }

const round = (value: number) => Math.round(value * 10) / 10
const fmt = (point: Point) => `${round(point.x)} ${round(point.y)}`

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function polygonArea(points: Point[]) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function formatDuration(minutes: number) {
  const total = Math.round(minutes * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function polygonIntersectionsAtX(points: Point[], x: number) {
  const intersections: number[] = []
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    if ((start.x <= x && end.x > x) || (end.x <= x && start.x > x)) {
      const ratio = (x - start.x) / (end.x - start.x)
      intersections.push(start.y + ratio * (end.y - start.y))
    }
  }
  return intersections.sort((a, b) => a - b)
}

function cross(origin: Point, a: Point, b: Point) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const eps = 1e-6
  const o1 = cross(a, b, c)
  const o2 = cross(a, b, d)
  const o3 = cross(c, d, a)
  const o4 = cross(c, d, b)
  return (
    ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
    ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))
  )
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (!lengthSquared) return distance(point, a)
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared),
  )
  return distance(point, { x: a.x + ratio * (b.x - a.x), y: a.y + ratio * (b.y - a.y) })
}

export function clampToPolygon(point: Point, polygon: Point[]): Point {
  if (polygon.length < 3 || pointInPolygon(point, polygon)) return point
  let best = point
  let bestDistance = Infinity
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length]
    const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
    const ratio = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared,
          ),
        )
      : 0
    const nearest = { x: a.x + ratio * (b.x - a.x), y: a.y + ratio * (b.y - a.y) }
    const gap = distance(point, nearest)
    if (gap < bestDistance) {
      bestDistance = gap
      best = nearest
    }
  })
  const center = {
    x: polygon.reduce((sum, vertex) => sum + vertex.x, 0) / polygon.length,
    y: polygon.reduce((sum, vertex) => sum + vertex.y, 0) / polygon.length,
  }
  const pull = Math.min(1, 3 / (distance(best, center) || 1))
  return { x: best.x + (center.x - best.x) * pull, y: best.y + (center.y - best.y) * pull }
}

function strictlyInside(point: Point, polygon: Point[]) {
  if (!pointInPolygon(point, polygon)) return false
  return polygon.every(
    (vertex, index) =>
      distanceToSegment(point, vertex, polygon[(index + 1) % polygon.length]) > 0.5,
  )
}

function crossesPolygon(a: Point, b: Point, polygon: Point[]) {
  const edgeCrossed = polygon.some((vertex, index) =>
    segmentsCross(a, b, vertex, polygon[(index + 1) % polygon.length]),
  )
  if (edgeCrossed) return true
  return [0.25, 0.5, 0.75].some(t =>
    strictlyInside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, polygon),
  )
}

export function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const build = (list: Point[]) => {
    const hull: Point[] = []
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop()
      }
      hull.push(point)
    }
    hull.pop()
    return hull
  }
  return [...build(sorted), ...build([...sorted].reverse())]
}

export function expandPolygon(polygon: Point[], margin: number) {
  const center = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }
  return polygon.map(point => {
    const radius = distance(point, center) || 1
    const scale = 1 + margin / radius
    return {
      x: center.x + (point.x - center.x) * scale,
      y: center.y + (point.y - center.y) * scale,
    }
  })
}

function detour(a: Point, b: Point, hull: Point[]) {
  if (!crossesPolygon(a, b, hull)) return []
  const count = hull.length
  const visibleFrom = (point: Point) =>
    hull.map((_, index) => index).filter(index => !crossesPolygon(point, hull[index], hull))
  let best: Point[] = []
  let bestLength = Infinity
  for (const i of visibleFrom(a)) {
    for (const j of visibleFrom(b)) {
      for (const step of [1, -1]) {
        const ring = [hull[i]]
        let index = i
        while (index !== j) {
          index = (index + step + count) % count
          ring.push(hull[index])
        }
        let length = distance(a, ring[0]) + distance(ring[ring.length - 1], b)
        for (let k = 1; k < ring.length; k += 1) length += distance(ring[k - 1], ring[k])
        if (length < bestLength) {
          bestLength = length
          best = ring
        }
      }
    }
  }
  return best
}

function freeSegments(top: number, bottom: number, cuts: Array<[number, number]>) {
  if (bottom <= top) return []
  const blocked = cuts.filter(([from, to]) => to > top && from < bottom).sort((a, b) => a[0] - b[0])
  const segments: number[][] = []
  let cursor = top
  for (const [from, to] of blocked) {
    if (from - cursor > 8) segments.push([cursor, from])
    cursor = Math.max(cursor, to)
  }
  if (bottom - cursor > 8) segments.push([cursor, bottom])
  return segments
}

export function detourAll(a: Point, b: Point, hulls: Point[][], depth = 0): Point[] {
  const blocking = hulls
    .filter(hull => crossesPolygon(a, b, hull))
    .sort((p, q) => distance(a, centerOf(p)) - distance(a, centerOf(q)))[0]
  if (!blocking || depth > 3) return []
  const via = detour(a, b, blocking)
  const others = hulls.filter(hull => hull !== blocking)
  if (!others.length) return via
  const chain = [a, ...via, b]
  const result: Point[] = []
  for (let index = 1; index < chain.length; index += 1) {
    result.push(...detourAll(chain[index - 1], chain[index], others, depth + 1))
    if (index < chain.length - 1) result.push(chain[index])
  }
  return result
}

function centerOf(polygon: Point[]): Point {
  return {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }
}

export function createSurveyRoute(points: Point[], step: number, exclusions: Point[][]) {
  if (points.length < 3) return null
  const hulls = exclusions
    .filter(zone => zone.length >= 3)
    .map(zone => expandPolygon(convexHull(zone), 12))
  const xs = points.map(point => point.x)
  const left = Math.min(...xs) + 16
  const right = Math.max(...xs) - 16
  if (right <= left) return null
  const count = Math.max(2, Math.floor((right - left) / step) + 1)
  const gap = (right - left) / (count - 1)
  const inset = Math.min(gap / 2, 40) + 5
  const slices = Array.from({ length: count }, (_, index) => left + gap * index)
    .map(x => ({ x, hits: polygonIntersectionsAtX(points, x) }))
    .filter(slice => slice.hits.length >= 2)
    .map(slice => ({
      x: slice.x,
      segments: freeSegments(
        slice.hits[0] + inset,
        slice.hits[slice.hits.length - 1] - inset,
        hulls.flatMap(hull => {
          const cut = polygonIntersectionsAtX(hull, slice.x)
          return cut.length >= 2 ? [[cut[0], cut[cut.length - 1]] as [number, number]] : []
        }),
      ),
    }))
    .filter(slice => slice.segments.length)
  if (!slices.length) return null

  const legs: Array<{ from: Point; to: Point; slice: number }> = []
  slices.forEach((slice, index) => {
    const goesUp = index % 2 === 0
    const ordered = goesUp ? [...slice.segments].reverse() : slice.segments
    ordered.forEach(([top, bottom]) => {
      legs.push(
        goesUp
          ? { from: { x: slice.x, y: bottom }, to: { x: slice.x, y: top }, slice: index }
          : { from: { x: slice.x, y: top }, to: { x: slice.x, y: bottom }, slice: index },
      )
    })
  })

  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1]
    const current = legs[index]
    if (previous.slice === current.slice) continue
    if (hulls.length && detourAll(previous.to, current.from, hulls).length) continue
    const endedUp = previous.to.y < previous.from.y
    const turnY = endedUp
      ? Math.max(previous.to.y, current.from.y)
      : Math.min(previous.to.y, current.from.y)
    const roomBefore = endedUp ? previous.from.y - turnY : turnY - previous.from.y
    const roomAfter = endedUp ? current.to.y - turnY : turnY - current.to.y
    if (roomBefore < 2 || roomAfter < 2) continue
    previous.to = { x: previous.to.x, y: turnY }
    current.from = { x: current.from.x, y: turnY }
  }

  let path = `M ${fmt(legs[0].from)} L ${fmt(legs[0].to)}`
  let length = distance(legs[0].from, legs[0].to)
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1]
    const current = legs[index]
    const via = hulls.length ? detourAll(previous.to, current.from, hulls) : []
    if (via.length) {
      let last = previous.to
      for (const vertex of via) {
        path += ` L ${fmt(vertex)}`
        length += distance(last, vertex)
        last = vertex
      }
      path += ` L ${fmt(current.from)}`
      length += distance(last, current.from)
    } else if (previous.slice === current.slice) {
      path += ` L ${fmt(current.from)}`
      length += distance(previous.to, current.from)
    } else {
      const endedUp = previous.to.y < previous.from.y
      const chord = distance(previous.to, current.from)
      const radius = round(chord / 2)
      path += ` A ${radius} ${radius} 0 0 ${endedUp ? 1 : 0} ${fmt(current.from)}`
      length += (Math.PI * chord) / 2
    }
    path += ` L ${fmt(current.to)}`
    length += distance(current.from, current.to)
  }
  return { path, length, start: legs[0].from, end: legs[legs.length - 1].to }
}

function polylineRoute(points: Point[], repeats = 1): Route {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index])
  }
  return {
    path: `M ${fmt(points[0])} ${points
      .slice(1)
      .map(point => `L ${fmt(point)}`)
      .join(' ')}`,
    length: length * repeats,
    start: points[0],
    end: points[points.length - 1],
  }
}

export function createPointRoute(points: Point[]) {
  if (!points.length) return null
  return polylineRoute([HOME, ...points, HOME])
}

/** Closed patrol loop through the points, driven `repeats` times, out from and back to HOME. */
export function createLoopRoute(points: Point[], repeats: number) {
  if (points.length < 2) return createPointRoute(points)
  const lap = [...points, points[0]]
  const laps = Array.from({ length: Math.max(1, repeats) }, () => lap).flat()
  return polylineRoute([HOME, ...laps, HOME])
}

/**
 * Ground route: out from BASE through the waypoints (looped `repeats` times when `closed`) and
 * back, steering around every obstacle with `clearance` to spare and rounding each corner to the
 * vehicle's minimum turning radius. A rover cannot cut across a building the way an aircraft
 * flies over it, and it cannot pivot on the spot mid-corner at speed.
 */
export function createGroundRoute(
  points: Point[],
  obstacles: Point[][],
  options: { closed: boolean; repeats: number; turnRadius: number; clearance: number },
): Route | null {
  if (!points.length || (options.closed && points.length < 2)) return null
  const lap = options.closed ? [...points, points[0]] : points
  const laps = options.closed
    ? Array.from({ length: Math.max(1, options.repeats) }, () => lap).flat()
    : lap
  const hulls = obstacleHulls(obstacles, options.clearance + options.turnRadius * 0.35)
  // Insert detour vertices wherever a leg would cross an obstacle. Waypoints are stops where
  // the vehicle halts and turns in place, so only detour corners are rounded.
  const chain: ChainNode[] = [{ p: HOME, round: false }]
  for (const next of [...laps, HOME]) {
    const from = chain[chain.length - 1].p
    if (hulls.length) chain.push(...detourAll(from, next, hulls).map(p => ({ p, round: true })))
    chain.push({ p: next, round: false })
  }
  return chainRoute(chain, options.turnRadius)
}

/** Convex, margin-expanded hulls of obstacle outlines, ready for detour tests. */
export function obstacleHulls(obstacles: Point[][], margin: number) {
  return obstacles
    .filter(zone => zone.length >= 3)
    .map(zone => expandPolygon(convexHull(zone), margin))
}

export interface ChainNode {
  p: Point
  /** Round this corner to the turning radius; false for stops, where the vehicle turns in place. */
  round: boolean
}

/**
 * Path through a chain of points, rounding the marked corners with arcs of at most `turnRadius`
 * (shrunk where the adjoining legs are too short). Zero-length legs are dropped.
 */
export function chainRoute(chain: ChainNode[], turnRadius: number): Route | null {
  const nodes = chain.filter((n, i) => i === 0 || distance(n.p, chain[i - 1].p) > 0.5)
  const pts = nodes.map(n => n.p)
  if (pts.length < 2) return null
  let path = `M ${fmt(pts[0])}`
  let length = 0
  let cursor = pts[0]
  for (let i = 1; i < pts.length; i += 1) {
    const corner = pts[i]
    const after = pts[i + 1]
    if (!after) {
      path += ` L ${fmt(corner)}`
      length += distance(cursor, corner)
      break
    }
    const d1 = distance(cursor, corner)
    const d2 = distance(corner, after)
    const u1 = { x: (corner.x - cursor.x) / d1, y: (corner.y - cursor.y) / d1 }
    const u2 = { x: (after.x - corner.x) / d2, y: (after.y - corner.y) / d2 }
    const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
    const turn = Math.acos(dot) // 0 = straight on, π = hairpin
    if (!nodes[i].round || turn < 0.05 || Math.PI - turn < 0.05) {
      path += ` L ${fmt(corner)}`
      length += d1
      cursor = corner
      continue
    }
    const interior = Math.PI - turn
    // Tangent length for the requested radius, shrunk so the arc fits both legs.
    const tanHalf = Math.tan(interior / 2)
    const maxTangent = Math.min(d1, d2) / 2
    const radius = Math.min(turnRadius, tanHalf * maxTangent)
    const tangent = radius / tanHalf
    const entry = { x: corner.x - u1.x * tangent, y: corner.y - u1.y * tangent }
    const exit = { x: corner.x + u2.x * tangent, y: corner.y + u2.y * tangent }
    const sweep = u1.x * u2.y - u1.y * u2.x > 0 ? 1 : 0
    path += ` L ${fmt(entry)} A ${round(radius)} ${round(radius)} 0 0 ${sweep} ${fmt(exit)}`
    length += distance(cursor, entry) + radius * turn
    cursor = exit
  }
  return { path, length, start: pts[0], end: pts[pts.length - 1] }
}

export function createOrbitRoute(center: Point, radius: number, laps: number, clockwise: boolean) {
  const angle = Math.atan2(HOME.y - center.y, HOME.x - center.x)
  const start = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
  const opposite = {
    x: center.x - radius * Math.cos(angle),
    y: center.y - radius * Math.sin(angle),
  }
  const sweep = clockwise ? 1 : 0
  const arc = `A ${round(radius)} ${round(radius)} 0 0 ${sweep}`
  return {
    path: `M ${fmt(start)} ${arc} ${fmt(opposite)} ${arc} ${fmt(start)}`,
    length: 2 * Math.PI * radius * laps,
    start,
    end: start,
  }
}

function patternPoints(pattern: Pattern, size: number) {
  const points: Point[] = []
  if (pattern === 'figure8') {
    const half = size / 2
    for (let index = 0; index <= 72; index += 1) {
      const t = (Math.PI * 2 * index) / 72
      points.push({ x: half * Math.cos(t), y: half * Math.sin(t) * Math.cos(t) * 1.1 })
    }
  } else if (pattern === 'racetrack') {
    const radius = size / 6
    const straight = size - radius * 2
    const half = straight / 2
    points.push({ x: -half, y: -radius })
    for (let index = 0; index <= 16; index += 1) {
      const t = -Math.PI / 2 + (Math.PI * index) / 16
      points.push({ x: half + radius * Math.cos(t), y: radius * Math.sin(t) })
    }
    for (let index = 0; index <= 16; index += 1) {
      const t = Math.PI / 2 + (Math.PI * index) / 16
      points.push({ x: -half + radius * Math.cos(t), y: radius * Math.sin(t) })
    }
  } else {
    for (let index = 0; index <= 6; index += 1) {
      points.push({ x: -size / 2 + (size * index) / 6, y: index % 2 ? size / 4 : -size / 4 })
    }
  }
  return points
}

export function createManeuverRoute(
  pattern: Pattern,
  anchor: Point,
  size: number,
  heading: number,
  repeats: number,
) {
  const angle = (heading * Math.PI) / 180
  const points = patternPoints(pattern, size).map(point => ({
    x: anchor.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: anchor.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  }))
  return polylineRoute(points, repeats)
}
