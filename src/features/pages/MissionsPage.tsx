import {
  ArrowLeftRight,
  Check,
  Gauge,
  MapPin,
  MousePointer2,
  Plus,
  RotateCcw,
  Route,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { MapStatusStrip, SimulationHud } from './MissionHud'
import { FlightView3D } from './FlightView3D'
import { WorkspaceHeader } from './WorkspaceHeader'
import { HomeSourceChip } from './HomeSourceChip'
import { MissionBoard } from './MissionBoard'
import { useHome } from './homePosition'
import {
  DEFAULT_STREET_OPTIONS,
  buildingsInArea,
  createStreetCoverage,
  createStreetRoute,
  useStreetNetwork,
  type ViewRect,
} from '../map/streetNetwork'
import { FloatingPanel, PanelDock } from '../../components/layout/FloatingPanel'
import type { PlanMode, PlannerDraft, RoadClass } from '../../types/domain'
import { samplePath, stopsAlongPath, waypointsFromPathData } from './missionPlan'
import { isActive } from './missionSimulator'
import { useMissionSimulation } from './useMissionSimulation'
import {
  useGetMissionsQuery,
  useGetVehiclesQuery,
  useSaveMissionPlanMutation,
  useUploadMissionPlanMutation,
} from '../../services/api/baseApi'
import { TypeIcon } from '../../components/common'
import { useAppDispatch } from '../../store/hooks'
import { actions } from '../../store'
import {
  defaultParams,
  modeSpec,
  profileFor,
  stageTone,
  estimateMinutes,
  type PlanContext,
  type VehicleProfile,
} from '../vehicles/vehicleProfile'
import {
  HOME,
  METERS_PER_UNIT,
  createGroundRoute,
  createLoopRoute,
  createManeuverRoute,
  createOrbitRoute,
  createPointRoute,
  clampToPolygon,
  createSurveyRoute,
  distance,
  formatDuration,
  polygonArea,
  type Pattern,
  type Point,
  type Route as PlanRoute,
} from './missionGeometry'

type DragTarget = {
  kind: 'area' | 'zone' | 'wp' | 'center' | 'anchor'
  index: number
  zone?: number
}

const NO_HANDLES: never[] = []
const NO_POINTS: never[] = []
const noop = () => {}
const PATTERNS: Array<{ id: Pattern; label: string }> = [
  { id: 'figure8', label: 'Figure-8' },
  { id: 'racetrack', label: 'Racetrack' },
  { id: 'zigzag', label: 'Zig-zag' },
]

function emptyDraft(profile: VehicleProfile): PlannerDraft {
  return {
    planMode: profile.modes[0].id,
    params: defaultParams(profile),
    linkLoss: profile.linkLossActions[0],
    street: DEFAULT_STREET_OPTIONS,
    surveyPoints: [],
    boundaryComplete: false,
    zones: [],
    waypoints: [],
    orbitCenter: null,
    orbitRadius: 80,
    orbitLaps: 2,
    clockwise: true,
    pattern: 'figure8',
    anchor: null,
    patternSize: 120,
    heading: 0,
    repeats: 2,
    activePreset: {},
    customSurvey: null,
  }
}

/** A stored draft, brought up to the profile's current modes and parameters. */
function hydrateDraft(profile: VehicleProfile, stored: PlannerDraft): PlannerDraft {
  const base = emptyDraft(profile)
  const planMode = profile.modes.some(m => m.id === stored.planMode)
    ? stored.planMode
    : base.planMode
  return {
    ...base,
    ...stored,
    planMode,
    params: { ...base.params, ...stored.params },
    linkLoss: profile.linkLossActions.includes(stored.linkLoss) ? stored.linkLoss : base.linkLoss,
  }
}

export function MissionsPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>()
  if (!vehicleId) return <MissionBoard />
  return <MissionWorkspace key={vehicleId} vehicleId={vehicleId} />
}

function MissionWorkspace({ vehicleId }: { vehicleId: string }) {
  const navigate = useNavigate()
  const { data: vehicles = [], isLoading: fleetLoading } = useGetVehiclesQuery()
  const {
    data: missions = [],
    isSuccess: missionsLoaded,
    isFetching: missionsFetching,
  } = useGetMissionsQuery(undefined, { refetchOnMountOrArgChange: true })
  const [saveMissionPlan, { isLoading: saving }] = useSaveMissionPlanMutation()
  const [uploadMissionPlan, { isLoading: uploading }] = useUploadMissionPlanMutation()
  const vehicle = vehicles.find(item => item.id === vehicleId)
  const profile = profileFor(vehicle?.type ?? 'UAV')
  const [draft, setDraft] = useState<PlannerDraft>(() => emptyDraft(profile))
  const [drawingZone, setDrawingZone] = useState(false)
  const simPathRef = useRef<SVGPathElement>(null)
  const home = useHome()
  const [ready, setReady] = useState(false)
  const [view3d, setView3d] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)
  const dispatch = useAppDispatch()

  const patch = (next: Partial<PlannerDraft>) => setDraft(d => ({ ...d, ...next }))
  const setParam = (id: string, value: number) =>
    setDraft(d => ({ ...d, params: { ...d.params, [id]: value } }))
  const markCustom = () =>
    setDraft(d => ({ ...d, activePreset: { ...d.activePreset, [d.planMode]: '' } }))

  const mode = modeSpec(profile, draft.planMode)
  const geometry = mode.geometry
  const air = profile.domain === 'air'
  const speed = draft.params.speed ?? 0
  const planAltitude = draft.params.altitude ?? 0
  const viewAltitude = air ? planAltitude : 0
  const dwellSeconds = profile.dwellParam ? (draft.params[profile.dwellParam] ?? 0) : 0
  /** Surface vehicles treat zones on a waypoint route as obstacles to steer around. */
  const obstacles = profile.surfaceBound && geometry === 'points'
  const usesZones = geometry === 'area' || obstacles
  const acceptMeters = draft.params.acceptRadius
  const streetMode = !!mode.street
  const [view, setView] = useState<ViewRect | null>(null)
  const streets = useStreetNetwork(profile.streetRouting, view)
  /** Ground coverage: buildings inside the drawn area are obstacles, from the map. */
  const areaBuildings = useMemo(
    () =>
      profile.streetRouting && geometry === 'area' && draft.boundaryComplete && streets.network
        ? buildingsInArea(streets.network, draft.surveyPoints)
        : NO_POINTS,
    [profile.streetRouting, geometry, draft.boundaryComplete, draft.surveyPoints, streets.network],
  )
  const streetCoverage = useMemo(
    () =>
      profile.streetRouting && geometry === 'area' && draft.boundaryComplete && streets.network
        ? createStreetCoverage(draft.surveyPoints, streets.network, {
            ...draft.street,
            turnRadius: (draft.params.turnRadius ?? 2) / METERS_PER_UNIT,
            clearance: (draft.params.clearance ?? 1) / METERS_PER_UNIT,
            userObstacles: draft.zones,
          })
        : null,
    [
      profile.streetRouting,
      geometry,
      draft.boundaryComplete,
      draft.surveyPoints,
      draft.street,
      draft.params,
      draft.zones,
      streets.network,
    ],
  )
  const coverageStyle = draft.coverageStyle ?? 'auto'
  /** Streets when the area has any meaningful street length; open ground otherwise. */
  const resolvedCoverage: 'streets' | 'field' | null = !profile.streetRouting
    ? null
    : coverageStyle === 'field'
      ? 'field'
      : coverageStyle === 'streets'
        ? 'streets'
        : streetCoverage && streetCoverage.streetMeters >= 40
          ? 'streets'
          : 'field'
  const streetResult = useMemo(
    () =>
      streetMode && streets.network
        ? createStreetRoute(draft.waypoints, streets.network, {
            ...draft.street,
            turnRadius: (draft.params.turnRadius ?? 2) / METERS_PER_UNIT,
            clearance: (draft.params.clearance ?? 1) / METERS_PER_UNIT,
            userObstacles: draft.zones,
          })
        : null,
    [streetMode, streets.network, draft.waypoints, draft.street, draft.params, draft.zones],
  )

  const route = useMemo<PlanRoute | null>(() => {
    if (geometry === 'area') {
      if (resolvedCoverage === 'streets') return streetCoverage?.route ?? null
      return createSurveyRoute(
        draft.surveyPoints,
        (draft.params.spacing ?? 10) / METERS_PER_UNIT,
        resolvedCoverage === 'field' ? [...draft.zones, ...areaBuildings] : draft.zones,
      )
    }
    if (geometry === 'points') {
      // Street mode routes along the streets once the map data is in; until then (or if it
      // never arrives) the rover still gets a direct route around any drawn obstacles.
      if (streetMode && streets.network) return streetResult?.route ?? null
      if (profile.surfaceBound)
        return createGroundRoute(draft.waypoints, draft.zones, {
          closed: !!mode.closed,
          repeats: draft.repeats,
          turnRadius: (draft.params.turnRadius ?? 2) / METERS_PER_UNIT,
          clearance: (draft.params.clearance ?? 1) / METERS_PER_UNIT,
        })
      return mode.closed
        ? createLoopRoute(draft.waypoints, draft.repeats)
        : createPointRoute(draft.waypoints)
    }
    if (geometry === 'orbit') {
      return draft.orbitCenter
        ? createOrbitRoute(
            draft.orbitCenter,
            draft.orbitRadius / METERS_PER_UNIT,
            draft.orbitLaps,
            draft.clockwise,
          )
        : null
    }
    return draft.anchor
      ? createManeuverRoute(
          draft.pattern,
          draft.anchor,
          draft.patternSize / METERS_PER_UNIT,
          draft.heading,
          draft.repeats,
        )
      : null
  }, [
    geometry,
    mode.closed,
    draft,
    profile.surfaceBound,
    streetMode,
    streetResult,
    streets.network,
    resolvedCoverage,
    streetCoverage,
    areaBuildings,
  ])
  const autoObstacles =
    geometry === 'area' && resolvedCoverage
      ? resolvedCoverage === 'streets'
        ? (streetCoverage?.obstacles ?? NO_POINTS)
        : areaBuildings
      : (streetResult?.obstacles ?? NO_POINTS)

  const simPath = route
    ? `M ${HOME.x} ${HOME.y} L ${route.start.x} ${route.start.y} ${route.path.replace(/^\s*M/, 'L')} L ${HOME.x} ${HOME.y}`
    : ''
  // Ground-style routes stop at every waypoint; the simulator and the live view need to know where.
  const stopUnits = useMemo(
    () =>
      profile.dwellParam && geometry === 'points' ? stopsAlongPath(simPath, draft.waypoints) : [],
    [profile.dwellParam, geometry, simPath, draft.waypoints],
  )
  // Terrain checks sample the route every ~8 m.
  const samples = useMemo(
    () =>
      profile.limits.maxGrade !== undefined && route
        ? samplePath(route.path, 8 / METERS_PER_UNIT)
        : NO_POINTS,
    [profile.limits.maxGrade, route],
  )
  const editHandles = useMemo(
    () => [
      ...(geometry === 'area'
        ? draft.surveyPoints.map((point, index) => ({ kind: 'area' as const, index, point }))
        : []),
      ...(usesZones
        ? draft.zones.flatMap((zone, zi) =>
            zone.map((point, index) => ({ kind: 'zone' as const, index, zone: zi, point })),
          )
        : []),
      ...(geometry === 'points'
        ? draft.waypoints.map((point, index) => ({ kind: 'wp' as const, index, point }))
        : []),
      ...(geometry === 'orbit' && draft.orbitCenter
        ? [{ kind: 'center' as const, index: 0, point: draft.orbitCenter }]
        : []),
      ...(geometry === 'maneuver' && draft.anchor
        ? [{ kind: 'anchor' as const, index: 0, point: draft.anchor }]
        : []),
    ],
    [
      geometry,
      usesZones,
      draft.surveyPoints,
      draft.zones,
      draft.waypoints,
      draft.orbitCenter,
      draft.anchor,
    ],
  )
  const planAreas = useMemo(
    () => [
      ...(geometry === 'area' ? [{ points: draft.surveyPoints, kind: 'area' as const }] : []),
      ...(usesZones ? draft.zones.map(points => ({ points, kind: 'zone' as const })) : []),
      ...autoObstacles.map(points => ({ points, kind: 'building' as const })),
    ],
    [geometry, usesZones, draft.surveyPoints, draft.zones, autoObstacles],
  )
  const sim = useMissionSimulation({
    vehicleId,
    enabled: ready,
    domain: profile.domain,
    pathKey: simPath,
    metersPerUnit: METERS_PER_UNIT,
    cruiseSpeed: speed,
    cruiseAltitude: viewAltitude,
    transitUnits: route ? [distance(HOME, route.start), distance(route.end, HOME)] : [0, 0],
    batteryStart: vehicle?.battery ?? 100,
    waypointCount: geometry === 'points' ? stopUnits.length || draft.waypoints.length : 0,
    stopUnits,
    dwellSeconds,
    acceptMeters,
    enduranceMin: profile.limits.enduranceMin,
  })
  // A plan that is under way is read-only until the vehicle is back and stopped.
  const locked = isActive(sim.stage)

  const draftKey = JSON.stringify(draft)
  const [savedKey, setSavedKey] = useState(draftKey)
  const hydrated = useRef(false)
  const persist = useRef<() => void>(() => {})

  useEffect(() => {
    if (hydrated.current || !vehicle || !missionsLoaded || missionsFetching) return
    hydrated.current = true
    const stored = missions.find(m => m.vehicleId === vehicleId && m.plan?.draft)?.plan?.draft
    const next = stored ? hydrateDraft(profile, stored) : emptyDraft(profile)
    setDraft(next)
    setSavedKey(JSON.stringify(next))
    setReady(true)
  }, [missions, missionsLoaded, missionsFetching, vehicleId, vehicle, profile])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => persist.current(), 500)
    return () => window.clearTimeout(timer)
  }, [draftKey, ready])

  useEffect(
    () => () => {
      persist.current()
    },
    [],
  )

  useEffect(() => {
    dispatch(actions.setMapMode('SATELLITE'))
    dispatch(actions.setCamera('TOP'))
    dispatch(actions.selectVehicle(vehicleId))
  }, [dispatch, vehicleId])

  const mission = missions.find(item => item.vehicleId === vehicleId)
  if (!vehicle && fleetLoading) return null
  if (!vehicle) return <Navigate to={vehicles.length ? '/missions' : '/'} replace />

  const routeMeters = route ? route.length * METERS_PER_UNIT : 0
  const transitMeters = route
    ? (distance(HOME, route.start) + distance(route.end, HOME)) * METERS_PER_UNIT
    : 0
  const areaHa = (polygonArea(draft.surveyPoints) * METERS_PER_UNIT ** 2) / 10000
  const minutes = estimateMinutes(
    profile,
    routeMeters,
    transitMeters,
    speed,
    stopUnits.length,
    dwellSeconds,
  )
  const batteryUse = Math.round((minutes / profile.limits.enduranceMin) * 100)
  const ctx: PlanContext = {
    draft,
    mode,
    vehicle,
    route,
    routeMeters,
    transitMeters,
    areaHa,
    minutes,
    batteryUse,
    drawingZone,
    samples,
    metersPerUnit: METERS_PER_UNIT,
    stops: stopUnits.length,
    coverage:
      geometry === 'area' && resolvedCoverage
        ? {
            style: resolvedCoverage,
            streetMeters: streetCoverage?.streetMeters ?? 0,
            coveredMeters: streetCoverage?.coveredMeters ?? 0,
            segments: streetCoverage?.segments ?? 0,
            buildings: areaBuildings.length,
            builtFraction: areaHa
              ? Math.min(
                  1,
                  (areaBuildings.reduce((n, b) => n + polygonArea(b), 0) * METERS_PER_UNIT ** 2) /
                    10000 /
                    areaHa,
                )
              : 0,
            dataStatus: streets.status,
          }
        : undefined,
    street: streetMode
      ? {
          status: streets.status,
          error: streets.error,
          legs: streetResult?.legs ?? [],
          onStreetFraction: streetResult?.onStreetFraction ?? 0,
          roads: streets.network?.roads.length ?? 0,
          buildings: streets.network?.buildings.length ?? 0,
        }
      : undefined,
  }
  const checks = profile.checks(ctx)
  const planBlocked = checks.some(check => check.level === 'fail')
  const dirty = draftKey !== savedKey
  const savedMission = missions.find(m => m.vehicleId === vehicleId && m.plan?.draft)
  const uploaded = !dirty && savedMission?.status === 'ready'
  const lifecycle =
    locked || sim.stage === 'complete' || sim.stage === 'aborted'
      ? { label: profile.stages[sim.stage], tone: stageTone(sim.stage) }
      : uploaded
        ? { label: 'uploaded', tone: 'ok' as const }
        : dirty
          ? { label: 'draft', tone: 'muted' as const }
          : { label: 'saved', tone: 'warn' as const }
  const savePlan = async () => {
    if (!hydrated.current || !vehicle || draftKey === savedKey) return
    const flyable = route && !planBlocked
    await saveMissionPlan({
      name: mode.title,
      vehicleId: vehicle.id,
      waypoints: flyable ? waypointsFromPathData(simPath, planAltitude) : [],
      plan: {
        draft,
        pathData: flyable ? simPath : '',
        mode: draft.planMode,
        domain: profile.domain,
        altitude: planAltitude,
        speed,
        transitMeters: flyable
          ? [
              distance(HOME, route.start) * METERS_PER_UNIT,
              distance(route.end, HOME) * METERS_PER_UNIT,
            ]
          : [0, 0],
        stopUnits: flyable ? stopUnits : [],
        dwellSeconds,
        acceptMeters,
        autoObstacles: autoObstacles.length ? autoObstacles : undefined,
      },
    }).unwrap()
    setSavedKey(draftKey)
  }
  persist.current = () => void savePlan()
  const summary: Array<[string, string]> = [
    [`${((routeMeters + transitMeters) / 1000).toFixed(1)} km`, 'ROUTE'],
    [formatDuration(minutes), 'EST. TIME'],
    ...profile.summary(ctx),
  ]
  const hint = (() => {
    if (geometry === 'area') {
      if (!draft.boundaryComplete) {
        return draft.surveyPoints.length
          ? `${draft.surveyPoints.length} POINTS · CONTINUE OR COMPLETE AREA`
          : 'CLICK MAP TO PLACE THE FIRST BOUNDARY POINT'
      }
      if (drawingZone) {
        const current = draft.zones[draft.zones.length - 1]?.length ?? 0
        return current
          ? `ZONE ${draft.zones.length} · ${current} POINTS · CONTINUE OR COMPLETE ZONE`
          : `ZONE ${draft.zones.length} · CLICK MAP TO PLACE THE FIRST EXCLUSION POINT`
      }
      return 'DRAG POINTS TO ADJUST THE AREA EDGE OR ZONE'
    }
    if (geometry === 'points') {
      if (streetMode && !drawingZone) {
        if (!streets.network)
          return draft.waypoints.length
            ? `${draft.waypoints.length} TARGETS · DIRECT ROUTE UNTIL STREET DATA LOADS`
            : 'CLICK MAP TO PLACE A TARGET · STREET DATA IS LOADING'
        return draft.waypoints.length
          ? `${draft.waypoints.length} TARGETS · ROUTE FOLLOWS STREETS · CLICK TO ADD`
          : 'CLICK MAP TO PLACE A TARGET · THE ROVER PLANS ITS OWN WAY ALONG THE STREETS'
      }
      if (drawingZone) {
        const current = draft.zones[draft.zones.length - 1]?.length ?? 0
        return current
          ? `OBSTACLE ${draft.zones.length} · ${current} POINTS · CONTINUE OR COMPLETE OBSTACLE`
          : `OBSTACLE ${draft.zones.length} · CLICK MAP TO OUTLINE THE OBSTACLE`
      }
      return draft.waypoints.length
        ? `${draft.waypoints.length} WAYPOINTS · CLICK TO ADD · DRAG TO MOVE`
        : 'CLICK MAP TO PLACE THE FIRST WAYPOINT'
    }
    if (geometry === 'orbit') {
      return draft.orbitCenter
        ? 'DRAG CENTER OR CLICK MAP TO MOVE TARGET'
        : 'CLICK MAP TO SET THE ORBIT CENTER'
    }
    return draft.anchor
      ? 'DRAG ANCHOR OR CLICK MAP TO MOVE PATTERN'
      : 'CLICK MAP TO SET THE PATTERN ANCHOR'
  })()

  const stopZone = () => {
    setDrawingZone(false)
    patch({ zones: draft.zones.filter(zone => zone.length >= 3) })
  }
  const switchMode = (next: PlanMode) => {
    setDrawingZone(false)
    setDraft(d => ({ ...d, planMode: next, zones: d.zones.filter(zone => zone.length >= 3) }))
  }
  const applyAreaPreset = (name: string) => {
    const preset = name === 'Custom plan' ? draft.customSurvey : profile.presets.area[name]
    if (!preset) return
    setDrawingZone(false)
    setDraft(d => ({
      ...d,
      activePreset: { ...d.activePreset, [d.planMode]: name },
      surveyPoints: preset.points.map(point => ({ ...point })),
      zones: preset.zones.map(zone => zone.map(point => ({ ...point }))),
      boundaryComplete: true,
      params: {
        ...d.params,
        ...(d.params.spacing !== undefined ? { spacing: preset.spacing } : {}),
        ...(d.params.overlap !== undefined ? { overlap: preset.overlap } : {}),
      },
    }))
  }
  const applyPointPreset = (name: string) => {
    const preset = (mode.closed ? profile.presets.loop : profile.presets.points)[name]
    if (!preset) return
    setDraft(d => ({
      ...d,
      activePreset: { ...d.activePreset, [d.planMode]: name },
      waypoints: preset.map(point => ({ ...point })),
    }))
  }
  const applyOrbitPreset = (name: string) => {
    const preset = profile.presets.orbit[name]
    setDraft(d => ({
      ...d,
      activePreset: { ...d.activePreset, [d.planMode]: name },
      orbitCenter: { ...preset.center },
      orbitRadius: preset.radius,
      orbitLaps: preset.laps,
    }))
  }
  const applyManeuverPreset = (name: string) => {
    const preset = profile.presets.maneuver[name]
    setDraft(d => ({
      ...d,
      activePreset: { ...d.activePreset, [d.planMode]: name },
      pattern: preset.pattern,
      anchor: { ...preset.anchor },
      patternSize: preset.size,
      heading: preset.heading,
      repeats: preset.repeats,
    }))
  }
  const addPointAt = (point: Point) => {
    if (geometry === 'area') {
      if (!draft.boundaryComplete) patch({ surveyPoints: [...draft.surveyPoints, point] })
      else if (drawingZone) {
        patch({
          zones: draft.zones.map((zone, index) =>
            index === draft.zones.length - 1
              ? [...zone, clampToPolygon(point, draft.surveyPoints)]
              : zone,
          ),
        })
      } else return
    } else if (geometry === 'points') {
      if (drawingZone && obstacles)
        patch({
          zones: draft.zones.map((zone, index) =>
            index === draft.zones.length - 1 ? [...zone, point] : zone,
          ),
        })
      else patch({ waypoints: [...draft.waypoints, point] })
    } else if (geometry === 'orbit') patch({ orbitCenter: point })
    else patch({ anchor: point })
    markCustom()
  }
  const movePointTo = (target: DragTarget, next: Point) => {
    const replace = (points: Point[]) =>
      points.map((item, index) => (index === target.index ? next : item))
    if (target.kind === 'area') {
      const nextArea = replace(draft.surveyPoints)
      patch({
        surveyPoints: nextArea,
        zones: draft.zones.map(zone => zone.map(point => clampToPolygon(point, nextArea))),
      })
    } else if (target.kind === 'zone') {
      const clamped = geometry === 'area' ? clampToPolygon(next, draft.surveyPoints) : next
      patch({
        zones: draft.zones.map((zone, index) =>
          index === target.zone
            ? zone.map((point, i) => (i === target.index ? clamped : point))
            : zone,
        ),
      })
    } else if (target.kind === 'wp') patch({ waypoints: replace(draft.waypoints) })
    else if (target.kind === 'center') patch({ orbitCenter: next })
    else patch({ anchor: next })
    markCustom()
  }
  const paramsFor = (group: 'primary' | 'failsafe') =>
    profile.parameters.filter(
      p => p.group === group && (!p.modes || p.modes.includes(draft.planMode)),
    )
  const paramRange = (p: (typeof profile.parameters)[number]) => (
    <MissionRange
      key={p.id}
      label={p.label}
      value={draft.params[p.id] ?? p.default}
      min={p.min}
      max={p.max}
      step={p.step}
      unit={p.unit}
      onChange={value => setParam(p.id, value)}
    />
  )
  const primaryParams = paramsFor('primary')
  const failsafeParams = paramsFor('failsafe')
  const subtitleParts = primaryParams
    .slice(0, 2)
    .map(p => `${draft.params[p.id] ?? p.default} ${p.unit}`)

  const planFooter = (
    <footer className="mp-footer">
      <button
        className="mp-btn primary block"
        disabled={locked || planBlocked || !route || saving || uploading || uploaded}
        onClick={async () => {
          if (dirty) await savePlan()
          await uploadMissionPlan(vehicle.id).unwrap()
        }}
      >
        <Route />{' '}
        {uploading
          ? 'Uploading…'
          : uploaded
            ? 'Uploaded to vehicle'
            : savedMission?.status === 'ready'
              ? 'Plan changed · re-upload'
              : 'Upload to vehicle'}
      </button>
      <small className="mp-note">
        {dirty
          ? saving
            ? 'Saving draft…'
            : 'Draft autosaves · upload to make it the active mission'
          : uploaded
            ? profile.words.onCraft
            : `Draft saved · not on the ${profile.words.craft} yet`}
      </small>
      {uploaded && profile.live && (
        <Link className="mp-btn block" to={`/vehicles/${vehicle.id}`}>
          {profile.words.openLive}
        </Link>
      )}
      <p>Simulation only · Commands are not connected to hardware.</p>
    </footer>
  )

  const pointPresets = Object.keys(mode.closed ? profile.presets.loop : profile.presets.points)
  const zonesSection = (
    <PanelSection
      title={obstacles ? 'Obstacles' : 'Exclusion zones'}
      meta={drawingZone ? 'Drawing' : draft.zones.length ? `${draft.zones.length} placed` : 'None'}
    >
      <div className="mp-row">
        {drawingZone ? (
          <button
            className="mp-btn accent"
            disabled={(draft.zones[draft.zones.length - 1]?.length ?? 0) < 3}
            onClick={stopZone}
          >
            <Check /> Complete {obstacles ? 'obstacle' : 'zone'}
          </button>
        ) : (
          <button
            className="mp-btn accent"
            disabled={geometry === 'area' && !draft.boundaryComplete}
            onClick={() => {
              patch({ zones: [...draft.zones, []] })
              setDrawingZone(true)
            }}
          >
            <Plus /> Add {obstacles ? 'obstacle' : 'zone'}
          </button>
        )}
        <button
          className="mp-btn"
          disabled={!draft.zones.length}
          onClick={() => {
            setDrawingZone(false)
            patch({ zones: [] })
            markCustom()
          }}
        >
          <RotateCcw /> Clear all
        </button>
      </div>
      {draft.zones.length > 0 && (
        <div className="mp-waypoints">
          {draft.zones.map((zone, zi) => (
            <div key={zi}>
              <span>X{zi + 1}</span>
              <MapPin />
              <p>
                <b>
                  {obstacles ? 'Obstacle' : 'Exclusion'} {String(zi + 1).padStart(2, '0')}
                </b>
                <small>
                  {zone.length} points
                  {drawingZone && zi === draft.zones.length - 1 ? ' · drawing' : ''}
                </small>
              </p>
              <button
                title={obstacles ? 'Remove obstacle' : 'Remove zone'}
                onClick={() => {
                  if (drawingZone && zi === draft.zones.length - 1) setDrawingZone(false)
                  patch({ zones: draft.zones.filter((_, index) => index !== zi) })
                  markCustom()
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mp-hint">
        {obstacles
          ? 'Outline buildings, ditches or no-go ground. The route detours around each one with the set clearance and rounds corners to the turning radius.'
          : draft.boundaryComplete
            ? 'Add as many zones as needed. Click the map to mark points; the route goes around every zone.'
            : `Complete the ${mode.label.toLowerCase()} area first.`}
      </p>
    </PanelSection>
  )

  return (
    <div className={`mission-page${view3d ? ' view-3d' : ''}`} data-drag-host>
      <WorkspaceHeader
        vehicle={vehicle}
        profile={profile}
        active="plan"
        backTo="/missions"
        lifecycle={lifecycle}
        link={vehicle.link}
        battery={vehicle.battery}
        extra={<span className="ws-context">{mode.title}</span>}
      />
      <FlightView3D
        profile={profile}
        pathRef={simPathRef}
        pathKey={simPath}
        metersPerUnit={METERS_PER_UNIT}
        altitude={viewAltitude}
        areas={planAreas}
        home={HOME}
        handles={locked ? NO_HANDLES : editHandles}
        onMovePoint={locked ? noop : movePointTo}
        onAddPoint={locked ? noop : addPointAt}
        onCursor={setCursor}
        frame={sim.frame}
        trail={sim.trail}
        view3d={view3d}
        callsign={vehicle.id}
        originKey={home.key}
        network={profile.streetRouting ? streets.network : null}
        basemap={profile.streetRouting ? 'tactical' : 'satellite'}
        onViewChange={profile.streetRouting ? setView : undefined}
        motion={
          sim.stage === 'standby' || sim.stage === 'complete' || sim.stage === 'aborted'
            ? 'off'
            : sim.stage === 'armed'
              ? 'idle'
              : 'run'
        }
      />
      <svg className="sim-path-source" aria-hidden width="0" height="0">
        <path ref={simPathRef} d={simPath} />
      </svg>
      <div className={`mission-edit-hint${locked ? ' locked' : ''}`}>
        <MousePointer2 />
        {locked ? profile.words.planLocked : hint}
      </div>
      <SimulationHud
        sim={sim}
        profile={profile}
        disabled={!route}
        view3d={view3d}
        onSetView={setView3d}
      />
      <MapStatusStrip cursor={cursor} metersPerUnit={METERS_PER_UNIT} />
      <div className="mission-home-chip">
        <HomeSourceChip />
        {profile.streetRouting && (
          <span className={`street-chip ${streets.status}`} title={streets.error}>
            <i />
            {streets.status === 'ready'
              ? `MAP DATA · ${streets.network?.roads.length ?? 0} STREETS · ${streets.network?.buildings.length ?? 0} BUILDINGS`
              : streets.status === 'error'
                ? 'MAP DATA · UNAVAILABLE · ROUTING OVERLAND'
                : `MAP DATA · LOADING ${streets.coverage.loaded}/${streets.coverage.wanted} TILES`}
          </span>
        )}
      </div>
      {route && (
        <div className="mission-map-summary">
          {summary.map(([value, label]) => (
            <span key={label}>
              <b>{value}</b>
              {label}
            </span>
          ))}
          <span
            className={batteryUse + profile.limits.batteryReserve > vehicle.battery ? 'over' : ''}
          >
            <b>{batteryUse}%</b>BATTERY
          </span>
        </div>
      )}
      <PanelDock>
        <FloatingPanel
          id="plan"
          className="plan-panel"
          icon={<TypeIcon type={vehicle.type} size={20} />}
          title={vehicle.name}
          subtitle={`${vehicle.id} · ${mode.label} plan`}
          actions={
            <button
              className="mp-icon-btn"
              title="Change vehicle"
              onClick={() => navigate('/missions')}
            >
              <ArrowLeftRight />
            </button>
          }
        >
          <div className="mp-modes">
            {profile.modes.map(item => (
              <button
                key={item.id}
                className={draft.planMode === item.id ? 'active' : ''}
                onClick={() => switchMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={`mp-body${locked ? ' locked' : ''}`}>
            <dl className="mp-kv">
              <div>
                <dt>Mission</dt>
                <dd>{dirty ? 'Unsaved draft' : `Saved · ${vehicle.id}`}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{locked ? profile.stages[sim.stage] : 'PLANNING'}</dd>
              </div>
            </dl>
            {geometry === 'area' && (
              <>
                <PanelSection
                  title={`${mode.label} area`}
                  meta={draft.boundaryComplete ? `${draft.surveyPoints.length} points` : 'Drawing'}
                >
                  <div className="mp-row">
                    <button
                      className="mp-btn accent"
                      disabled={draft.surveyPoints.length < 3 || draft.boundaryComplete}
                      onClick={() => patch({ boundaryComplete: true })}
                    >
                      <Check /> Complete area
                    </button>
                    <button
                      className="mp-btn"
                      onClick={() => {
                        setDrawingZone(false)
                        patch({ surveyPoints: [], boundaryComplete: false, zones: [] })
                        markCustom()
                      }}
                    >
                      <RotateCcw /> Reset
                    </button>
                  </div>
                  <div className="mp-label">Presets</div>
                  <PresetChips
                    names={[
                      ...Object.keys(profile.presets.area),
                      ...(draft.customSurvey ? ['Custom plan'] : []),
                    ]}
                    active={draft.activePreset[draft.planMode] ?? ''}
                    onPick={applyAreaPreset}
                  />
                  <button
                    className="mp-btn ghost block"
                    disabled={!draft.boundaryComplete}
                    onClick={() =>
                      setDraft(d => ({
                        ...d,
                        customSurvey: {
                          points: d.surveyPoints.map(point => ({ ...point })),
                          zones: d.zones
                            .filter(zone => zone.length >= 3)
                            .map(zone => zone.map(point => ({ ...point }))),
                          spacing: d.params.spacing ?? 0,
                          overlap: d.params.overlap ?? 0,
                        },
                        activePreset: { ...d.activePreset, [d.planMode]: 'Custom plan' },
                      }))
                    }
                  >
                    <Plus /> {draft.customSurvey ? 'Update custom preset' : 'Save as preset'}
                  </button>
                  {profile.streetRouting && (
                    <>
                      <div className="mp-label">Coverage style</div>
                      <div className="mp-chips">
                        {(
                          [
                            ['auto', 'Auto'],
                            ['streets', 'Street sweep'],
                            ['field', 'Open ground'],
                          ] as Array<['auto' | 'streets' | 'field', string]>
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            className={coverageStyle === id ? 'active' : ''}
                            onClick={() => patch({ coverageStyle: id })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mp-hint">
                        {!draft.boundaryComplete
                          ? 'Complete the area to see how it will be covered.'
                          : resolvedCoverage === 'streets'
                            ? `Street sweep: every allowed street inside the area is driven, ${areaBuildings.length} buildings stay untouched.`
                            : `Open-ground sweep: lines are clipped around ${areaBuildings.length} map buildings and any drawn obstacles.`}
                      </p>
                    </>
                  )}
                </PanelSection>
                {zonesSection}
              </>
            )}
            {geometry === 'points' && (
              <PanelSection
                title={streetMode ? 'Targets' : 'Waypoints'}
                meta={draft.waypoints.length ? `${draft.waypoints.length} placed` : 'Empty'}
              >
                <div className="mp-row">
                  <button
                    className="mp-btn"
                    disabled={!draft.waypoints.length}
                    onClick={() => {
                      patch({ waypoints: draft.waypoints.slice(0, -1) })
                      markCustom()
                    }}
                  >
                    <RotateCcw /> Undo last
                  </button>
                  <button
                    className="mp-btn"
                    disabled={!draft.waypoints.length}
                    onClick={() => {
                      patch({ waypoints: [] })
                      markCustom()
                    }}
                  >
                    <Trash2 /> Clear
                  </button>
                </div>
                {pointPresets.length > 0 && (
                  <>
                    <div className="mp-label">Presets</div>
                    <PresetChips
                      names={pointPresets}
                      active={draft.activePreset[draft.planMode] ?? ''}
                      onPick={applyPointPreset}
                    />
                  </>
                )}
                {mode.closed && (
                  <MissionRange
                    label="Laps"
                    value={draft.repeats}
                    min={1}
                    max={10}
                    unit=""
                    onChange={value => {
                      patch({ repeats: value })
                      markCustom()
                    }}
                  />
                )}
                {draft.waypoints.length > 0 && (
                  <div className="mp-waypoints">
                    {draft.waypoints.map((point, index) => (
                      <div key={index}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <MapPin />
                        <p>
                          <b>
                            {streetMode ? 'Target' : 'Waypoint'} {index + 1}
                          </b>
                          <small>
                            {Math.round((point.x - HOME.x) * METERS_PER_UNIT)} m E ·{' '}
                            {Math.round((HOME.y - point.y) * METERS_PER_UNIT)} m N
                            {air
                              ? ` · ${planAltitude} m`
                              : dwellSeconds
                                ? ` · ${dwellSeconds} s`
                                : ''}
                            {streetMode && streetResult?.legs[index]
                              ? streetResult.legs[index].reachable
                                ? ` · ${Math.round(streetResult.legs[index].offStreetMeters)} m off street`
                                : ` · ${streetResult.legs[index].reason}`
                              : ''}
                          </small>
                        </p>
                        <button
                          title="Remove"
                          onClick={() => {
                            patch({ waypoints: draft.waypoints.filter((_, i) => i !== index) })
                            markCustom()
                          }}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </PanelSection>
            )}
            {streetMode && (
              <PanelSection
                title="Street options"
                meta={
                  streets.status === 'ready'
                    ? `${streets.network?.roads.length ?? 0} streets`
                    : streets.status === 'error'
                      ? 'No data'
                      : 'Loading'
                }
              >
                <div className={`street-status ${streets.status}`}>
                  <i />
                  {streets.status === 'ready'
                    ? `${streets.network?.roads.length ?? 0} streets · ${streets.network?.buildings.length ?? 0} buildings from OpenStreetMap · ${streets.coverage.loaded} tiles in view`
                    : streets.status === 'error'
                      ? `Street data unavailable · ${streets.error ?? 'network error'}`
                      : `Fetching streets and buildings for the area in view… ${streets.coverage.loaded}/${streets.coverage.wanted} tiles`}
                  {streets.status === 'error' && (
                    <button className="mp-btn small" onClick={streets.retry}>
                      Retry
                    </button>
                  )}
                </div>
                <div className="mp-label">Allowed ways</div>
                <div className="mp-chips">
                  {(
                    [
                      ['roads', 'Streets'],
                      ['service', 'Service & tracks'],
                      ['paths', 'Paths & footways'],
                    ] as Array<[RoadClass, string]>
                  ).map(([cls, label]) => (
                    <button
                      key={cls}
                      className={draft.street.classes.includes(cls) ? 'active' : ''}
                      onClick={() => {
                        const on = draft.street.classes.includes(cls)
                        const classes = on
                          ? draft.street.classes.filter(c => c !== cls)
                          : [...draft.street.classes, cls]
                        if (!classes.length) return
                        patch({ street: { ...draft.street, classes } })
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mp-label">Major roads</div>
                <div className="mp-chips">
                  {[true, false].map(value => (
                    <button
                      key={String(value)}
                      className={draft.street.avoidMajor === value ? 'active' : ''}
                      onClick={() => patch({ street: { ...draft.street, avoidMajor: value } })}
                    >
                      {value ? 'Prefer quiet streets' : 'Allow'}
                    </button>
                  ))}
                </div>
                <MissionRange
                  label="Off-street approach"
                  value={draft.street.approachMeters}
                  min={5}
                  max={150}
                  step={5}
                  unit="m"
                  onChange={value => patch({ street: { ...draft.street, approachMeters: value } })}
                />
                <p className="mp-hint">
                  Targets are reached along the streets. The last stretch leaves the road and steers
                  around detected buildings; targets further off the street than the approach limit
                  are flagged.
                </p>
              </PanelSection>
            )}
            {obstacles && zonesSection}
            {geometry === 'orbit' && (
              <PanelSection title="Target" meta={draft.orbitCenter ? 'Placed' : 'Not placed'}>
                <div className="mp-row">
                  <button
                    className="mp-btn"
                    disabled={!draft.orbitCenter}
                    onClick={() => {
                      patch({ orbitCenter: null })
                      markCustom()
                    }}
                  >
                    <RotateCcw /> Reset
                  </button>
                </div>
                <div className="mp-label">Presets</div>
                <PresetChips
                  names={Object.keys(profile.presets.orbit)}
                  active={draft.activePreset[draft.planMode] ?? ''}
                  onPick={applyOrbitPreset}
                />
                <MissionRange
                  label="Radius"
                  value={draft.orbitRadius}
                  min={20}
                  max={150}
                  unit="m"
                  onChange={value => {
                    patch({ orbitRadius: value })
                    markCustom()
                  }}
                />
                <MissionRange
                  label="Laps"
                  value={draft.orbitLaps}
                  min={1}
                  max={6}
                  unit=""
                  onChange={value => {
                    patch({ orbitLaps: value })
                    markCustom()
                  }}
                />
                <div className="mp-label">Direction</div>
                <div className="mp-chips">
                  {[true, false].map(value => (
                    <button
                      key={String(value)}
                      className={draft.clockwise === value ? 'active' : ''}
                      onClick={() => {
                        patch({ clockwise: value })
                        markCustom()
                      }}
                    >
                      {value ? 'Clockwise' : 'Counter-clockwise'}
                    </button>
                  ))}
                </div>
              </PanelSection>
            )}
            {geometry === 'maneuver' && (
              <PanelSection title="Maneuver" meta={draft.anchor ? 'Placed' : 'Not placed'}>
                <div className="mp-label">Pattern</div>
                <div className="mp-chips">
                  {PATTERNS.map(item => (
                    <button
                      key={item.id}
                      className={draft.pattern === item.id ? 'active' : ''}
                      onClick={() => {
                        patch({ pattern: item.id })
                        markCustom()
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mp-label">Presets</div>
                <PresetChips
                  names={Object.keys(profile.presets.maneuver)}
                  active={draft.activePreset[draft.planMode] ?? ''}
                  onPick={applyManeuverPreset}
                />
                <MissionRange
                  label="Size"
                  value={draft.patternSize}
                  min={40}
                  max={250}
                  unit="m"
                  onChange={value => {
                    patch({ patternSize: value })
                    markCustom()
                  }}
                />
                <MissionRange
                  label="Heading"
                  value={draft.heading}
                  min={-90}
                  max={90}
                  unit="°"
                  onChange={value => {
                    patch({ heading: value })
                    markCustom()
                  }}
                />
                <MissionRange
                  label="Repeats"
                  value={draft.repeats}
                  min={1}
                  max={6}
                  unit=""
                  onChange={value => {
                    patch({ repeats: value })
                    markCustom()
                  }}
                />
                <button
                  className="mp-btn block"
                  disabled={!draft.anchor}
                  onClick={() => {
                    patch({ anchor: null })
                    markCustom()
                  }}
                >
                  <RotateCcw /> Reset anchor
                </button>
              </PanelSection>
            )}
            {mission && mission.id !== `PLN-${vehicle.id}` && (
              <PanelSection title="Assigned mission" meta={mission.status.toUpperCase()}>
                <div className="mp-progress">
                  <i>
                    <b style={{ width: `${mission.progress}%` }} />
                  </i>
                  <small>
                    {mission.name} · {mission.progress}% reported by the vehicle
                  </small>
                </div>
              </PanelSection>
            )}
          </div>
        </FloatingPanel>
        <FloatingPanel
          id="flight"
          className="plan-panel"
          icon={<Gauge />}
          title={profile.words.paramsPanel}
          subtitle={`${subtitleParts.join(' · ')} · ${draft.linkLoss} on link loss`}
          defaultOpen={false}
        >
          <div className={`mp-body${locked ? ' locked' : ''}`}>
            <PanelSection title={profile.words.primaryGroup}>
              {primaryParams.map(paramRange)}
            </PanelSection>
            <PanelSection title="Failsafe">
              {failsafeParams.map(paramRange)}
              <div className="mp-label">On link loss</div>
              <div className="mp-chips">
                {profile.linkLossActions.map(action => (
                  <button
                    key={action}
                    className={draft.linkLoss === action ? 'active' : ''}
                    onClick={() => patch({ linkLoss: action })}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </PanelSection>
          </div>
        </FloatingPanel>
        <FloatingPanel
          id="preflight"
          className="plan-panel"
          icon={<ShieldCheck />}
          title={profile.words.preCheck}
          subtitle={
            planBlocked
              ? `${checks.filter(c => c.level === 'fail').length} blocking`
              : checks.some(c => c.level === 'warn')
                ? `${checks.filter(c => c.level === 'warn').length} warnings`
                : uploaded
                  ? 'All clear · uploaded'
                  : 'All clear'
          }
        >
          <div className="mp-body">
            <PanelSection
              title={profile.words.checksTitle}
              meta={
                planBlocked
                  ? `${checks.filter(c => c.level === 'fail').length} blocking`
                  : checks.some(c => c.level === 'warn')
                    ? `${checks.filter(c => c.level === 'warn').length} warnings`
                    : 'All clear'
              }
            >
              <div className="mp-checks">
                {checks.map(check => (
                  <div key={check.label} className={check.level}>
                    <i />
                    <b>{check.label}</b>
                    <small>{check.detail}</small>
                  </div>
                ))}
              </div>
            </PanelSection>
          </div>
          {planFooter}
        </FloatingPanel>
      </PanelDock>
    </div>
  )
}

function PanelSection({
  title,
  meta,
  action,
  children,
}: {
  title: string
  meta?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mp-section">
      <div className="mp-section-head">
        <h3>{title}</h3>
        {meta && <span>{meta}</span>}
        {action}
      </div>
      {children}
    </section>
  )
}

function MissionRange({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="mission-range">
      <span>
        <label>{label}</label>
        <b>
          {value} {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function PresetChips({
  names,
  active,
  onPick,
}: {
  names: string[]
  active: string
  onPick: (name: string) => void
}) {
  return (
    <div className="mp-chips">
      {names.map(name => (
        <button className={active === name ? 'active' : ''} key={name} onClick={() => onPick(name)}>
          {name}
        </button>
      ))}
    </div>
  )
}
