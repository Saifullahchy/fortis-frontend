import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  CircleStop,
  Gauge,
  MapPin,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Route,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CommandMap } from '../map/CommandMap'
import { MapStatusStrip, SimulationHud } from './MissionHud'
import { FlightView3D } from './FlightView3D'
import { WorkspaceHeader } from './WorkspaceHeader'
import { HomeSourceChip } from './HomeSourceChip'
import { useHome } from './homePosition'
import { FloatingPanel, PanelDock } from '../../components/layout/FloatingPanel'
import type { PlannerDraft } from '../../types/domain'
import { waypointsFromPathData } from './missionPlan'
import { isAirborne } from './flightSimulator'
import { useFlightSimulation } from './useFlightSimulation'
import {
  useGetMissionsQuery,
  useGetVehiclesQuery,
  useSaveMissionPlanMutation,
  useUploadMissionPlanMutation,
} from '../../services/api/baseApi'
import { BatteryMeter, StatusBadge, TypeIcon } from '../../components/common'
import { useAppDispatch } from '../../store/hooks'
import { actions } from '../../store'
import {
  HOME,
  METERS_PER_UNIT,
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
  type Route as FlightRoute,
} from './missionGeometry'

type CheckLevel = 'pass' | 'warn' | 'fail'
type PlanMode = 'survey' | 'p2p' | 'orbit' | 'maneuver'
type DragTarget = {
  kind: 'area' | 'zone' | 'wp' | 'center' | 'anchor'
  index: number
  zone?: number
}

const ENDURANCE_MIN = 35
const NO_HANDLES: never[] = []
const noop = () => {}
const BATTERY_RESERVE = 25
const MAX_ALTITUDE = 120
const LINK_LOSS_ACTIONS = ['Return home', 'Hold', 'Land']
const MODES: Array<{ id: PlanMode; label: string; title: string }> = [
  { id: 'survey', label: 'Survey', title: 'New survey mission' },
  { id: 'p2p', label: 'P2P', title: 'New point-to-point mission' },
  { id: 'orbit', label: 'Encircle', title: 'New encirclement mission' },
  { id: 'maneuver', label: 'Maneuver', title: 'New maneuver mission' },
]
const PATTERNS: Array<{ id: Pattern; label: string }> = [
  { id: 'figure8', label: 'Figure-8' },
  { id: 'racetrack', label: 'Racetrack' },
  { id: 'zigzag', label: 'Zig-zag' },
]

interface SurveyPreset {
  points: Point[]
  zones: Point[][]
  spacing: number
  overlap: number
}
const SURVEY_PRESETS: Record<string, SurveyPreset> = {
  'Orchard grid': {
    points: [
      { x: 129, y: 125 },
      { x: 510, y: 105 },
      { x: 558, y: 540 },
      { x: 167, y: 580 },
    ],
    zones: [
      [
        { x: 290, y: 235 },
        { x: 380, y: 215 },
        { x: 395, y: 300 },
        { x: 310, y: 320 },
      ],
      [
        { x: 215, y: 420 },
        { x: 330, y: 400 },
        { x: 345, y: 490 },
        { x: 230, y: 500 },
      ],
    ],
    spacing: 18,
    overlap: 72,
  },
  'Dense capture': {
    points: [
      { x: 156, y: 145 },
      { x: 490, y: 130 },
      { x: 524, y: 520 },
      { x: 177, y: 545 },
    ],
    zones: [],
    spacing: 11,
    overlap: 82,
  },
  'Perimeter scan': {
    points: [
      { x: 116, y: 180 },
      { x: 469, y: 95 },
      { x: 575, y: 490 },
      { x: 190, y: 600 },
    ],
    zones: [],
    spacing: 30,
    overlap: 55,
  },
}
const P2P_PRESETS: Record<string, Point[]> = {
  'Out & back': [{ x: 520, y: 300 }],
  Dogleg: [
    { x: 260, y: 400 },
    { x: 430, y: 180 },
    { x: 700, y: 220 },
  ],
  'Box circuit': [
    { x: 200, y: 200 },
    { x: 600, y: 200 },
    { x: 600, y: 500 },
    { x: 200, y: 500 },
  ],
}
const ORBIT_PRESETS: Record<string, { center: Point; radius: number; laps: number }> = {
  'Close orbit': { center: { x: 480, y: 330 }, radius: 40, laps: 3 },
  'Standoff ring': { center: { x: 500, y: 320 }, radius: 80, laps: 2 },
  'Wide ring': { center: { x: 520, y: 340 }, radius: 130, laps: 1 },
}
const MANEUVER_PRESETS: Record<
  string,
  { pattern: Pattern; anchor: Point; size: number; heading: number; repeats: number }
> = {
  'Figure-8': { pattern: 'figure8', anchor: { x: 480, y: 330 }, size: 120, heading: 0, repeats: 2 },
  Racetrack: {
    pattern: 'racetrack',
    anchor: { x: 500, y: 320 },
    size: 160,
    heading: 20,
    repeats: 3,
  },
  'Zig-zag': { pattern: 'zigzag', anchor: { x: 480, y: 340 }, size: 140, heading: -15, repeats: 1 },
}

export function MissionsPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>()
  return <MissionWorkspace key={vehicleId ?? 'select'} />
}

function MissionWorkspace() {
  const { vehicleId } = useParams<{ vehicleId: string }>()
  const navigate = useNavigate()
  const { data: vehicles = [], isLoading: fleetLoading } = useGetVehiclesQuery()
  const {
    data: missions = [],
    isSuccess: missionsLoaded,
    isFetching: missionsFetching,
  } = useGetMissionsQuery(undefined, { refetchOnMountOrArgChange: true })
  const [saveMissionPlan, { isLoading: saving }] = useSaveMissionPlanMutation()
  const [uploadMissionPlan, { isLoading: uploading }] = useUploadMissionPlanMutation()
  const [status, setStatus] = useState('executing')
  const [wps, setWps] = useState([1, 2, 3, 4])
  const [altitude, setAltitude] = useState(120)
  const [overlap, setOverlap] = useState(72)
  const [speed, setSpeed] = useState(12)
  const [spacing, setSpacing] = useState(18)
  const [returnAltitude, setReturnAltitude] = useState(80)
  const [linkLoss, setLinkLoss] = useState('Return home')
  const [planMode, setPlanMode] = useState<PlanMode>('survey')
  const [surveyPoints, setSurveyPoints] = useState<Point[]>([])
  const [boundaryComplete, setBoundaryComplete] = useState(false)
  const [zones, setZones] = useState<Point[][]>([])
  const [drawingZone, setDrawingZone] = useState(false)
  const [waypoints, setWaypoints] = useState<Point[]>([])
  const [orbitCenter, setOrbitCenter] = useState<Point | null>(null)
  const [orbitRadius, setOrbitRadius] = useState(80)
  const [orbitLaps, setOrbitLaps] = useState(2)
  const [clockwise, setClockwise] = useState(true)
  const [pattern, setPattern] = useState<Pattern>('figure8')
  const [anchor, setAnchor] = useState<Point | null>(null)
  const [patternSize, setPatternSize] = useState(120)
  const [heading, setHeading] = useState(0)
  const [repeats, setRepeats] = useState(2)
  const [activePreset, setActivePreset] = useState<Record<PlanMode, string>>({
    survey: '',
    p2p: '',
    orbit: '',
    maneuver: '',
  })
  const [customSurvey, setCustomSurvey] = useState<SurveyPreset | null>(null)
  const simPathRef = useRef<SVGPathElement>(null)
  const home = useHome()
  const [ready, setReady] = useState(false)
  const [view3d, setView3d] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)
  const dispatch = useAppDispatch()

  const route = useMemo<FlightRoute | null>(() => {
    if (planMode === 'survey') {
      return createSurveyRoute(surveyPoints, spacing / METERS_PER_UNIT, zones)
    }
    if (planMode === 'p2p') return createPointRoute(waypoints)
    if (planMode === 'orbit') {
      return orbitCenter
        ? createOrbitRoute(orbitCenter, orbitRadius / METERS_PER_UNIT, orbitLaps, clockwise)
        : null
    }
    return anchor
      ? createManeuverRoute(pattern, anchor, patternSize / METERS_PER_UNIT, heading, repeats)
      : null
  }, [
    planMode,
    surveyPoints,
    spacing,
    zones,
    waypoints,
    orbitCenter,
    orbitRadius,
    orbitLaps,
    clockwise,
    anchor,
    pattern,
    patternSize,
    heading,
    repeats,
  ])

  const simPath = route
    ? `M ${HOME.x} ${HOME.y} L ${route.start.x} ${route.start.y} ${route.path.replace(/^\s*M/, 'L')} L ${HOME.x} ${HOME.y}`
    : ''
  const editHandles = useMemo(
    () => [
      ...(planMode === 'survey'
        ? surveyPoints.map((point, index) => ({ kind: 'area' as const, index, point }))
        : []),
      ...(planMode === 'survey'
        ? zones.flatMap((zone, zi) =>
            zone.map((point, index) => ({ kind: 'zone' as const, index, zone: zi, point })),
          )
        : []),
      ...(planMode === 'p2p'
        ? waypoints.map((point, index) => ({ kind: 'wp' as const, index, point }))
        : []),
      ...(planMode === 'orbit' && orbitCenter
        ? [{ kind: 'center' as const, index: 0, point: orbitCenter }]
        : []),
      ...(planMode === 'maneuver' && anchor
        ? [{ kind: 'anchor' as const, index: 0, point: anchor }]
        : []),
    ],
    [planMode, surveyPoints, zones, waypoints, orbitCenter, anchor],
  )
  const flightAreas = useMemo(
    () => [
      ...(planMode === 'survey' ? [{ points: surveyPoints, kind: 'area' as const }] : []),
      ...(planMode === 'survey' ? zones.map(points => ({ points, kind: 'zone' as const })) : []),
    ],
    [planMode, surveyPoints, zones],
  )
  const sim = useFlightSimulation({
    vehicleId: vehicleId ?? '',
    enabled: ready,
    pathKey: simPath,
    metersPerUnit: METERS_PER_UNIT,
    cruiseSpeed: speed,
    cruiseAltitude: altitude,
    transitUnits: route ? [distance(HOME, route.start), distance(route.end, HOME)] : [0, 0],
    batteryStart: vehicles.find(v => v.id === vehicleId)?.battery ?? 100,
    waypointCount: planMode === 'p2p' ? waypoints.length : 0,
  })
  // A plan that is being flown is read-only until the aircraft is back on the ground.
  const locked = isAirborne(sim.stage)

  const draft: PlannerDraft = {
    planMode,
    altitude,
    speed,
    overlap,
    spacing,
    returnAltitude,
    linkLoss,
    surveyPoints,
    boundaryComplete,
    zones,
    waypoints,
    orbitCenter,
    orbitRadius,
    orbitLaps,
    clockwise,
    pattern,
    anchor,
    patternSize,
    heading,
    repeats,
    activePreset,
    customSurvey,
  }
  const draftKey = JSON.stringify(draft)
  const [savedKey, setSavedKey] = useState(draftKey)
  const hydrated = useRef(false)
  const persist = useRef<() => void>(() => {})

  useEffect(() => {
    if (hydrated.current || !vehicleId || !missionsLoaded || missionsFetching) return
    hydrated.current = true
    const stored = missions.find(m => m.vehicleId === vehicleId && m.plan?.draft)?.plan?.draft
    if (stored) {
      setPlanMode(stored.planMode)
      setAltitude(stored.altitude)
      setSpeed(stored.speed)
      setOverlap(stored.overlap)
      setSpacing(stored.spacing)
      setReturnAltitude(stored.returnAltitude)
      setLinkLoss(stored.linkLoss)
      setSurveyPoints(stored.surveyPoints)
      setBoundaryComplete(stored.boundaryComplete)
      setZones(stored.zones)
      setWaypoints(stored.waypoints)
      setOrbitCenter(stored.orbitCenter)
      setOrbitRadius(stored.orbitRadius)
      setOrbitLaps(stored.orbitLaps)
      setClockwise(stored.clockwise)
      setPattern(stored.pattern)
      setAnchor(stored.anchor)
      setPatternSize(stored.patternSize)
      setHeading(stored.heading)
      setRepeats(stored.repeats)
      setActivePreset(stored.activePreset)
      setCustomSurvey(stored.customSurvey)
      setSavedKey(JSON.stringify(stored))
    }
    setReady(true)
  }, [missions, missionsLoaded, missionsFetching, vehicleId])

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
  }, [dispatch])

  useEffect(() => {
    if (vehicleId) dispatch(actions.selectVehicle(vehicleId))
  }, [dispatch, vehicleId])

  if (!vehicleId) {
    return (
      <div className="mission-select-page">
        <header className="mission-select-head">
          <div>
            <p>MISSION CONTROL</p>
            <h1>Select a vehicle</h1>
            <span>Choose one asset to view or create its individual mission plan.</span>
          </div>
          <div className="mission-select-summary">
            <b>{vehicles.filter(v => v.status !== 'offline').length}</b>
            <span>AVAILABLE ASSETS</span>
            <b>{missions.filter(m => m.status === 'executing').length}</b>
            <span>ACTIVE MISSIONS</span>
          </div>
        </header>
        {vehicles.length === 0 && (
          <div className="fleet-empty fleet-empty-inline">
            <h2>No vehicles yet</h2>
            <span>Add a vehicle in Fleet to start planning missions.</span>
            <Link className="primary" to="/">
              Go to Fleet
            </Link>
          </div>
        )}
        <div className="mission-search">
          <Search />
          <input placeholder="Search vehicle or mission…" />
          <span>SELECT ONE VEHICLE TO CONTINUE</span>
        </div>
        <div className="mission-vehicle-grid">
          {vehicles.map(vehicle => {
            const mission = missions.find(item => item.vehicleId === vehicle.id)
            return (
              <button
                key={vehicle.id}
                className="mission-vehicle-card"
                disabled={vehicle.status === 'offline'}
                onClick={() => {
                  dispatch(actions.selectVehicle(vehicle.id))
                  setStatus(mission?.status ?? 'ready')
                  navigate(`/missions/${vehicle.id}`)
                }}
              >
                <div className="mission-vehicle-top">
                  <span className="mission-domain-icon">
                    <TypeIcon type={vehicle.type} size={26} />
                  </span>
                  <span>
                    <b>{vehicle.name}</b>
                    <small>
                      {vehicle.id} · {vehicle.type}
                    </small>
                  </span>
                  <StatusBadge status={vehicle.status} />
                </div>
                <div className="mission-assignment">
                  <label>{mission ? 'ASSIGNED MISSION' : 'MISSION STATUS'}</label>
                  <strong>{mission?.name ?? 'No mission planned'}</strong>
                  <small>
                    {mission
                      ? `${mission.status.toUpperCase()} · ${mission.progress}% complete`
                      : 'Open workspace to create a route'}
                  </small>
                </div>
                <div className="mission-card-foot">
                  <BatteryMeter value={vehicle.battery} />
                  <span>
                    <Radio /> {vehicle.connection}
                  </span>
                  <ChevronRight />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const vehicle = vehicles.find(item => item.id === vehicleId)
  const mission = missions.find(item => item.vehicleId === vehicleId)
  if (!vehicle && fleetLoading) return null
  if (!vehicle) return <Navigate to={vehicles.length ? '/missions' : '/'} replace />
  const isUavPlanning = vehicle.type === 'UAV'
  const modeInfo = MODES.find(item => item.id === planMode) ?? MODES[0]
  const routeMeters = route ? route.length * METERS_PER_UNIT : 0
  const transitMeters = route
    ? (distance(HOME, route.start) + distance(route.end, HOME)) * METERS_PER_UNIT
    : 0
  const areaHa = (polygonArea(surveyPoints) * METERS_PER_UNIT ** 2) / 10000
  const flightMinutes = (routeMeters + transitMeters) / speed / 60
  const photos = Math.ceil(routeMeters / (altitude * 0.75 * (1 - overlap / 100)))
  const batteryUse = Math.round((flightMinutes / ENDURANCE_MIN) * 100)
  const markCustom = () => setActivePreset(current => ({ ...current, [planMode]: '' }))
  const planCheck = (): { detail: string; label: string } => {
    if (planMode === 'survey') {
      return {
        label: 'Survey area',
        detail: route ? `${areaHa.toFixed(1)} ha` : `${surveyPoints.length} of 3 points`,
      }
    }
    if (planMode === 'p2p') {
      return {
        label: 'Waypoints',
        detail: waypoints.length ? `${waypoints.length} placed` : 'Add at least one',
      }
    }
    if (planMode === 'orbit') {
      return {
        label: 'Orbit target',
        detail: orbitCenter ? `${orbitRadius} m radius · ${orbitLaps} laps` : 'Place the center',
      }
    }
    return {
      label: 'Maneuver anchor',
      detail: anchor ? `${patternSize} m · ${repeats} repeats` : 'Place the anchor',
    }
  }
  const checks: Array<{ label: string; detail: string; level: CheckLevel }> = [
    {
      ...planCheck(),
      level: route && (planMode !== 'survey' || boundaryComplete) ? 'pass' : 'fail',
    },
    ...(planMode === 'survey' && zones.length
      ? [
          {
            label: 'Exclusion zones',
            detail: drawingZone
              ? 'Drawing · live preview'
              : `${zones.length} zone${zones.length > 1 ? 's' : ''} · route avoids`,
            level: (drawingZone ? 'warn' : 'pass') as CheckLevel,
          },
        ]
      : []),
    {
      label: 'Battery',
      detail: route
        ? `${batteryUse}% + ${BATTERY_RESERVE}% reserve · ${vehicle.battery}% on board`
        : `${vehicle.battery}% on board`,
      level: !route || batteryUse + BATTERY_RESERVE <= vehicle.battery ? 'pass' : 'fail',
    },
    {
      label: 'Link',
      detail: `${vehicle.link}% signal`,
      level: vehicle.link >= 70 ? 'pass' : vehicle.link >= 40 ? 'warn' : 'fail',
    },
    {
      label: 'Vehicle health',
      detail: vehicle.health,
      level: vehicle.health === 'healthy' ? 'pass' : vehicle.health === 'warning' ? 'warn' : 'fail',
    },
    {
      label: 'Altitude',
      detail: `${altitude} m AGL · limit ${MAX_ALTITUDE} m`,
      level: altitude <= MAX_ALTITUDE ? 'pass' : 'warn',
    },
  ]
  const planBlocked = checks.some(check => check.level === 'fail')
  const dirty = draftKey !== savedKey
  const savedMission = missions.find(m => m.vehicleId === vehicleId && m.plan?.draft)
  const uploaded = !dirty && savedMission?.status === 'ready'
  const lifecycle = locked
    ? sim.stage === 'holding'
      ? 'holding'
      : 'in flight'
    : sim.stage === 'landed'
      ? 'landed'
      : sim.stage === 'aborted'
        ? 'aborted'
        : uploaded
          ? 'uploaded'
          : dirty
            ? 'draft'
            : 'saved'
  const savePlan = async () => {
    if (!hydrated.current || !vehicle || !isUavPlanning || draftKey === savedKey) return
    const flyable = route && !planBlocked
    await saveMissionPlan({
      name: modeInfo.title,
      vehicleId: vehicle.id,
      waypoints: flyable ? waypointsFromPathData(simPath, altitude) : [],
      plan: {
        draft,
        pathData: flyable ? simPath : '',
        mode: planMode,
        altitude,
        speed,
        transitMeters: flyable
          ? [
              distance(HOME, route.start) * METERS_PER_UNIT,
              distance(route.end, HOME) * METERS_PER_UNIT,
            ]
          : [0, 0],
      },
    }).unwrap()
    setSavedKey(draftKey)
  }
  persist.current = () => void savePlan()
  const summary: Array<[string, string]> = [
    [`${((routeMeters + transitMeters) / 1000).toFixed(1)} km`, 'ROUTE'],
    [formatDuration(flightMinutes), 'EST. TIME'],
    ...(planMode === 'survey'
      ? ([
          [`${photos}`, 'PHOTOS'],
          [`${areaHa.toFixed(1)} ha`, 'COVERAGE'],
        ] as Array<[string, string]>)
      : planMode === 'p2p'
        ? ([[`${waypoints.length}`, 'WAYPOINTS']] as Array<[string, string]>)
        : planMode === 'orbit'
          ? ([
              [`${orbitLaps}`, 'LAPS'],
              [`${orbitRadius} m`, 'RADIUS'],
            ] as Array<[string, string]>)
          : ([
              [`${repeats}`, 'REPEATS'],
              [`${patternSize} m`, 'SIZE'],
            ] as Array<[string, string]>)),
  ]
  const hint = (() => {
    if (planMode === 'survey') {
      if (!boundaryComplete) {
        return surveyPoints.length
          ? `${surveyPoints.length} POINTS · CONTINUE OR COMPLETE AREA`
          : 'CLICK MAP TO PLACE THE FIRST BOUNDARY POINT'
      }
      if (drawingZone) {
        const current = zones[zones.length - 1]?.length ?? 0
        return current
          ? `ZONE ${zones.length} · ${current} POINTS · CONTINUE OR COMPLETE ZONE`
          : `ZONE ${zones.length} · CLICK MAP TO PLACE THE FIRST EXCLUSION POINT`
      }
      return 'DRAG POINTS TO ADJUST THE SURVEY EDGE OR ZONE'
    }
    if (planMode === 'p2p') {
      return waypoints.length
        ? `${waypoints.length} WAYPOINTS · CLICK TO ADD · DRAG TO MOVE`
        : 'CLICK MAP TO PLACE THE FIRST WAYPOINT'
    }
    if (planMode === 'orbit') {
      return orbitCenter
        ? 'DRAG CENTER OR CLICK MAP TO MOVE TARGET'
        : 'CLICK MAP TO SET THE ORBIT CENTER'
    }
    return anchor
      ? 'DRAG ANCHOR OR CLICK MAP TO MOVE PATTERN'
      : 'CLICK MAP TO SET THE PATTERN ANCHOR'
  })()

  const stopZone = () => {
    setDrawingZone(false)
    setZones(list => list.filter(zone => zone.length >= 3))
  }
  const switchMode = (next: PlanMode) => {
    setPlanMode(next)
    stopZone()
  }
  const applySurveyPreset = (name: string) => {
    const preset = name === 'Custom plan' ? customSurvey : SURVEY_PRESETS[name]
    if (!preset) return
    setActivePreset(current => ({ ...current, survey: name }))
    setSurveyPoints(preset.points.map(point => ({ ...point })))
    setZones(preset.zones.map(zone => zone.map(point => ({ ...point }))))
    setDrawingZone(false)
    setSpacing(preset.spacing)
    setOverlap(preset.overlap)
    setBoundaryComplete(true)
  }
  const applyP2pPreset = (name: string) => {
    setActivePreset(current => ({ ...current, p2p: name }))
    setWaypoints(P2P_PRESETS[name].map(point => ({ ...point })))
  }
  const applyOrbitPreset = (name: string) => {
    const preset = ORBIT_PRESETS[name]
    setActivePreset(current => ({ ...current, orbit: name }))
    setOrbitCenter({ ...preset.center })
    setOrbitRadius(preset.radius)
    setOrbitLaps(preset.laps)
  }
  const applyManeuverPreset = (name: string) => {
    const preset = MANEUVER_PRESETS[name]
    setActivePreset(current => ({ ...current, maneuver: name }))
    setPattern(preset.pattern)
    setAnchor({ ...preset.anchor })
    setPatternSize(preset.size)
    setHeading(preset.heading)
    setRepeats(preset.repeats)
  }
  const addPointAt = (point: Point) => {
    if (planMode === 'survey') {
      if (!boundaryComplete) setSurveyPoints(points => [...points, point])
      else if (drawingZone) {
        setZones(list =>
          list.map((zone, index) =>
            index === list.length - 1 ? [...zone, clampToPolygon(point, surveyPoints)] : zone,
          ),
        )
      } else return
    } else if (planMode === 'p2p') setWaypoints(points => [...points, point])
    else if (planMode === 'orbit') setOrbitCenter(point)
    else setAnchor(point)
    markCustom()
  }
  const movePointTo = (target: DragTarget, next: Point) => {
    const replace = (points: Point[]) =>
      points.map((item, index) => (index === target.index ? next : item))
    if (target.kind === 'area') {
      const nextArea = replace(surveyPoints)
      setSurveyPoints(nextArea)
      setZones(list => list.map(zone => zone.map(point => clampToPolygon(point, nextArea))))
    } else if (target.kind === 'zone') {
      const clamped = clampToPolygon(next, surveyPoints)
      setZones(list =>
        list.map((zone, index) =>
          index === target.zone
            ? zone.map((point, i) => (i === target.index ? clamped : point))
            : zone,
        ),
      )
    } else if (target.kind === 'wp') setWaypoints(replace)
    else if (target.kind === 'center') setOrbitCenter(next)
    else setAnchor(next)
    markCustom()
  }
  const flightSection = (
    <PanelSection title="Flight">
      <MissionRange
        label="Altitude"
        value={altitude}
        min={30}
        max={300}
        unit="m AGL"
        onChange={setAltitude}
      />
      {planMode === 'survey' && (
        <MissionRange
          label="Front overlap"
          value={overlap}
          min={30}
          max={90}
          unit="%"
          onChange={setOverlap}
        />
      )}
      <MissionRange label="Speed" value={speed} min={2} max={20} unit="m/s" onChange={setSpeed} />
      {planMode === 'survey' && (
        <MissionRange
          label="Line spacing"
          value={spacing}
          min={8}
          max={40}
          unit="m"
          onChange={setSpacing}
        />
      )}
    </PanelSection>
  )

  const planFooter = (
    <footer className="mp-footer">
      {mission && !isUavPlanning ? (
        <div className="mp-row">
          <button
            className="mp-btn primary"
            onClick={() => setStatus(status === 'paused' ? 'executing' : 'paused')}
          >
            {status === 'paused' ? <Play /> : <Pause />}
            {status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button className="mp-btn danger" onClick={() => setStatus('aborted')}>
            <CircleStop /> Abort
          </button>
        </div>
      ) : (
        <>
          <button
            className="mp-btn primary block"
            disabled={
              isUavPlanning && (locked || planBlocked || !route || saving || uploading || uploaded)
            }
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
                ? 'Active mission on the aircraft'
                : 'Draft saved · not on the aircraft yet'}
          </small>
          {uploaded && (
            <Link className="mp-btn block" to={`/vehicles/${vehicle.id}`}>
              Open live flight
            </Link>
          )}
        </>
      )}
      <p>Simulation only · Commands are not connected to hardware.</p>
    </footer>
  )

  return (
    <div className={`mission-page${view3d ? ' view-3d' : ''}`} data-drag-host>
      <WorkspaceHeader
        vehicle={vehicle}
        active="plan"
        backTo="/missions"
        lifecycle={mission && !isUavPlanning ? status : lifecycle}
        link={vehicle.link}
        battery={vehicle.battery}
        extra={
          <span className="ws-context">
            {vehicle.type === 'UAV' ? modeInfo.title : (mission?.name ?? 'New mission plan')}
          </span>
        }
      />
      {isUavPlanning ? (
        <FlightView3D
          pathRef={simPathRef}
          pathKey={simPath}
          metersPerUnit={METERS_PER_UNIT}
          altitude={altitude}
          areas={flightAreas}
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
          rotors={
            sim.stage === 'standby' || sim.stage === 'landed' || sim.stage === 'aborted'
              ? 'off'
              : sim.stage === 'armed'
                ? 'idle'
                : 'run'
          }
        />
      ) : (
        <CommandMap vehicleIds={[vehicle.id]} showTacticalOverlays />
      )}
      <svg className="sim-path-source" aria-hidden width="0" height="0">
        <path ref={simPathRef} d={simPath} />
      </svg>
      {isUavPlanning && (
        <div className={`mission-edit-hint${locked ? ' locked' : ''}`}>
          <MousePointer2 />
          {locked ? 'Mission in progress · plan is locked until the aircraft lands' : hint}
        </div>
      )}
      {isUavPlanning && (
        <SimulationHud sim={sim} disabled={!route} view3d={view3d} onSetView={setView3d} />
      )}
      {isUavPlanning && <MapStatusStrip cursor={cursor} metersPerUnit={METERS_PER_UNIT} />}
      {isUavPlanning && (
        <div className="mission-home-chip">
          <HomeSourceChip />
        </div>
      )}
      {isUavPlanning && route && (
        <div className="mission-map-summary">
          {summary.map(([value, label]) => (
            <span key={label}>
              <b>{value}</b>
              {label}
            </span>
          ))}
          <span className={batteryUse + BATTERY_RESERVE > vehicle.battery ? 'over' : ''}>
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
          subtitle={`${vehicle.id} · ${isUavPlanning ? `${modeInfo.label} plan` : mission ? 'Active mission' : 'Plan'}`}
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
          {isUavPlanning && (
            <div className="mp-modes">
              {MODES.map(item => (
                <button
                  key={item.id}
                  className={planMode === item.id ? 'active' : ''}
                  onClick={() => switchMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          <div className={`mp-body${locked ? ' locked' : ''}`}>
            <dl className="mp-kv">
              <div>
                <dt>Mission</dt>
                <dd>
                  {isUavPlanning
                    ? dirty
                      ? 'Unsaved draft'
                      : `Saved · ${vehicle.id}`
                    : (mission?.id ?? 'Unsaved draft')}
                </dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{mission && !isUavPlanning ? status.toUpperCase() : 'PLANNING'}</dd>
              </div>
            </dl>
            {isUavPlanning ? (
              <>
                {planMode === 'survey' && (
                  <>
                    <PanelSection
                      title="Area"
                      meta={boundaryComplete ? `${surveyPoints.length} points` : 'Drawing'}
                    >
                      <div className="mp-row">
                        <button
                          className="mp-btn accent"
                          disabled={surveyPoints.length < 3 || boundaryComplete}
                          onClick={() => setBoundaryComplete(true)}
                        >
                          <Check /> Complete area
                        </button>
                        <button
                          className="mp-btn"
                          onClick={() => {
                            setSurveyPoints([])
                            setBoundaryComplete(false)
                            setZones([])
                            setDrawingZone(false)
                            markCustom()
                          }}
                        >
                          <RotateCcw /> Reset
                        </button>
                      </div>
                      <div className="mp-label">Presets</div>
                      <PresetChips
                        names={[
                          ...Object.keys(SURVEY_PRESETS),
                          ...(customSurvey ? ['Custom plan'] : []),
                        ]}
                        active={activePreset.survey}
                        onPick={applySurveyPreset}
                      />
                      <button
                        className="mp-btn ghost block"
                        disabled={!boundaryComplete}
                        onClick={() => {
                          setCustomSurvey({
                            points: surveyPoints.map(point => ({ ...point })),
                            zones: zones
                              .filter(zone => zone.length >= 3)
                              .map(zone => zone.map(point => ({ ...point }))),
                            spacing,
                            overlap,
                          })
                          setActivePreset(current => ({ ...current, survey: 'Custom plan' }))
                        }}
                      >
                        <Plus /> {customSurvey ? 'Update custom preset' : 'Save as preset'}
                      </button>
                    </PanelSection>
                    <PanelSection
                      title="Exclusion zones"
                      meta={
                        drawingZone ? 'Drawing' : zones.length ? `${zones.length} placed` : 'None'
                      }
                    >
                      <div className="mp-row">
                        {drawingZone ? (
                          <button
                            className="mp-btn accent"
                            disabled={(zones[zones.length - 1]?.length ?? 0) < 3}
                            onClick={stopZone}
                          >
                            <Check /> Complete zone
                          </button>
                        ) : (
                          <button
                            className="mp-btn accent"
                            disabled={!boundaryComplete}
                            onClick={() => {
                              setZones(list => [...list, []])
                              setDrawingZone(true)
                            }}
                          >
                            <Plus /> Add zone
                          </button>
                        )}
                        <button
                          className="mp-btn"
                          disabled={!zones.length}
                          onClick={() => {
                            setZones([])
                            setDrawingZone(false)
                            markCustom()
                          }}
                        >
                          <RotateCcw /> Clear all
                        </button>
                      </div>
                      {zones.length > 0 && (
                        <div className="mp-waypoints">
                          {zones.map((zone, zi) => (
                            <div key={zi}>
                              <span>X{zi + 1}</span>
                              <MapPin />
                              <p>
                                <b>Exclusion {String(zi + 1).padStart(2, '0')}</b>
                                <small>
                                  {zone.length} points
                                  {drawingZone && zi === zones.length - 1 ? ' · drawing' : ''}
                                </small>
                              </p>
                              <button
                                title="Remove zone"
                                onClick={() => {
                                  if (drawingZone && zi === zones.length - 1) setDrawingZone(false)
                                  setZones(list => list.filter((_, index) => index !== zi))
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
                        {boundaryComplete
                          ? 'Add as many zones as needed. Click the map to mark points; the route flies around every zone.'
                          : 'Complete the survey area first.'}
                      </p>
                    </PanelSection>
                  </>
                )}
                {planMode === 'p2p' && (
                  <PanelSection
                    title="Waypoints"
                    meta={waypoints.length ? `${waypoints.length} placed` : 'Empty'}
                  >
                    <div className="mp-row">
                      <button
                        className="mp-btn"
                        disabled={!waypoints.length}
                        onClick={() => {
                          setWaypoints(points => points.slice(0, -1))
                          markCustom()
                        }}
                      >
                        <RotateCcw /> Undo last
                      </button>
                      <button
                        className="mp-btn"
                        disabled={!waypoints.length}
                        onClick={() => {
                          setWaypoints([])
                          markCustom()
                        }}
                      >
                        <Trash2 /> Clear
                      </button>
                    </div>
                    <div className="mp-label">Presets</div>
                    <PresetChips
                      names={Object.keys(P2P_PRESETS)}
                      active={activePreset.p2p}
                      onPick={applyP2pPreset}
                    />
                    {waypoints.length > 0 && (
                      <div className="mp-waypoints">
                        {waypoints.map((point, index) => (
                          <div key={index}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <MapPin />
                            <p>
                              <b>Waypoint {index + 1}</b>
                              <small>
                                {Math.round((point.x - HOME.x) * METERS_PER_UNIT)} m E ·{' '}
                                {Math.round((HOME.y - point.y) * METERS_PER_UNIT)} m N · {altitude}{' '}
                                m
                              </small>
                            </p>
                            <button
                              title="Remove"
                              onClick={() => {
                                setWaypoints(points => points.filter((_, i) => i !== index))
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
                {planMode === 'orbit' && (
                  <PanelSection title="Target" meta={orbitCenter ? 'Placed' : 'Not placed'}>
                    <div className="mp-row">
                      <button
                        className="mp-btn"
                        disabled={!orbitCenter}
                        onClick={() => {
                          setOrbitCenter(null)
                          markCustom()
                        }}
                      >
                        <RotateCcw /> Reset
                      </button>
                    </div>
                    <div className="mp-label">Presets</div>
                    <PresetChips
                      names={Object.keys(ORBIT_PRESETS)}
                      active={activePreset.orbit}
                      onPick={applyOrbitPreset}
                    />
                    <MissionRange
                      label="Radius"
                      value={orbitRadius}
                      min={20}
                      max={150}
                      unit="m"
                      onChange={value => {
                        setOrbitRadius(value)
                        markCustom()
                      }}
                    />
                    <MissionRange
                      label="Laps"
                      value={orbitLaps}
                      min={1}
                      max={6}
                      unit=""
                      onChange={value => {
                        setOrbitLaps(value)
                        markCustom()
                      }}
                    />
                    <div className="mp-label">Direction</div>
                    <div className="mp-chips">
                      {[true, false].map(value => (
                        <button
                          key={String(value)}
                          className={clockwise === value ? 'active' : ''}
                          onClick={() => {
                            setClockwise(value)
                            markCustom()
                          }}
                        >
                          {value ? 'Clockwise' : 'Counter-clockwise'}
                        </button>
                      ))}
                    </div>
                  </PanelSection>
                )}
                {planMode === 'maneuver' && (
                  <PanelSection title="Maneuver" meta={anchor ? 'Placed' : 'Not placed'}>
                    <div className="mp-label">Pattern</div>
                    <div className="mp-chips">
                      {PATTERNS.map(item => (
                        <button
                          key={item.id}
                          className={pattern === item.id ? 'active' : ''}
                          onClick={() => {
                            setPattern(item.id)
                            markCustom()
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="mp-label">Presets</div>
                    <PresetChips
                      names={Object.keys(MANEUVER_PRESETS)}
                      active={activePreset.maneuver}
                      onPick={applyManeuverPreset}
                    />
                    <MissionRange
                      label="Size"
                      value={patternSize}
                      min={40}
                      max={250}
                      unit="m"
                      onChange={value => {
                        setPatternSize(value)
                        markCustom()
                      }}
                    />
                    <MissionRange
                      label="Heading"
                      value={heading}
                      min={-90}
                      max={90}
                      unit="°"
                      onChange={value => {
                        setHeading(value)
                        markCustom()
                      }}
                    />
                    <MissionRange
                      label="Repeats"
                      value={repeats}
                      min={1}
                      max={6}
                      unit=""
                      onChange={value => {
                        setRepeats(value)
                        markCustom()
                      }}
                    />
                    <button
                      className="mp-btn block"
                      disabled={!anchor}
                      onClick={() => {
                        setAnchor(null)
                        markCustom()
                      }}
                    >
                      <RotateCcw /> Reset anchor
                    </button>
                  </PanelSection>
                )}
              </>
            ) : (
              <PanelSection
                title="Waypoints"
                action={
                  <button
                    className="mp-btn small"
                    onClick={() => setWps(w => [...w, w.length + 1])}
                  >
                    <Plus /> Add
                  </button>
                }
              >
                <div className="mp-waypoints">
                  {wps.map((x, i) => (
                    <div key={x}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <MapPin />
                      <p>
                        <b>{i === wps.length - 1 ? 'Return corridor' : `Waypoint ${i + 1}`}</b>
                        <small>
                          23.78{i}° N · 90.4{i + 2}° E · {120 + i * 20} m
                        </small>
                      </p>
                      <button title="Remove" onClick={() => setWps(w => w.filter(y => y !== x))}>
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
              </PanelSection>
            )}
            {mission && (
              <PanelSection title="Progress" meta={`${mission.progress}%`}>
                <div className="mp-progress">
                  <i>
                    <b style={{ width: `${mission.progress}%` }} />
                  </i>
                  <small>Waypoint 4 of 7 · ETA 06:42</small>
                </div>
              </PanelSection>
            )}
          </div>
          {!isUavPlanning && planFooter}
        </FloatingPanel>
        {isUavPlanning && (
          <FloatingPanel
            id="flight"
            className="plan-panel"
            icon={<Gauge />}
            title="Flight & failsafe"
            subtitle={`${altitude} m AGL · ${speed} m/s · RTL ${returnAltitude} m`}
            defaultOpen={false}
          >
            <div className={`mp-body${locked ? ' locked' : ''}`}>
              {flightSection}
              <PanelSection title="Failsafe">
                <MissionRange
                  label="Return altitude"
                  value={returnAltitude}
                  min={30}
                  max={150}
                  unit="m AGL"
                  onChange={setReturnAltitude}
                />
                <div className="mp-label">On link loss</div>
                <div className="mp-chips">
                  {LINK_LOSS_ACTIONS.map(action => (
                    <button
                      key={action}
                      className={linkLoss === action ? 'active' : ''}
                      onClick={() => setLinkLoss(action)}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </PanelSection>
            </div>
          </FloatingPanel>
        )}
        {isUavPlanning && (
          <FloatingPanel
            id="preflight"
            className="plan-panel"
            icon={<ShieldCheck />}
            title="Pre-flight & upload"
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
                title="Pre-flight checks"
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
        )}
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
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
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
