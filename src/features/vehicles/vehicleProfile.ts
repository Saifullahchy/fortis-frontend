import type {
  PlanGeometry,
  PlanMode,
  PlannerDraft,
  Vehicle,
  VehicleDomain,
  VehicleType,
} from '../../types/domain'
import type { BadgeTone } from '../../components/common'
import type { MissionStage, TelemetryFrame } from '../pages/missionSimulator'
import { terrainHeight } from '../pages/missionSimulator'
import type { Pattern, Point, Route } from '../pages/missionGeometry'
import type { ModelKind } from '../pages/vehicleModels'
import type { StreetLeg } from '../map/streetNetwork'

/**
 * Everything that differs between vehicle classes, in one place: vocabulary, commands, plan
 * modes, parameters, limits, checks, alerts and instruments. The planner and the live workspace
 * are written once against this shape; adding a class means adding a profile, not a page.
 */

export type CheckLevel = 'pass' | 'warn' | 'fail'
export interface PlanCheck {
  label: string
  detail: string
  level: CheckLevel
}
export interface LiveAlert {
  level: 'warn' | 'critical'
  text: string
}
export interface ParamSpec {
  id: string
  label: string
  min: number
  max: number
  step?: number
  unit: string
  default: number
  group: 'primary' | 'failsafe'
  /** Only shown for these plan modes; every mode when omitted. */
  modes?: PlanMode[]
}
export interface PlanModeSpec {
  id: PlanMode
  label: string
  title: string
  geometry: PlanGeometry
  /** Points form a closed loop driven `repeats` times. */
  closed?: boolean
  /** Points are targets reached along the street network, not straight-line waypoints. */
  street?: boolean
}
export interface AreaPreset {
  points: Point[]
  zones: Point[][]
  spacing: number
  overlap: number
}
export interface Presets {
  area: Record<string, AreaPreset>
  points: Record<string, Point[]>
  loop: Record<string, Point[]>
  orbit: Record<string, { center: Point; radius: number; laps: number }>
  maneuver: Record<
    string,
    { pattern: Pattern; anchor: Point; size: number; heading: number; repeats: number }
  >
}
export type CommandKey = 'arm' | 'launch' | 'hold' | 'resume' | 'return' | 'stop' | 'abort'

export interface PlanContext {
  draft: PlannerDraft
  mode: PlanModeSpec
  vehicle: Vehicle
  route: Route | null
  /** Route and transit lengths, metres. */
  routeMeters: number
  transitMeters: number
  areaHa: number
  minutes: number
  batteryUse: number
  drawingZone: boolean
  /** Points along the route in screen units, for terrain checks. */
  samples: Point[]
  metersPerUnit: number
  stops: number
  /** Ground coverage result: how the area is being swept and what it runs into. */
  coverage?: {
    style: 'streets' | 'field'
    streetMeters: number
    coveredMeters: number
    segments: number
    buildings: number
    /** Share of the area taken up by building footprints, 0–1. */
    builtFraction: number
    dataStatus: 'idle' | 'loading' | 'ready' | 'error'
  }
  /** Street routing result, when the mode routes along streets. */
  street?: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    error?: string
    legs: StreetLeg[]
    onStreetFraction: number
    roads: number
    buildings: number
  }
}
export interface LiveContext {
  frame: TelemetryFrame
  stage: MissionStage
  plan: { name: string; altitude: number; speed: number } | null
  limits: { maxAltitude: number; maxSpeed: number }
  newerDraft: boolean
}
export type StripIcon =
  'speed' | 'altitude' | 'time' | 'gps' | 'camera' | 'grade' | 'odometer' | 'elevation'
export interface StripItem {
  icon: StripIcon
  label: string
  value: string
}

export interface VehicleProfile {
  type: VehicleType
  domain: VehicleDomain
  /** Has a live operations workspace (3D view, commands). */
  live: boolean
  model: ModelKind
  instruments: 'attitude' | 'inclinometer'
  payload: 'camera' | 'lidar' | 'sonar'
  teleop: boolean
  /**
   * Moves on a surface: routes steer around obstacles, round corners to the turning radius and
   * stop at waypoints, instead of flying straight lines over everything.
   */
  surfaceBound: boolean
  /** Can route along a street network with map-derived obstacles (needs map data). */
  streetRouting: boolean
  words: {
    craft: string
    liveTab: string
    planLocked: string
    preCheck: string
    checksTitle: string
    paramsPanel: string
    primaryGroup: string
    playTitle: string
    onCraft: string
    openLive: string
    commandsLabel: string
    timeLabel: string
  }
  stages: Record<MissionStage, string>
  commands: Record<CommandKey, string>
  modes: PlanModeSpec[]
  parameters: ParamSpec[]
  linkLossActions: string[]
  limits: {
    maxSpeed: number
    maxAltitude?: number
    maxGrade?: number
    enduranceMin: number
    batteryReserve: number
  }
  presets: Presets
  /** Parameter that sets the dwell time at each stop, when the class stops at waypoints. */
  dwellParam?: string
  checks: (ctx: PlanContext) => PlanCheck[]
  summary: (ctx: PlanContext) => Array<[string, string]>
  alerts: (ctx: LiveContext) => LiveAlert[]
  strip: (frame: TelemetryFrame) => StripItem[]
  hudTitle: (frame: TelemetryFrame, callsign: string) => string
}

export const stageTone = (stage: MissionStage): BadgeTone =>
  stage === 'active' || stage === 'returning'
    ? 'ok'
    : stage === 'armed' || stage === 'holding' || stage === 'manual'
      ? 'warn'
      : stage === 'aborted'
        ? 'bad'
        : 'muted'

// ---- shared presets (screen units around the demo sector) ---------------------------------------

const AREA_PRESETS: Record<string, AreaPreset> = {
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
const GROUND_AREA_PRESETS: Record<string, AreaPreset> = {
  'Yard sweep': {
    points: [
      { x: 180, y: 380 },
      { x: 420, y: 360 },
      { x: 440, y: 560 },
      { x: 200, y: 590 },
    ],
    zones: [
      [
        { x: 290, y: 440 },
        { x: 350, y: 430 },
        { x: 355, y: 490 },
        { x: 295, y: 500 },
      ],
    ],
    spacing: 4,
    overlap: 0,
  },
  'Field pass': {
    points: [
      { x: 150, y: 150 },
      { x: 520, y: 130 },
      { x: 540, y: 420 },
      { x: 170, y: 450 },
    ],
    zones: [],
    spacing: 6,
    overlap: 0,
  },
}
const POINT_PRESETS: Record<string, Point[]> = {
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
const GROUND_POINT_PRESETS: Record<string, Point[]> = {
  'Gate check': [
    { x: 260, y: 520 },
    { x: 420, y: 470 },
  ],
  'Service road': [
    { x: 200, y: 560 },
    { x: 330, y: 400 },
    { x: 520, y: 380 },
    { x: 640, y: 250 },
  ],
  'Depot loop': [
    { x: 180, y: 480 },
    { x: 420, y: 440 },
    { x: 460, y: 600 },
  ],
}
const LOOP_PRESETS: Record<string, Point[]> = {
  Perimeter: [
    { x: 150, y: 160 },
    { x: 560, y: 140 },
    { x: 600, y: 540 },
    { x: 170, y: 580 },
  ],
  Compound: [
    { x: 240, y: 300 },
    { x: 480, y: 290 },
    { x: 500, y: 480 },
    { x: 250, y: 500 },
  ],
  'Fence line': [
    { x: 120, y: 420 },
    { x: 420, y: 160 },
    { x: 700, y: 300 },
  ],
}
const ORBIT_PRESETS: Presets['orbit'] = {
  'Close orbit': { center: { x: 480, y: 330 }, radius: 40, laps: 3 },
  'Standoff ring': { center: { x: 500, y: 320 }, radius: 80, laps: 2 },
  'Wide ring': { center: { x: 520, y: 340 }, radius: 130, laps: 1 },
}
const MANEUVER_PRESETS: Presets['maneuver'] = {
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
const NO_PRESETS = {}

// ---- shared check helpers -----------------------------------------------------------------------

function geometryCheck(ctx: PlanContext): PlanCheck {
  const { draft, mode, route, areaHa } = ctx
  const geometry = mode.geometry
  if (geometry === 'area')
    return {
      label: `${mode.label} area`,
      detail: route ? `${areaHa.toFixed(1)} ha` : `${draft.surveyPoints.length} of 3 points`,
      level: route && draft.boundaryComplete ? 'pass' : 'fail',
    }
  if (geometry === 'points')
    return {
      label: mode.street ? 'Targets' : 'Waypoints',
      detail: draft.waypoints.length
        ? `${draft.waypoints.length} placed${mode.closed ? ` · ${draft.repeats} laps` : ''}`
        : mode.closed
          ? 'Add at least two'
          : 'Add at least one',
      level: route ? 'pass' : 'fail',
    }
  if (geometry === 'orbit')
    return {
      label: 'Orbit target',
      detail: draft.orbitCenter
        ? `${draft.orbitRadius} m radius · ${draft.orbitLaps} laps`
        : 'Place the center',
      level: route ? 'pass' : 'fail',
    }
  return {
    label: 'Maneuver anchor',
    detail: draft.anchor ? `${draft.patternSize} m · ${draft.repeats} repeats` : 'Place the anchor',
    level: route ? 'pass' : 'fail',
  }
}

function zoneCheck(ctx: PlanContext): PlanCheck[] {
  if (!ctx.draft.zones.length) return []
  const n = ctx.draft.zones.length
  const obstacles = ctx.mode.geometry !== 'area'
  const noun = obstacles ? 'obstacle' : 'zone'
  return [
    {
      label: obstacles ? 'Obstacles' : 'Exclusion zones',
      detail: ctx.drawingZone
        ? 'Drawing · live preview'
        : `${n} ${noun}${n > 1 ? 's' : ''} · route ${obstacles ? 'detours' : 'avoids'}`,
      level: ctx.drawingZone ? 'warn' : 'pass',
    },
  ]
}

function streetChecks(ctx: PlanContext): PlanCheck[] {
  const st = ctx.street
  if (!ctx.mode.street || !st) return []
  const data: PlanCheck =
    st.status === 'ready'
      ? {
          label: 'Street data',
          detail: `${st.roads} streets · ${st.buildings} buildings detected`,
          level: st.roads ? 'pass' : 'fail',
        }
      : st.status === 'error'
        ? {
            label: 'Street data',
            detail: `${st.error ?? 'Unavailable'} · routing overland around drawn obstacles`,
            level: 'warn',
          }
        : { label: 'Street data', detail: 'Loading map data · direct route for now', level: 'warn' }
  const bad = st.legs.filter(l => !l.reachable && l.index >= 0)
  const reach: PlanCheck[] =
    ctx.draft.waypoints.length && st.legs.length
      ? [
          {
            label: 'Targets reachable',
            detail: bad.length
              ? bad
                  .map(
                    l =>
                      `T${l.index + 1} ${l.reason?.toLowerCase() ?? ''} (${Math.round(l.offStreetMeters)} m)`,
                  )
                  .join(' · ')
              : `${Math.round(st.onStreetFraction * 100)}% on street · approach ≤ ${ctx.draft.street.approachMeters} m`,
            level: bad.length ? 'fail' : 'pass',
          },
        ]
      : []
  return [data, ...reach]
}

function coverageChecks(ctx: PlanContext): PlanCheck[] {
  const cv = ctx.coverage
  if (ctx.mode.geometry !== 'area' || !cv) return []
  if (cv.dataStatus === 'loading' && !cv.streetMeters)
    return [{ label: 'Map data', detail: 'Loading streets and buildings…', level: 'warn' }]
  if (cv.style === 'streets') {
    const share = cv.streetMeters ? cv.coveredMeters / cv.streetMeters : 0
    return [
      {
        label: 'Street sweep',
        detail: `${cv.segments} segments · ${Math.round(cv.streetMeters)} m of street · ${Math.round(share * 100)}% reachable`,
        level: share >= 0.95 ? 'pass' : share >= 0.6 ? 'warn' : 'fail',
      },
      {
        label: 'Map obstacles',
        detail: `${cv.buildings} buildings in the area · route stays on streets`,
        level: 'pass',
      },
    ]
  }
  return [
    {
      label: 'Map obstacles',
      detail: cv.buildings
        ? `${cv.buildings} buildings clipped out · ${Math.round(cv.builtFraction * 100)}% of area built up`
        : 'No buildings in the area',
      level: cv.builtFraction > 0.5 ? 'warn' : 'pass',
    },
  ]
}

function vehicleChecks(ctx: PlanContext, reserve: number): PlanCheck[] {
  const { vehicle, route, batteryUse } = ctx
  return [
    {
      label: 'Battery',
      detail: route
        ? `${batteryUse}% + ${reserve}% reserve · ${vehicle.battery}% on board`
        : `${vehicle.battery}% on board`,
      level: !route || batteryUse + reserve <= vehicle.battery ? 'pass' : 'fail',
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
  ]
}

/** Steepest slope along the planned route, percent, from the synthetic terrain. */
function maxGradeAlong(samples: Point[], metersPerUnit: number) {
  let max = 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    const ds = Math.hypot(b.x - a.x, b.y - a.y) * metersPerUnit
    if (ds < 0.5) continue
    const dh = terrainHeight(b, metersPerUnit) - terrainHeight(a, metersPerUnit)
    max = Math.max(max, Math.abs(dh / ds) * 100)
  }
  return Math.round(max * 10) / 10
}

function powerAndLinkAlerts(frame: TelemetryFrame, stopWord: string): LiveAlert[] {
  const list: LiveAlert[] = []
  if (frame.battery < 20)
    list.push({ level: 'critical', text: `Battery critical · ${stopWord} now` })
  else if (frame.battery < 30) list.push({ level: 'warn', text: 'Battery low · plan return' })
  if (frame.link < 50) list.push({ level: 'critical', text: 'Link degraded · failsafe armed' })
  else if (frame.link < 65) list.push({ level: 'warn', text: 'Link weak' })
  return list
}

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

// ---- profiles -----------------------------------------------------------------------------------

const UAV: VehicleProfile = {
  type: 'UAV',
  domain: 'air',
  live: true,
  model: 'quadcopter',
  instruments: 'attitude',
  payload: 'camera',
  teleop: false,
  surfaceBound: false,
  streetRouting: false,
  words: {
    craft: 'aircraft',
    liveTab: 'Live flight',
    planLocked: 'Mission in progress · plan is locked until the aircraft lands',
    preCheck: 'Pre-flight & upload',
    checksTitle: 'Pre-flight checks',
    paramsPanel: 'Flight & failsafe',
    primaryGroup: 'Flight',
    playTitle: 'Fly planned route',
    onCraft: 'Active mission on the aircraft',
    openLive: 'Open live flight',
    commandsLabel: 'FLIGHT COMMANDS',
    timeLabel: 'FLIGHT TIME',
  },
  stages: {
    standby: 'STANDBY',
    armed: 'ARMED',
    active: 'IN FLIGHT',
    holding: 'HOLDING',
    manual: 'MANUAL',
    returning: 'RTL',
    complete: 'LANDED',
    aborted: 'ABORTED',
  },
  commands: {
    arm: 'ARM',
    launch: 'TAKEOFF',
    hold: 'HOLD',
    resume: 'RESUME',
    return: 'RTL',
    stop: 'LAND',
    abort: 'ABORT',
  },
  modes: [
    { id: 'survey', label: 'Survey', title: 'New survey mission', geometry: 'area' },
    { id: 'p2p', label: 'P2P', title: 'New point-to-point mission', geometry: 'points' },
    { id: 'orbit', label: 'Encircle', title: 'New encirclement mission', geometry: 'orbit' },
    { id: 'maneuver', label: 'Maneuver', title: 'New maneuver mission', geometry: 'maneuver' },
  ],
  parameters: [
    {
      id: 'altitude',
      label: 'Altitude',
      min: 30,
      max: 300,
      unit: 'm AGL',
      default: 120,
      group: 'primary',
    },
    {
      id: 'overlap',
      label: 'Front overlap',
      min: 30,
      max: 90,
      unit: '%',
      default: 72,
      group: 'primary',
      modes: ['survey'],
    },
    { id: 'speed', label: 'Speed', min: 2, max: 20, unit: 'm/s', default: 12, group: 'primary' },
    {
      id: 'spacing',
      label: 'Line spacing',
      min: 8,
      max: 40,
      unit: 'm',
      default: 18,
      group: 'primary',
      modes: ['survey'],
    },
    {
      id: 'returnAltitude',
      label: 'Return altitude',
      min: 30,
      max: 150,
      unit: 'm AGL',
      default: 80,
      group: 'failsafe',
    },
  ],
  linkLossActions: ['Return home', 'Hold', 'Land'],
  limits: { maxSpeed: 20, maxAltitude: 120, enduranceMin: 35, batteryReserve: 25 },
  presets: {
    area: AREA_PRESETS,
    points: POINT_PRESETS,
    loop: NO_PRESETS,
    orbit: ORBIT_PRESETS,
    maneuver: MANEUVER_PRESETS,
  },
  checks: ctx => [
    geometryCheck(ctx),
    ...zoneCheck(ctx),
    ...vehicleChecks(ctx, UAV.limits.batteryReserve),
    {
      label: 'Altitude',
      detail: `${ctx.draft.params.altitude} m AGL · limit ${UAV.limits.maxAltitude} m`,
      level: ctx.draft.params.altitude <= (UAV.limits.maxAltitude ?? Infinity) ? 'pass' : 'warn',
    },
  ],
  summary: ctx => {
    const { draft, mode, routeMeters } = ctx
    const p = draft.params
    const photos = Math.ceil(routeMeters / (p.altitude * 0.75 * (1 - p.overlap / 100)))
    return mode.geometry === 'area'
      ? [
          [`${photos}`, 'PHOTOS'],
          [`${ctx.areaHa.toFixed(1)} ha`, 'COVERAGE'],
        ]
      : mode.geometry === 'points'
        ? [[`${draft.waypoints.length}`, 'WAYPOINTS']]
        : mode.geometry === 'orbit'
          ? [
              [`${draft.orbitLaps}`, 'LAPS'],
              [`${draft.orbitRadius} m`, 'RADIUS'],
            ]
          : [
              [`${draft.repeats}`, 'REPEATS'],
              [`${draft.patternSize} m`, 'SIZE'],
            ]
  },
  alerts: ({ frame, stage, plan, limits, newerDraft }) => {
    const list = powerAndLinkAlerts(frame, 'land')
    if (plan && plan.altitude > limits.maxAltitude)
      list.push({
        level: 'warn',
        text: `Plan altitude ${plan.altitude} m exceeds ${limits.maxAltitude} m limit`,
      })
    if (plan && plan.speed > limits.maxSpeed)
      list.push({
        level: 'warn',
        text: `Plan speed ${plan.speed} m/s exceeds ${limits.maxSpeed} m/s limit`,
      })
    if (newerDraft && plan)
      list.push({ level: 'warn', text: 'Newer plan draft not uploaded · flying previous version' })
    if (stage === 'aborted')
      list.push({ level: 'critical', text: 'Mission aborted · motors stopped' })
    return list
  },
  strip: frame => [
    { icon: 'speed', label: 'GROUND SPEED', value: `${frame.groundSpeed.toFixed(0)} m/s` },
    { icon: 'altitude', label: 'ALTITUDE', value: `${Math.round(frame.altitude)} m` },
    { icon: 'time', label: 'FLIGHT TIME', value: clock(frame.elapsedSeconds) },
    { icon: 'gps', label: 'GPS', value: `RTK FIX · ${frame.satellites}` },
    { icon: 'camera', label: 'CAPTURED', value: `${Math.floor(frame.distance / 12)} frames` },
  ],
  hudTitle: (frame, callsign) =>
    [
      callsign,
      `${Math.round(frame.altitude * 3.28084)} ft`,
      frame.groundSpeed > 0 ? `${Math.round(frame.groundSpeed * 1.944)} kts` : '',
    ]
      .filter(Boolean)
      .join(' · '),
}

const groundStages: Record<MissionStage, string> = {
  standby: 'STANDBY',
  armed: 'READY',
  active: 'DRIVING',
  holding: 'PAUSED',
  manual: 'MANUAL',
  returning: 'RETURNING',
  complete: 'PARKED',
  aborted: 'E-STOP',
}

const UGV: VehicleProfile = {
  type: 'UGV',
  domain: 'ground',
  live: true,
  model: 'rover',
  instruments: 'inclinometer',
  payload: 'lidar',
  teleop: true,
  surfaceBound: true,
  streetRouting: true,
  words: {
    craft: 'rover',
    liveTab: 'Live drive',
    planLocked: 'Mission in progress · plan is locked until the rover parks',
    preCheck: 'Pre-drive & upload',
    checksTitle: 'Pre-drive checks',
    paramsPanel: 'Drive & failsafe',
    primaryGroup: 'Drive',
    playTitle: 'Drive planned route',
    onCraft: 'Active mission on the rover',
    openLive: 'Open live drive',
    commandsLabel: 'DRIVE COMMANDS',
    timeLabel: 'DRIVE TIME',
  },
  stages: groundStages,
  commands: {
    arm: 'ENABLE',
    launch: 'START',
    hold: 'PAUSE',
    resume: 'RESUME',
    return: 'TO BASE',
    stop: 'PARK',
    abort: 'E-STOP',
  },
  modes: [
    {
      id: 'street',
      label: 'Street',
      title: 'New street mission',
      geometry: 'points',
      street: true,
    },
    { id: 'route', label: 'Route', title: 'New route mission', geometry: 'points' },
    {
      id: 'patrol',
      label: 'Patrol',
      title: 'New patrol mission',
      geometry: 'points',
      closed: true,
    },
    { id: 'coverage', label: 'Coverage', title: 'New coverage mission', geometry: 'area' },
  ],
  parameters: [
    {
      id: 'speed',
      label: 'Cruise speed',
      min: 0.5,
      max: 8,
      step: 0.5,
      unit: 'm/s',
      default: 3,
      group: 'primary',
    },
    {
      id: 'spacing',
      label: 'Swath spacing',
      min: 3,
      max: 12,
      unit: 'm',
      default: 4,
      group: 'primary',
      modes: ['coverage'],
    },
    {
      id: 'dwell',
      label: 'Dwell at waypoint',
      min: 0,
      max: 60,
      unit: 's',
      default: 5,
      group: 'primary',
      modes: ['street', 'route', 'patrol'],
    },
    {
      id: 'acceptRadius',
      label: 'Acceptance radius',
      min: 0.5,
      max: 5,
      step: 0.5,
      unit: 'm',
      default: 1.5,
      group: 'primary',
    },
    {
      id: 'turnRadius',
      label: 'Turning radius',
      min: 1,
      max: 8,
      step: 0.5,
      unit: 'm',
      default: 2.5,
      group: 'primary',
      modes: ['street', 'route', 'patrol'],
    },
    {
      id: 'clearance',
      label: 'Obstacle clearance',
      min: 0.5,
      max: 6,
      step: 0.5,
      unit: 'm',
      default: 1.5,
      group: 'primary',
      modes: ['street', 'route', 'patrol'],
    },
    {
      id: 'maxGrade',
      label: 'Grade limit',
      min: 5,
      max: 35,
      unit: '%',
      default: 20,
      group: 'failsafe',
    },
  ],
  linkLossActions: ['Stop', 'Return to base', 'Continue'],
  limits: { maxSpeed: 8, maxGrade: 25, enduranceMin: 180, batteryReserve: 20 },
  presets: {
    area: GROUND_AREA_PRESETS,
    points: GROUND_POINT_PRESETS,
    loop: LOOP_PRESETS,
    orbit: NO_PRESETS,
    maneuver: NO_PRESETS,
  },
  dwellParam: 'dwell',
  checks: ctx => {
    const grade = maxGradeAlong(ctx.samples, ctx.metersPerUnit)
    const limit = ctx.draft.params.maxGrade
    return [
      geometryCheck(ctx),
      ...streetChecks(ctx),
      ...coverageChecks(ctx),
      ...zoneCheck(ctx),
      ...vehicleChecks(ctx, UGV.limits.batteryReserve),
      {
        label: 'Terrain grade',
        detail: ctx.route ? `${grade}% steepest · limit ${limit}%` : `limit ${limit}%`,
        level: !ctx.route || grade <= limit ? 'pass' : grade <= limit + 5 ? 'warn' : 'fail',
      },
      {
        label: 'Speed',
        detail: `${ctx.draft.params.speed} m/s · limit ${UGV.limits.maxSpeed} m/s`,
        level: ctx.draft.params.speed <= UGV.limits.maxSpeed ? 'pass' : 'warn',
      },
    ]
  },
  summary: ctx => {
    const { draft, mode } = ctx
    const grade = maxGradeAlong(ctx.samples, ctx.metersPerUnit)
    if (mode.street)
      return [
        [`${draft.waypoints.length}`, 'TARGETS'],
        [`${Math.round((ctx.street?.onStreetFraction ?? 0) * 100)}%`, 'ON STREET'],
        [`${ctx.street?.buildings ?? 0}`, 'BUILDINGS'],
        [`${grade}%`, 'MAX GRADE'],
      ]
    if (mode.geometry === 'area' && ctx.coverage?.style === 'streets')
      return [
        [`${(ctx.coverage.streetMeters / 1000).toFixed(2)} km`, 'STREETS'],
        [
          `${Math.round((ctx.coverage.coveredMeters / Math.max(ctx.coverage.streetMeters, 1)) * 100)}%`,
          'SWEPT',
        ],
        [`${ctx.coverage.buildings}`, 'BUILDINGS'],
        [`${grade}%`, 'MAX GRADE'],
      ]
    return mode.geometry === 'area'
      ? [
          [`${ctx.areaHa.toFixed(1)} ha`, 'COVERAGE'],
          ...(ctx.coverage ? [[`${ctx.coverage.buildings}`, 'BUILDINGS'] as [string, string]] : []),
          [`${grade}%`, 'MAX GRADE'],
        ]
      : [
          [`${draft.waypoints.length}`, 'WAYPOINTS'],
          ...(mode.closed ? [[`${draft.repeats}`, 'LAPS'] as [string, string]] : []),
          [`${ctx.stops}`, 'STOPS'],
          [`${grade}%`, 'MAX GRADE'],
        ]
  },
  alerts: ({ frame, stage, plan, limits, newerDraft }) => {
    const list = powerAndLinkAlerts(frame, 'park')
    const g = frame.ground
    if (g && Math.abs(frame.roll) > 28)
      list.push({
        level: 'critical',
        text: `Roll ${Math.abs(frame.roll).toFixed(0)}° · rollover risk`,
      })
    else if (g && Math.abs(frame.roll) > 18)
      list.push({ level: 'warn', text: `Roll ${Math.abs(frame.roll).toFixed(0)}° · side slope` })
    if (g && Math.abs(g.grade) > (UGV.limits.maxGrade ?? 25))
      list.push({ level: 'warn', text: `Grade ${Math.abs(g.grade).toFixed(0)}% exceeds limit` })
    if (g && g.driveMode === 'manual' && g.crossTrack > 5)
      list.push({
        level: 'warn',
        text: `Off route by ${g.crossTrack.toFixed(0)} m · manual control`,
      })
    if (plan && plan.speed > limits.maxSpeed)
      list.push({
        level: 'warn',
        text: `Plan speed ${plan.speed} m/s exceeds ${limits.maxSpeed} m/s limit`,
      })
    if (newerDraft && plan)
      list.push({ level: 'warn', text: 'Newer plan draft not uploaded · driving previous version' })
    if (stage === 'aborted')
      list.push({ level: 'critical', text: 'E-stop engaged · drives disabled' })
    return list
  },
  strip: frame => [
    { icon: 'speed', label: 'SPEED', value: `${frame.groundSpeed.toFixed(1)} m/s` },
    { icon: 'grade', label: 'GRADE', value: `${(frame.ground?.grade ?? 0).toFixed(0)}%` },
    { icon: 'time', label: 'DRIVE TIME', value: clock(frame.elapsedSeconds) },
    { icon: 'gps', label: 'GPS', value: `RTK FIX · ${frame.satellites}` },
    { icon: 'odometer', label: 'ODOMETER', value: `${(frame.distance / 1000).toFixed(2)} km` },
  ],
  hudTitle: (frame, callsign) =>
    [
      callsign,
      `${(frame.groundSpeed * 3.6).toFixed(0)} km/h`,
      frame.ground ? `${frame.ground.grade >= 0 ? '+' : ''}${frame.ground.grade.toFixed(0)}%` : '',
    ]
      .filter(Boolean)
      .join(' · '),
}

const USV: VehicleProfile = {
  ...UGV,
  type: 'USV',
  domain: 'surface',
  model: 'boat',
  instruments: 'attitude',
  payload: 'sonar',
  teleop: true,
  surfaceBound: true,
  streetRouting: false,
  words: {
    craft: 'vessel',
    liveTab: 'Live helm',
    planLocked: 'Mission in progress · plan is locked until the vessel moors',
    preCheck: 'Pre-sail & upload',
    checksTitle: 'Pre-sail checks',
    paramsPanel: 'Helm & failsafe',
    primaryGroup: 'Helm',
    playTitle: 'Sail planned route',
    onCraft: 'Active mission on the vessel',
    openLive: 'Open live helm',
    commandsLabel: 'HELM COMMANDS',
    timeLabel: 'UNDER WAY',
  },
  stages: { ...groundStages, active: 'UNDER WAY', holding: 'HOLDING', complete: 'MOORED' },
  commands: { ...UGV.commands, hold: 'HOLD', stop: 'MOOR' },
  parameters: [
    {
      id: 'speed',
      label: 'Cruise speed',
      min: 0.5,
      max: 12,
      step: 0.5,
      unit: 'm/s',
      default: 4,
      group: 'primary',
    },
    {
      id: 'spacing',
      label: 'Swath spacing',
      min: 10,
      max: 80,
      unit: 'm',
      default: 30,
      group: 'primary',
      modes: ['coverage'],
    },
    {
      id: 'dwell',
      label: 'Hold at waypoint',
      min: 0,
      max: 120,
      unit: 's',
      default: 0,
      group: 'primary',
      modes: ['route', 'patrol'],
    },
    {
      id: 'acceptRadius',
      label: 'Acceptance radius',
      min: 2,
      max: 20,
      unit: 'm',
      default: 5,
      group: 'primary',
    },
    {
      id: 'turnRadius',
      label: 'Turning radius',
      min: 5,
      max: 40,
      unit: 'm',
      default: 12,
      group: 'primary',
      modes: ['route', 'patrol'],
    },
    {
      id: 'clearance',
      label: 'Hazard clearance',
      min: 5,
      max: 50,
      unit: 'm',
      default: 15,
      group: 'primary',
      modes: ['route', 'patrol'],
    },
    {
      id: 'standoff',
      label: 'Shore standoff',
      min: 5,
      max: 100,
      unit: 'm',
      default: 20,
      group: 'failsafe',
    },
  ],
  linkLossActions: ['Hold station', 'Return to base', 'Continue'],
  limits: { maxSpeed: 12, enduranceMin: 240, batteryReserve: 20 },
  presets: {
    area: AREA_PRESETS,
    points: POINT_PRESETS,
    loop: LOOP_PRESETS,
    orbit: NO_PRESETS,
    maneuver: NO_PRESETS,
  },
  checks: ctx => [
    geometryCheck(ctx),
    ...zoneCheck(ctx),
    ...vehicleChecks(ctx, 20),
    {
      label: 'Speed',
      detail: `${ctx.draft.params.speed} m/s · limit 12 m/s`,
      level: ctx.draft.params.speed <= 12 ? 'pass' : 'warn',
    },
  ],
  summary: ctx =>
    ctx.mode.geometry === 'area'
      ? [[`${ctx.areaHa.toFixed(1)} ha`, 'COVERAGE']]
      : [
          [`${ctx.draft.waypoints.length}`, 'WAYPOINTS'],
          ...(ctx.mode.closed ? [[`${ctx.draft.repeats}`, 'LAPS'] as [string, string]] : []),
        ],
  alerts: ({ frame, stage, plan, limits, newerDraft }) => {
    const list = powerAndLinkAlerts(frame, 'hold station')
    if (Math.abs(frame.roll) > 15)
      list.push({ level: 'warn', text: `Heel ${Math.abs(frame.roll).toFixed(0)}°` })
    if (plan && plan.speed > limits.maxSpeed)
      list.push({
        level: 'warn',
        text: `Plan speed ${plan.speed} m/s exceeds ${limits.maxSpeed} m/s limit`,
      })
    if (newerDraft && plan)
      list.push({ level: 'warn', text: 'Newer plan draft not uploaded · sailing previous version' })
    if (stage === 'aborted')
      list.push({ level: 'critical', text: 'E-stop engaged · propulsion cut' })
    return list
  },
  strip: frame => [
    { icon: 'speed', label: 'SPEED', value: `${(frame.groundSpeed * 1.944).toFixed(1)} kts` },
    { icon: 'elevation', label: 'HEEL', value: `${Math.abs(frame.roll).toFixed(0)}°` },
    { icon: 'time', label: 'UNDER WAY', value: clock(frame.elapsedSeconds) },
    { icon: 'gps', label: 'GPS', value: `RTK FIX · ${frame.satellites}` },
    { icon: 'odometer', label: 'LOG', value: `${(frame.distance / 1852).toFixed(2)} nm` },
  ],
  hudTitle: (frame, callsign) =>
    [callsign, `${(frame.groundSpeed * 1.944).toFixed(1)} kts`].join(' · '),
}

const UUV: VehicleProfile = {
  ...UGV,
  type: 'UUV',
  domain: 'underwater',
  live: false,
  model: 'boat',
  instruments: 'attitude',
  payload: 'sonar',
  teleop: false,
  surfaceBound: true,
  streetRouting: false,
  words: {
    craft: 'submersible',
    liveTab: 'Live dive',
    planLocked: 'Mission in progress · plan is locked until the submersible surfaces',
    preCheck: 'Pre-dive & upload',
    checksTitle: 'Pre-dive checks',
    paramsPanel: 'Dive & failsafe',
    primaryGroup: 'Dive',
    playTitle: 'Run planned dive',
    onCraft: 'Active mission on the submersible',
    openLive: 'Open live dive',
    commandsLabel: 'DIVE COMMANDS',
    timeLabel: 'DIVE TIME',
  },
  stages: { ...groundStages, active: 'DIVING', holding: 'HOLDING', complete: 'SURFACED' },
  commands: { ...UGV.commands, launch: 'DIVE', hold: 'HOLD', stop: 'SURFACE' },
  modes: [
    { id: 'route', label: 'Transect', title: 'New transect mission', geometry: 'points' },
    { id: 'patrol', label: 'Loop', title: 'New loop mission', geometry: 'points', closed: true },
  ],
  parameters: [
    { id: 'altitude', label: 'Depth', min: 2, max: 100, unit: 'm', default: 20, group: 'primary' },
    {
      id: 'speed',
      label: 'Speed',
      min: 0.5,
      max: 4,
      step: 0.5,
      unit: 'm/s',
      default: 1.5,
      group: 'primary',
    },
    {
      id: 'dwell',
      label: 'Hold at waypoint',
      min: 0,
      max: 120,
      unit: 's',
      default: 0,
      group: 'primary',
    },
    {
      id: 'acceptRadius',
      label: 'Acceptance radius',
      min: 1,
      max: 10,
      unit: 'm',
      default: 3,
      group: 'primary',
    },
    {
      id: 'turnRadius',
      label: 'Turning radius',
      min: 3,
      max: 30,
      unit: 'm',
      default: 8,
      group: 'primary',
    },
    {
      id: 'clearance',
      label: 'Hazard clearance',
      min: 2,
      max: 30,
      unit: 'm',
      default: 8,
      group: 'primary',
    },
    {
      id: 'maxDepth',
      label: 'Depth limit',
      min: 10,
      max: 150,
      unit: 'm',
      default: 60,
      group: 'failsafe',
    },
  ],
  linkLossActions: ['Surface', 'Hold', 'Return to base'],
  limits: { maxSpeed: 4, enduranceMin: 300, batteryReserve: 25 },
  presets: {
    area: NO_PRESETS,
    points: POINT_PRESETS,
    loop: LOOP_PRESETS,
    orbit: NO_PRESETS,
    maneuver: NO_PRESETS,
  },
  checks: ctx => [
    geometryCheck(ctx),
    ...vehicleChecks(ctx, 25),
    {
      label: 'Depth',
      detail: `${ctx.draft.params.altitude} m · limit ${ctx.draft.params.maxDepth} m`,
      level: ctx.draft.params.altitude <= ctx.draft.params.maxDepth ? 'pass' : 'fail',
    },
  ],
  summary: ctx => [
    [`${ctx.draft.waypoints.length}`, 'WAYPOINTS'],
    [`${ctx.draft.params.altitude} m`, 'DEPTH'],
  ],
}

const PROFILES: Record<VehicleType, VehicleProfile> = { UAV, UGV, USV, UUV }

export const profileFor = (type: VehicleType) => PROFILES[type]

export const defaultParams = (profile: VehicleProfile) =>
  Object.fromEntries(profile.parameters.map(p => [p.id, p.default]))

export const modeSpec = (profile: VehicleProfile, mode: PlanMode) =>
  profile.modes.find(m => m.id === mode) ?? profile.modes[0]

/** Estimated mission time in minutes, including dwell at each stop. */
export function estimateMinutes(
  profile: VehicleProfile,
  routeMeters: number,
  transitMeters: number,
  speed: number,
  stops: number,
  dwellSeconds: number,
) {
  const moving = speed > 0 ? (routeMeters + transitMeters) / speed / 60 : 0
  // Ground vehicles lose time to corners and stops; air cruises at a constant speed.
  const fudge = profile.domain === 'air' ? 1 : 1.12
  return moving * fudge + (stops * dwellSeconds) / 60
}
