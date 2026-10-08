import type { Mission, MissionWaypoint } from '../../types/domain'
import { fromGeo, toGeo } from './MissionHud'
import { METERS_PER_UNIT, type Point } from './missionGeometry'

const MAX_WAYPOINTS = 400

/** Runs `fn` against an off-screen SVG path for the given `d`, then removes it. */
function withPath<T>(d: string, fn: (path: SVGPathElement, total: number) => T): T | null {
  if (!d) return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  path.setAttribute('d', d)
  svg.appendChild(path)
  document.body.appendChild(svg)
  try {
    const total = path.getTotalLength()
    return total ? fn(path, total) : null
  } finally {
    svg.remove()
  }
}

/** Evenly spaced points along a path, in screen units. */
export function samplePath(d: string, stepUnits: number): Point[] {
  return (
    withPath(d, (path, total) => {
      const step = Math.max(stepUnits, 1)
      const points: Point[] = []
      for (let at = 0; at < total; at += step) points.push(path.getPointAtLength(at))
      points.push(path.getPointAtLength(total))
      return points.map(p => ({ x: p.x, y: p.y }))
    }) ?? []
  )
}

export function waypointsFromPathData(d: string, altitude: number): MissionWaypoint[] {
  return (
    withPath(d, (path, total) => {
      const step = Math.max(total / MAX_WAYPOINTS, 2)
      const points: Point[] = []
      for (let at = 0; at < total; at += step) points.push(path.getPointAtLength(at))
      points.push(path.getPointAtLength(total))
      return points.map((p, i) => {
        const g = toGeo(p, METERS_PER_UNIT)
        return {
          id: `WP-${String(i + 1).padStart(3, '0')}`,
          latitude: g.lat,
          longitude: g.lng,
          altitude,
        }
      })
    }) ?? []
  )
}

/**
 * Path length at which each stop point is reached, in the order they are visited. A point that
 * is visited several times (a patrol loop) yields one stop per pass.
 */
export function stopsAlongPath(d: string, stops: Point[]): number[] {
  if (!stops.length) return []
  return (
    withPath(d, (path, total) => {
      const step = Math.max(1, Math.min(2, total / 2000))
      const samples: Array<{ at: number; x: number; y: number }> = []
      for (let at = 0; at <= total; at += step) {
        const p = path.getPointAtLength(at)
        samples.push({ at, x: p.x, y: p.y })
      }
      const found: number[] = []
      let cursor = 0
      // Walk forward: each stop is the next pass of the path within 1 unit of that point.
      const near = (s: (typeof samples)[number], p: Point) => Math.hypot(s.x - p.x, s.y - p.y) < 1
      let guard = 0
      while (guard++ < 10_000) {
        let best: { at: number; i: number } | null = null
        for (const p of stops) {
          for (let i = cursor; i < samples.length; i++) {
            if (!near(samples[i], p)) continue
            if (!best || samples[i].at < best.at) best = { at: samples[i].at, i }
            break
          }
        }
        if (!best) break
        found.push(best.at)
        // Skip past this pass so the same point is not matched again until the next lap.
        cursor = best.i
        while (cursor < samples.length && stops.some(p => near(samples[cursor], p))) cursor++
      }
      return found
    }) ?? []
  )
}

export interface LivePlan {
  mission: Mission
  path: string
  /** Survey boundary and exclusion zones, so the live view draws what Planning drew. */
  areas: Array<{ points: Point[]; kind: 'area' | 'zone' | 'building' }>
  waypointCount: number
  uploaded: boolean
  altitude: number
  speed: number
  transitUnits: [number, number]
  stopUnits: number[]
  dwellSeconds: number
  acceptMeters?: number
  /** Full planned distance, metres, so the live view can show it before the drive starts. */
  totalMeters: number
}

export function livePlanFor(missions: Mission[], vehicleId: string): LivePlan | null {
  const mission = missions.find(
    m => m.vehicleId === vehicleId && m.plan && m.waypoints.length > 1 && m.status !== 'idle',
  )
  if (!mission?.plan) return null
  const path =
    mission.plan.pathData ||
    mission.waypoints
      .map((w, i) => {
        const p = fromGeo(w.latitude, w.longitude, METERS_PER_UNIT)
        return `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      })
      .join(' ')
  const [out, back] = mission.plan.transitMeters
  const draft = mission.plan.draft
  const areaMode = draft?.planMode === 'survey' || draft?.planMode === 'coverage'
  // Zones are exclusion zones inside a survey area, or free-standing obstacles on a ground route.
  const areas = draft
    ? [
        ...(areaMode ? [{ points: draft.surveyPoints, kind: 'area' as const }] : []),
        ...draft.zones
          .filter(z => z.length >= 3)
          .map(points => ({ points, kind: 'zone' as const })),
        ...(mission.plan.autoObstacles ?? []).map(points => ({
          points,
          kind: 'building' as const,
        })),
      ]
    : []
  const pointMode =
    draft?.planMode === 'p2p' || draft?.planMode === 'route' || draft?.planMode === 'patrol'
  const stopUnits = mission.plan.stopUnits ?? []
  return {
    mission,
    path,
    areas,
    waypointCount: stopUnits.length
      ? stopUnits.length
      : draft && pointMode
        ? draft.waypoints.length
        : mission.waypoints.length,
    uploaded: mission.status === 'ready',
    altitude: mission.plan.altitude,
    speed: mission.plan.speed,
    transitUnits: [out / METERS_PER_UNIT, back / METERS_PER_UNIT],
    stopUnits,
    dwellSeconds: mission.plan.dwellSeconds ?? 0,
    acceptMeters: mission.plan.acceptMeters,
    totalMeters: (withPath(path, (_, total) => total) ?? 0) * METERS_PER_UNIT,
  }
}
