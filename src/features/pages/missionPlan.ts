import type { Mission, MissionWaypoint } from '../../types/domain'
import { fromGeo, toGeo } from './MissionHud'
import { METERS_PER_UNIT, type Point } from './missionGeometry'

const MAX_WAYPOINTS = 400

export function waypointsFromPathData(d: string, altitude: number): MissionWaypoint[] {
  if (!d) return []
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
    if (!total) return []
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
  } finally {
    svg.remove()
  }
}

export interface LivePlan {
  mission: Mission
  path: string
  /** Survey boundary and exclusion zones, so Live Flight draws what Planning drew. */
  areas: Array<{ points: Point[]; kind: 'area' | 'zone' }>
  waypointCount: number
  uploaded: boolean
  altitude: number
  speed: number
  transitUnits: [number, number]
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
  const areas =
    draft?.planMode === 'survey'
      ? [
          { points: draft.surveyPoints, kind: 'area' as const },
          ...draft.zones.map(points => ({ points, kind: 'zone' as const })),
        ]
      : []
  return {
    mission,
    path,
    areas,
    waypointCount: draft?.planMode === 'p2p' ? draft.waypoints.length : mission.waypoints.length,
    uploaded: mission.status === 'ready',
    altitude: mission.plan.altitude,
    speed: mission.plan.speed,
    transitUnits: [out / METERS_PER_UNIT, back / METERS_PER_UNIT],
  }
}
