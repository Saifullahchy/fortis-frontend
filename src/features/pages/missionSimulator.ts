import { HOME, type Point } from './missionGeometry'
import type { VehicleDomain } from '../../types/domain'

/**
 * Mission lifecycle shared by every vehicle class. Profiles supply the words (a UAV is
 * "in flight", a UGV is "driving"); the machine is the same.
 */
export type MissionStage =
  'standby' | 'armed' | 'active' | 'holding' | 'manual' | 'returning' | 'complete' | 'aborted'
export type MissionPhase = 'standby' | 'outbound' | 'mission' | 'return' | 'complete'

/** Ground / surface extension of the frame; absent for air vehicles. */
export interface GroundTelemetry {
  /** Slope along the direction of travel, percent, uphill positive. */
  grade: number
  /** Terrain height relative to base, metres. */
  elevation: number
  /** Distance from the planned path, metres (non-zero under manual control). */
  crossTrack: number
  odometer: number
  driveMode: 'auto' | 'manual'
}

/** Water extension of the frame: present for surface and underwater vehicles. */
export interface WaterTelemetry {
  /** Course over ground, degrees: where the hull is actually going (heading plus crab). */
  course: number
  /** Current: the direction it flows toward (set, degrees) and its speed (drift, m/s). */
  set: number
  drift: number
  /** Depth below the surface, metres (0 on the surface). */
  depth: number
  /** Water depth at this position, metres. */
  seabed: number
  /** Height above the seabed, metres. */
  altitudeAboveBottom: number
  /** Navigation error radius, metres: grows on dead reckoning underwater, resets with a fix. */
  positionError: number
  /** Seconds since the last status packet; an acoustic link only reports every few seconds. */
  linkAge: number
  /** Seconds between status packets on this link (0 for a continuous link). */
  linkInterval: number
  /** True while holding position at a stop against the current. */
  stationKeeping: boolean
  leak: boolean
  /** Hull internal pressure, kPa; a sealed hull holds ~101 kPa, a rise means a seal is going. */
  internalPressure: number
  waterTemp: number
}

export interface TelemetryFrame {
  position: Point
  heading: number
  altitude: number
  groundSpeed: number
  distance: number
  total: number
  progress: number
  phase: MissionPhase
  battery: number
  link: number
  satellites: number
  elapsedSeconds: number
  /** Attitude in degrees: pitch nose-up positive, roll right-side-down positive. */
  pitch: number
  roll: number
  /** Climb rate in m/s, positive up. */
  verticalSpeed: number
  remainingMeters: number
  remainingSeconds: number
  waypoint: { index: number; total: number }
  ground?: GroundTelemetry
  water?: WaterTelemetry
}

export type LinkKind = 'rf' | 'acoustic' | 'tether'

export interface SimParams {
  domain: VehicleDomain
  pathKey: string
  metersPerUnit: number
  cruiseSpeed: number
  cruiseAltitude: number
  transitUnits: [number, number]
  /** Battery on board at arm time, percent. */
  batteryStart: number
  waypointCount: number
  /** Path lengths (units) where a ground vehicle stops and dwells. */
  stopUnits?: number[]
  dwellSeconds?: number
  /** Waypoint acceptance radius, metres: arriving within it counts as reaching the stop. */
  acceptMeters?: number
  /** Full-battery runtime, minutes. */
  enduranceMin?: number
  /** Telemetry link: an acoustic link reports in sparse packets, a tether or RF continuously. */
  linkKind?: LinkKind
  /** Underwater: minimum height to keep above the seabed, metres (terrain following). */
  bottomClearance?: number
}

export interface DriveInput {
  /** -1 (full reverse) … 1 (full ahead). */
  throttle: number
  /** -1 (full left) … 1 (full right). */
  steer: number
}

export interface SimEvent {
  at: number
  stage: MissionStage
  note: string
}

export interface SimState {
  frame: TelemetryFrame | null
  trail: Point[]
  playing: boolean
  rate: number
  stage: MissionStage
  events: SimEvent[]
}

const TRAIL_STEP = 2.5
const DEFAULT_ENDURANCE_MIN = 35
const MAX_EVENTS = 40
const IDLE: SimState = {
  frame: null,
  trail: [],
  playing: false,
  rate: 4,
  stage: 'standby',
  events: [],
}
const ACTIVE: MissionStage[] = ['active', 'holding', 'manual', 'returning']

/** Ground motion limits (m/s², °/s). A rover accelerates gently and slows for corners. */
const GROUND = {
  accel: 1.2,
  decel: 1.8,
  lateralAccel: 1.4,
  minCornerSpeed: 0.8,
  manualTurnRate: 70,
  manualSpeedFactor: 0.6,
  lookaheadMeters: 9,
}

/**
 * Water motion model. A hull is pushed sideways by the current: under way it crabs into it to
 * hold the track; at a stop it drifts inside the loiter radius and drives back when it leaves it
 * (ArduPilot's boat Loiter). Underwater, navigation is dead reckoning: the position error grows
 * with distance run and only a surface fix or an acoustic (USBL) fix pulls it back.
 */
const WATER = {
  surfaceDrift: 0.45,
  underwaterDrift: 0.22,
  /** Residual cross-track the autopilot leaves per m/s of beam current, metres. */
  crossTrackPerDrift: 5,
  loiterRadius: 4,
  loiterGain: 0.5,
  /** Dead-reckoning error growth, fraction of distance run. */
  drError: 0.02,
  surfaceFixError: 1.5,
  acousticInterval: 8,
  /** USBL fix error as a fraction of slant range from the base transponder. */
  usblError: 0.015,
  diveSlope: 4,
}

const isWater = (d: VehicleDomain) => d === 'surface' || d === 'underwater'
/** Seconds between status packets on an acoustic link, for standby readouts. */
export const ACOUSTIC_STATUS_INTERVAL = WATER.acousticInterval

/** Mission stage names that mean the vehicle is under way (plan locked, commands live). */
export const isActive = (stage: MissionStage) => ACTIVE.includes(stage)

/** Synthetic terrain relief around the base, metres; smooth enough for a believable grade. */
export function terrainHeight(p: Point, metersPerUnit: number) {
  const x = p.x * metersPerUnit
  const y = p.y * metersPerUnit
  return (
    2.4 * Math.sin(x / 63 + 0.4) +
    1.7 * Math.cos(y / 49 + 0.9) +
    0.8 * Math.sin((x + y) / 27) +
    0.5 * Math.sin((x - 2 * y) / 19)
  )
}

/** Synthetic bathymetry around the base, metres below the surface; shelves away from home. */
export function seabedDepth(p: Point, metersPerUnit: number) {
  const dx = (p.x - HOME.x) * metersPerUnit
  const dy = (p.y - HOME.y) * metersPerUnit
  const away = Math.hypot(dx, dy)
  return Math.max(
    1.5,
    5 +
      away * 0.045 +
      3 * Math.sin(dx / 70 + 1) +
      2.2 * Math.cos(dy / 55) +
      1.1 * Math.sin((dx + dy) / 33),
  )
}

const EMPTY_WATER = () => ({
  /** Cross-track offset from the plan, metres, right-of-track positive. */
  crossTrack: 0,
  /** Drift away from a stop while station keeping, metres (screen x/y sense). */
  hold: { x: 0, y: 0 },
  holdSpeed: 0,
  holdHeading: null as number | null,
  depth: 0,
  lastDepth: 0,
  lastAt: 0,
  positionError: 1.5,
  linkAge: 0,
  pitch: 0,
})

const EMPTY_ATTITUDE = () => ({
  pitch: 0,
  roll: 0,
  heading: 0,
  lastSpeed: 0,
  lastAltitude: 0,
  verticalSpeed: 0,
  gustClock: 0,
  gustPitch: 0,
  gustRoll: 0,
})

/**
 * One simulator per vehicle, shared by every view that renders it. Lives outside React so a
 * running mission keeps ticking while the operator switches between Live and Planning.
 * It exposes the command set an autopilot would (arm / launch / hold / return / stop / abort,
 * plus manual drive for ground vehicles); a real telemetry adapter pushes frames through
 * `receive()` instead of the rAF loop.
 */
class MissionSimulator {
  private state: SimState = IDLE
  private params: SimParams | null = null
  private path: SVGPathElement | null = null
  private host: SVGSVGElement | null = null
  /** Coarse samples of the mounted path, for nearest-point lookups under manual control. */
  private samples: Array<{ at: number; p: Point }> = []
  private traveled = 0
  private elapsedSeconds = 0
  /** Current speed in m/s; air cruises at a constant, ground integrates with accel limits. */
  private speed = 0
  private dwellLeft = 0
  private nextStop = 0
  /** Unrounded altitude from the last sample, for a clean vertical-speed derivative. */
  private altitudeExact = 0
  private attitude = EMPTY_ATTITUDE()
  private water = EMPTY_WATER()
  private transit: [number, number] = [0, 0]
  /** Distance covered on earlier legs (e.g. before an RTL re-route), in path units. */
  private coveredBefore = 0
  /** Manual-drive state: free position, resumed onto the plan via a rejoin leg. */
  private manualPose: { position: Point; heading: number } | null = null
  private input: DriveInput = { throttle: 0, steer: 0 }
  private rejoin: { pathKey: string; traveled: number; transit: [number, number] } | null = null
  private raf = 0
  private last = 0
  private listeners = new Set<() => void>()

  getState = () => this.state

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  configure(params: SimParams) {
    const pathChanged = params.pathKey !== this.params?.pathKey
    this.params = params
    if (pathChanged) {
      this.mountPath(params.pathKey)
      this.transit = params.transitUnits
      this.resetMotion()
      this.stopLoop()
      this.set({ ...IDLE, rate: this.state.rate })
    } else if (!isActive(this.state.stage)) {
      this.transit = params.transitUnits
    }
  }

  // ---- commands -------------------------------------------------------------------------------

  arm = () => {
    if (!this.total() || this.state.stage !== 'standby') return
    this.set({ ...this.state, stage: 'armed', frame: this.sample(0, 'armed') })
  }

  /** Take off (air) or start driving (ground). */
  launch = () => {
    if (this.state.stage !== 'armed') return
    this.resetMotion()
    this.set({ ...this.state, stage: 'active', playing: true, trail: [] })
    this.startLoop()
  }

  /** Hold: hover (air), pause (ground) or keep station against the current (water). */
  hold = () => {
    if (this.state.stage !== 'active' && this.state.stage !== 'returning') return
    const p = this.params
    // A hull keeps ticking while it holds: the current still moves it and it drives back.
    if (!p || !isWater(p.domain)) this.stopLoop()
    this.speed = 0
    this.set({ ...this.state, stage: 'holding', playing: false })
  }

  resume = () => {
    if (this.state.stage !== 'holding') return
    const returning = this.transit[0] === 0 && this.transit[1] === this.total()
    this.set({ ...this.state, stage: returning ? 'returning' : 'active', playing: true })
    this.startLoop()
  }

  returnHome = () => {
    const frame = this.state.frame
    const p = this.params
    if (!frame || !p || !isActive(this.state.stage)) return
    this.stopLoop()
    const from = frame.position
    this.coveredBefore += this.traveled
    this.manualPose = null
    this.rejoin = null
    this.mountPath(`M ${from.x} ${from.y} L ${HOME.x} ${HOME.y}`)
    this.traveled = 0
    this.transit = [0, this.total()]
    this.set({ ...this.state, stage: 'returning', playing: true })
    this.startLoop()
  }

  /** Land (air) or stop and park where it is (ground). */
  stop = () => {
    const frame = this.state.frame
    if (!frame || !isActive(this.state.stage)) return
    this.stopLoop()
    this.speed = 0
    this.set({
      ...this.state,
      stage: 'complete',
      playing: false,
      frame: this.surfaced({ ...frame, altitude: 0, groundSpeed: 0, phase: 'complete' }),
    })
  }

  abort = () => {
    const frame = this.state.frame
    if (this.state.stage === 'standby' || this.state.stage === 'aborted') return
    this.stopLoop()
    this.speed = 0
    this.set({
      ...this.state,
      stage: 'aborted',
      playing: false,
      frame: frame
        ? this.surfaced({ ...frame, altitude: 0, groundSpeed: 0, phase: 'complete' })
        : null,
    })
  }

  /** Operator takes the sticks: the vehicle leaves the plan and follows DriveInput. */
  takeControl = () => {
    const frame = this.state.frame
    const p = this.params
    if (!frame || !p || p.domain === 'air') return
    if (this.state.stage !== 'active' && this.state.stage !== 'holding') return
    if (!this.rejoin)
      this.rejoin = { pathKey: p.pathKey, traveled: this.traveled, transit: this.transit }
    this.manualPose = { position: { ...frame.position }, heading: frame.heading }
    this.input = { throttle: 0, steer: 0 }
    this.speed = 0
    this.set({ ...this.state, stage: 'manual', playing: true })
    this.startLoop()
  }

  drive = (input: DriveInput) => {
    this.input = {
      throttle: Math.max(-1, Math.min(1, input.throttle)),
      steer: Math.max(-1, Math.min(1, input.steer)),
    }
  }

  /** Hand control back: drive to the nearest point of the plan, then continue from there. */
  resumeAuto = () => {
    const pose = this.manualPose
    const rj = this.rejoin
    if (this.state.stage !== 'manual' || !pose || !rj) return
    this.stopLoop()
    this.mountPath(rj.pathKey)
    const near = this.nearestOnPath(pose.position, rj.traveled)
    this.manualPose = null
    this.input = { throttle: 0, steer: 0 }
    // Rejoin leg: straight to the plan, then the remainder of the original path.
    const rest = this.params?.pathKey ?? rj.pathKey
    this.rejoin = { pathKey: rest, traveled: near.at, transit: rj.transit }
    this.mountPath(`M ${pose.position.x} ${pose.position.y} L ${near.p.x} ${near.p.y}`)
    this.traveled = 0
    this.transit = [this.total(), 0]
    this.set({ ...this.state, stage: 'active', playing: true })
    this.startLoop()
  }

  /** Back to a parked vehicle on the planned route (post-mission / sandbox reset). */
  reset = () => {
    const p = this.params
    this.stopLoop()
    if (p) {
      this.mountPath(p.pathKey)
      this.transit = p.transitUnits
    }
    this.resetMotion()
    this.state = { ...this.state, playing: false, stage: 'standby' }
    this.set({ ...this.state, trail: [], frame: this.sample(0, 'standby') })
  }

  /** Convenience for the planner's play button: arm + launch, or resume a hold. */
  play = () => {
    const stage = this.state.stage
    if (stage === 'holding') return this.resume()
    if (stage === 'manual') return this.resumeAuto()
    if (stage === 'complete' || stage === 'aborted') this.reset()
    if (this.state.stage === 'standby') this.arm()
    this.launch()
  }

  pause = () => this.hold()

  setRate = (rate: number) => this.set({ ...this.state, rate })

  /** Hook for a real stream: feed frames in and the UI follows them. */
  receive(frame: TelemetryFrame, stage: MissionStage) {
    this.stopLoop()
    this.set({
      ...this.state,
      playing: false,
      stage,
      frame,
      trail: this.extend(this.state.trail, frame),
    })
  }

  // ---- internals ------------------------------------------------------------------------------

  private set(next: SimState) {
    if (next.stage !== this.state.stage) {
      const event: SimEvent = { at: Date.now(), stage: next.stage, note: '' }
      next = { ...next, events: [...next.events, event].slice(-MAX_EVENTS) }
    }
    this.state = next
    this.listeners.forEach(fn => fn())
  }

  private resetMotion() {
    this.traveled = 0
    this.coveredBefore = 0
    this.elapsedSeconds = 0
    this.speed = 0
    this.dwellLeft = 0
    this.nextStop = 0
    this.manualPose = null
    this.rejoin = null
    this.input = { throttle: 0, steer: 0 }
    this.attitude = EMPTY_ATTITUDE()
    this.water = EMPTY_WATER()
  }

  private mountPath(d: string) {
    this.host?.remove()
    this.host = null
    this.path = null
    this.samples = []
    if (!d) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    path.setAttribute('d', d)
    svg.appendChild(path)
    document.body.appendChild(svg)
    this.host = svg
    this.path = path
    const total = path.getTotalLength()
    const step = Math.max(3, total / 600)
    for (let at = 0; at <= total; at += step) {
      const p = path.getPointAtLength(at)
      this.samples.push({ at, p: { x: p.x, y: p.y } })
    }
  }

  private total() {
    return this.path?.getTotalLength() ?? 0
  }

  /** Closest sampled point of the mounted path at or beyond `from`, so a rejoin never goes back. */
  private nearestOnPath(point: Point, from: number) {
    let best = this.samples[0] ?? { at: 0, p: HOME }
    let bestD = Infinity
    for (const s of this.samples) {
      if (s.at < from - 1) continue
      const d = Math.hypot(s.p.x - point.x, s.p.y - point.y)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  private headingAt(at: number) {
    const path = this.path
    if (!path) return 0
    const total = path.getTotalLength()
    const ahead = path.getPointAtLength(Math.min(at + 3, total))
    const behind = path.getPointAtLength(Math.max(at - 3, 0))
    return ((Math.atan2(ahead.x - behind.x, behind.y - ahead.y) * 180) / Math.PI + 360) % 360
  }

  private sample(units: number, stage: MissionStage): TelemetryFrame | null {
    const path = this.path
    const p = this.params
    if (!path || !p) return null
    const total = path.getTotalLength()
    if (!total) return null
    const at = Math.min(Math.max(units, 0), total)
    const pt = path.getPointAtLength(at)
    const heading = this.headingAt(at)
    const air = p.domain === 'air'
    const done = at >= total
    const active = isActive(stage)
    const phase: MissionPhase = done
      ? 'complete'
      : !active
        ? 'standby'
        : stage === 'returning'
          ? 'return'
          : at < this.transit[0]
            ? 'outbound'
            : at > total - this.transit[1]
              ? 'return'
              : 'mission'
    // Air: climb/descent ramp over ~250 m of track (~5 m/s at cruise), like a real multirotor.
    // An RTL leg starts at cruise altitude; only the original takeoff ramps up.
    const climbUnits = 250 / p.metersPerUnit
    const up = stage === 'returning' ? 1 : Math.min(at / climbUnits, 1)
    const down = Math.min((total - at) / climbUnits, 1)
    this.altitudeExact = air ? p.cruiseAltitude * Math.min(up, down) : 0
    const before = this.coveredBefore * p.metersPerUnit
    const minutes = this.elapsedSeconds / 60
    const endurance = p.enduranceMin ?? DEFAULT_ENDURANCE_MIN
    const battery = Math.max(0, Math.round(p.batteryStart - minutes * (100 / endurance)))
    const homeMeters = Math.hypot(pt.x - HOME.x, pt.y - HOME.y) * p.metersPerUnit
    const remainingMeters = (total - at) * p.metersPerUnit + this.rejoinRemaining()
    const moving = active && !done
    const groundSpeed = !moving ? 0 : air ? p.cruiseSpeed : Math.round(this.speed * 10) / 10
    const stops = p.stopUnits ?? []
    const waypointIndex = stops.length
      ? Math.min(p.waypointCount, this.nextStop)
      : Math.min(p.waypointCount, Math.ceil((at / total) * p.waypointCount))
    const distance = before + at * p.metersPerUnit
    const water = isWater(p.domain)
    const seabed = water ? seabedDepth(pt, p.metersPerUnit) : 0
    const stream = water ? this.current() : { set: 0, drift: 0 }
    return {
      position: { x: pt.x, y: pt.y },
      heading,
      altitude: Math.round(this.altitudeExact),
      groundSpeed,
      distance,
      total: before + total * p.metersPerUnit + this.rejoinRemaining(),
      progress: at / total,
      phase,
      battery,
      link: Math.max(20, Math.round(94 - Math.min(40, homeMeters / 40))),
      satellites: 18 + Math.round(2 * Math.sin(this.elapsedSeconds / 7)),
      elapsedSeconds: this.elapsedSeconds,
      pitch: Math.round(this.attitude.pitch * 10) / 10,
      roll: Math.round(this.attitude.roll * 10) / 10,
      verticalSpeed: Math.round(this.attitude.verticalSpeed * 10) / 10,
      remainingMeters,
      remainingSeconds: p.cruiseSpeed ? remainingMeters / p.cruiseSpeed : 0,
      waypoint: { index: waypointIndex, total: p.waypointCount },
      ...(air
        ? {}
        : {
            ground: {
              grade: 0,
              elevation: Math.round(terrainHeight(pt, p.metersPerUnit) * 10) / 10,
              crossTrack: 0,
              odometer: distance,
              driveMode: 'auto' as const,
            },
            ...(water
              ? {
                  water: {
                    course: heading,
                    set: Math.round(stream.set),
                    drift: Math.round(stream.drift * 100) / 100,
                    depth: Math.round(this.water.depth * 10) / 10,
                    seabed: Math.round(seabed * 10) / 10,
                    altitudeAboveBottom: Math.round((seabed - this.water.depth) * 10) / 10,
                    positionError: Math.round(this.water.positionError * 10) / 10,
                    linkAge: 0,
                    linkInterval: this.linkKind() === 'acoustic' ? WATER.acousticInterval : 0,
                    stationKeeping: false,
                    leak: false,
                    internalPressure: 101.3,
                    waterTemp: 24.5,
                  },
                }
              : {}),
          }),
    }
  }

  /** A moored or surfaced craft sits at the surface with a fresh fix. */
  private surfaced(frame: TelemetryFrame): TelemetryFrame {
    if (!frame.water) return frame
    this.water.depth = 0
    this.water.positionError = WATER.surfaceFixError
    return {
      ...frame,
      verticalSpeed: 0,
      water: {
        ...frame.water,
        depth: 0,
        altitudeAboveBottom: frame.water.seabed,
        positionError: WATER.surfaceFixError,
        stationKeeping: false,
      },
    }
  }

  private linkKind(): LinkKind {
    const p = this.params!
    return p.linkKind ?? (p.domain === 'underwater' ? 'acoustic' : 'rf')
  }

  /** The current at this moment: a steady set that wanders slowly, like a tidal stream. */
  private current() {
    const p = this.params!
    const t = this.elapsedSeconds
    const base = p.domain === 'underwater' ? WATER.underwaterDrift : WATER.surfaceDrift
    return {
      set: (215 + 10 * Math.sin(t / 90) + 360) % 360,
      drift: Math.max(0.05, base + base * 0.35 * Math.sin(t / 60 + 1)),
    }
  }

  /**
   * Water behaviour layered on the sampled frame: crab and residual cross-track from the
   * current, station keeping at stops, the dive profile with terrain following, dead-reckoning
   * error and the sparse acoustic link. Real telemetry replaces all of it with the autopilot's
   * GLOBAL_POSITION_INT / VFR_HUD / SCALED_PRESSURE2 stream.
   */
  private integrateWater(frame: TelemetryFrame, dt: number, manual = false) {
    const p = this.params!
    const w = this.water
    const mpu = p.metersPerUnit
    const under = p.domain === 'underwater'
    const { set, drift } = this.current()
    const track = frame.heading
    const rel = ((set - track) * Math.PI) / 180
    /** Beam component of the current, right-of-track positive, and the head component. */
    const beam = drift * Math.sin(rel)
    const speed = frame.groundSpeed
    const stopped = !manual && (this.dwellLeft > 0 || speed < 0.05) && isActive(this.state.stage)
    const k = 1 - Math.exp(-dt * 0.8)
    let heading = track
    let course = track
    let stationKeeping = false
    let gs = speed
    if (stopped && frame.phase !== 'complete') {
      // Station keeping: drift freely inside the loiter radius, drive back outside it.
      stationKeeping = true
      const h = w.hold
      const sx = Math.sin((set * Math.PI) / 180)
      const sy = -Math.cos((set * Math.PI) / 180)
      h.x += sx * drift * dt
      h.y += sy * drift * dt
      const out = Math.hypot(h.x, h.y) - WATER.loiterRadius
      if (out > 0) {
        const back = Math.min(p.cruiseSpeed, out * WATER.loiterGain + 0.2)
        const n = Math.hypot(h.x, h.y) || 1
        h.x -= (h.x / n) * back * dt
        h.y -= (h.y / n) * back * dt
        w.holdSpeed += (back - w.holdSpeed) * k
        // Bow toward the stop point (LOIT_TYPE 1): a bow-mounted sensor keeps looking at it.
        w.holdHeading = (Math.atan2(-h.x, h.y) * 180) / Math.PI
      } else {
        w.holdSpeed += (0 - w.holdSpeed) * k
      }
      if (w.holdHeading === null) w.holdHeading = (set + 180) % 360
      heading = (w.holdHeading + 360) % 360
      course = heading
      gs = Math.round(w.holdSpeed * 10) / 10
      w.crossTrack += (0 - w.crossTrack) * k
    } else {
      w.hold = { x: 0, y: 0 }
      w.holdSpeed = 0
      w.holdHeading = null
      // Under way: crab into the beam current to hold the track, leaving a little cross-track.
      const crab =
        speed > 0.2 ? (Math.asin(Math.max(-0.95, Math.min(0.95, beam / speed))) * 180) / Math.PI : 0
      heading = (track - crab + 360) % 360
      const targetXt = speed > 0.2 ? beam * WATER.crossTrackPerDrift * 0.4 : 0
      w.crossTrack += (targetXt - w.crossTrack) * k
      const along = speed || 0.001
      course =
        speed > 0.2
          ? (track + (Math.atan2(w.crossTrack * 0.05, along) * 180) / Math.PI + 360) % 360
          : track
    }
    // Apply the offsets to the reported position (screen units, y down).
    const ht = (track * Math.PI) / 180
    const right = { x: Math.cos(ht), y: Math.sin(ht) }
    const offX = (right.x * w.crossTrack + w.hold.x) / mpu
    const offY = (right.y * w.crossTrack + w.hold.y) / mpu
    frame.position = { x: frame.position.x + offX, y: frame.position.y + offY }
    frame.heading = Math.round(heading * 10) / 10
    if (!manual) frame.groundSpeed = gs
    const seabed = seabedDepth(frame.position, mpu)
    // Depth: dive and surface over a glide slope at the ends of the track, hold depth between,
    // and lift over shallows to keep the bottom clearance (SurfTrak-style terrain following).
    let depth = 0
    if (under) {
      const planned = p.cruiseAltitude
      const clearance = Math.max(1, p.bottomClearance ?? 3)
      const diveUnits = Math.max(60, planned * WATER.diveSlope) / mpu
      const total = this.total()
      const at = this.traveled
      const up = this.state.stage === 'returning' ? 1 : Math.min(at / diveUnits, 1)
      const down = total > 0 ? Math.min((total - at) / diveUnits, 1) : 0
      const active = isActive(this.state.stage) && frame.phase !== 'complete'
      const target = active
        ? Math.max(0, Math.min(planned * Math.min(up, down), seabed - clearance))
        : 0
      const kd = 1 - Math.exp(-dt * 1.2)
      w.depth += (target - w.depth) * kd
      depth = w.depth
    }
    const dDepth = dt > 0 ? (depth - w.lastDepth) / dt : 0
    w.lastDepth = depth
    // Navigation: dead reckoning underwater grows the error with distance; a surface GPS fix or
    // an acoustic USBL fix (one per status packet) pulls it back.
    const ds = Math.abs(speed) * dt
    const homeMeters = Math.hypot(frame.position.x - HOME.x, frame.position.y - HOME.y) * mpu
    const link = this.linkKind()
    const interval = link === 'acoustic' ? WATER.acousticInterval : 0
    let packet = false
    if (interval) {
      w.linkAge += dt
      if (w.linkAge >= interval) {
        w.linkAge = 0
        packet = true
      }
    } else w.linkAge = 0
    if (depth > 0.5) {
      w.positionError += ds * WATER.drError + dt * 0.01
      if (packet) w.positionError = Math.min(w.positionError, 3 + homeMeters * WATER.usblError)
    } else {
      w.positionError += (WATER.surfaceFixError - w.positionError) * (1 - Math.exp(-dt * 1.5))
    }
    if (link === 'acoustic') {
      frame.link = Math.max(15, Math.round(88 - Math.min(60, homeMeters / 18) - depth * 0.15))
      frame.satellites = depth > 0.5 ? 0 : frame.satellites
    } else if (link === 'tether') {
      frame.link = 99
      frame.satellites = depth > 0.5 ? 0 : frame.satellites
    }
    frame.verticalSpeed = Math.round(-dDepth * 10) / 10
    if (frame.ground) {
      frame.ground.crossTrack = manual
        ? frame.ground.crossTrack
        : Math.round(Math.abs(w.crossTrack) * 10) / 10
      frame.ground.elevation = -Math.round(seabed * 10) / 10
      frame.ground.grade = 0
    }
    frame.water = {
      course: Math.round(course * 10) / 10,
      set: Math.round(set),
      drift: Math.round(drift * 100) / 100,
      depth: Math.round(depth * 10) / 10,
      seabed: Math.round(seabed * 10) / 10,
      altitudeAboveBottom: Math.round(Math.max(0, seabed - depth) * 10) / 10,
      positionError: Math.round(w.positionError * 10) / 10,
      linkAge: Math.round(w.linkAge * 10) / 10,
      linkInterval: interval,
      stationKeeping,
      leak: false,
      internalPressure:
        Math.round((101.3 + depth * 0.004 + 0.15 * Math.sin(this.elapsedSeconds / 11)) * 10) / 10,
      waterTemp: Math.round((24.5 - depth * 0.12) * 10) / 10,
    }
  }

  /** Metres still to drive on the original plan after a rejoin leg completes. */
  private rejoinRemaining() {
    const rj = this.rejoin
    const p = this.params
    if (!rj || !p || this.state.stage === 'manual') return 0
    // The plan is not mounted during a rejoin leg; measure it off-screen instead.
    return Math.max(0, this.pathLengthOf(rj.pathKey) - rj.traveled) * p.metersPerUnit
  }

  private lengthCache = new Map<string, number>()
  private pathLengthOf(d: string) {
    const hit = this.lengthCache.get(d)
    if (hit !== undefined) return hit
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    const len = path.getTotalLength()
    this.lengthCache.set(d, len)
    return len
  }

  /**
   * A multirotor banks into turns and pitches nose-down to hold forward speed; vertical
   * climb and hover are level. Real telemetry replaces this with the autopilot's ATTITUDE.
   */
  private integrateAirAttitude(frame: TelemetryFrame, dt: number) {
    const a = this.attitude
    const dHeading = ((frame.heading - a.heading + 540) % 360) - 180
    a.heading = frame.heading
    const turnRate = dt > 0 ? dHeading / dt : 0
    const dSpeed = dt > 0 ? (frame.groundSpeed - a.lastSpeed) / dt : 0
    a.lastSpeed = frame.groundSpeed
    // Vertical speed from the altitude profile, smoothed like a baro-derived climb rate.
    const rawVs = dt > 0 ? (this.altitudeExact - a.lastAltitude) / dt : 0
    a.lastAltitude = this.altitudeExact
    a.verticalSpeed += (rawVs - a.verticalSpeed) * (1 - Math.exp(-dt * 3))
    const airborne = frame.altitude > 0
    const forward = frame.groundSpeed > 0 && frame.phase !== 'outbound'
    // Bank into the turn; a coordinated multirotor also pitches a little nose-up to hold height.
    const bank = Math.max(-32, Math.min(32, -turnRate * 0.38))
    // Pitch reads like a flight HUD: nose-up while climbing, nose-down while descending, and
    // only a mild nose-down in level cruise so the horizon sits near the middle.
    const climbPitch = Math.max(-15, Math.min(15, a.verticalSpeed * 2.8))
    const cruisePitch = forward ? -2.5 : 0
    const accelPitch = Math.max(-5, Math.min(5, -dSpeed * 0.8))
    const turnPitch = Math.abs(bank) * 0.06
    // Light turbulence: slow random-walk gusts, re-aimed every ~1.5 s of flight.
    a.gustClock -= dt
    if (a.gustClock <= 0) {
      a.gustClock = 1 + Math.random()
      a.gustPitch = (Math.random() - 0.5) * 3
      a.gustRoll = (Math.random() - 0.5) * 4
    }
    const targetRoll = airborne ? bank + a.gustRoll : 0
    const targetPitch = airborne
      ? climbPitch + cruisePitch + accelPitch + turnPitch + a.gustPitch
      : 0
    const k = 1 - Math.exp(-dt * 4)
    a.roll += (targetRoll - a.roll) * k
    a.pitch += (targetPitch - a.pitch) * k
    frame.pitch = Math.round(a.pitch * 10) / 10
    frame.roll = Math.round(a.roll * 10) / 10
    frame.verticalSpeed = Math.round(a.verticalSpeed * 10) / 10
  }

  /**
   * A ground vehicle takes the terrain's attitude: pitch is the slope along its heading, roll
   * the slope across it. A boat has no grade; it heels into turns and rides a gentle swell.
   */
  private integrateGroundAttitude(frame: TelemetryFrame, dt: number) {
    const a = this.attitude
    const p = this.params!
    const dHeading = ((frame.heading - a.heading + 540) % 360) - 180
    a.heading = frame.heading
    const turnRate = dt > 0 ? dHeading / dt : 0
    const k = 1 - Math.exp(-dt * 5)
    const h = (frame.heading * Math.PI) / 180
    const fwd = { x: Math.sin(h), y: -Math.cos(h) }
    const side = { x: Math.cos(h), y: Math.sin(h) }
    const probe = 2 / p.metersPerUnit
    const at = (d: Point, s: number) =>
      terrainHeight(
        { x: frame.position.x + d.x * s, y: frame.position.y + d.y * s },
        p.metersPerUnit,
      )
    let targetPitch = 0
    let targetRoll = 0
    let grade = 0
    if (p.domain === 'surface') {
      const t = this.elapsedSeconds
      targetPitch = 1.2 * Math.sin(t / 1.7)
      targetRoll = 1.6 * Math.sin(t / 2.3 + 1) + Math.max(-8, Math.min(8, -turnRate * 0.12))
    } else if (p.domain === 'underwater') {
      // Nose follows the dive: down while descending, up while surfacing; swell fades with depth.
      const t = this.elapsedSeconds
      const depth = frame.water?.depth ?? 0
      const swell = Math.max(0, 1 - depth / 3)
      const vs = frame.verticalSpeed
      targetPitch = Math.max(-25, Math.min(25, vs * 9)) + swell * 1.2 * Math.sin(t / 1.7)
      targetRoll = swell * 1.6 * Math.sin(t / 2.3 + 1) + Math.max(-6, Math.min(6, -turnRate * 0.08))
    } else {
      const along = (at(fwd, probe) - at(fwd, -probe)) / 4
      const across = (at(side, probe) - at(side, -probe)) / 4
      grade = along * 100
      targetPitch = (Math.atan(along) * 180) / Math.PI
      targetRoll = (Math.atan(across) * 180) / Math.PI
    }
    a.pitch += (targetPitch - a.pitch) * k
    a.roll += (targetRoll - a.roll) * k
    frame.pitch = Math.round(a.pitch * 10) / 10
    frame.roll = Math.round(a.roll * 10) / 10
    if (p.domain !== 'underwater') frame.verticalSpeed = 0
    if (frame.ground && !isWater(p.domain)) frame.ground.grade = Math.round(grade * 10) / 10
  }

  /** The stop the vehicle is heading for on the plan; none while returning or rejoining. */
  private pendingStop() {
    const p = this.params!
    if (this.rejoin || this.state.stage === 'returning') return undefined
    return (p.stopUnits ?? [])[this.nextStop]
  }

  /** Target speed on the plan: cruise, eased for corners, stops and the end of the route. */
  private groundTargetSpeed(at: number, total: number) {
    const p = this.params!
    const mpu = p.metersPerUnit
    const look = GROUND.lookaheadMeters / mpu
    const h0 = this.headingAt(at)
    const h1 = this.headingAt(Math.min(at + look, total))
    const turn = Math.abs(((h1 - h0 + 540) % 360) - 180) * (Math.PI / 180)
    const radius = turn > 0.01 ? GROUND.lookaheadMeters / turn : Infinity
    const corner = Math.max(GROUND.minCornerSpeed, Math.sqrt(GROUND.lateralAccel * radius))
    let target = Math.min(p.cruiseSpeed, corner)
    const braking = (this.speed * this.speed) / (2 * GROUND.decel)
    const stop = this.pendingStop()
    // Brake for the stop, but never below a creep: the acceptance radius decides arrival.
    if (stop !== undefined && (stop - at) * mpu <= braking + 0.4)
      target = Math.min(target, Math.max(0.4, ((stop - at) * mpu) / 1.5))
    const toEnd = (total - at) * mpu
    if (toEnd <= braking) target = Math.min(target, Math.max(0.6, toEnd * 0.8))
    return target
  }

  private advanceGround(dt: number) {
    const p = this.params!
    const total = this.total()
    const stop = this.pendingStop()
    if (this.dwellLeft > 0) {
      this.dwellLeft -= dt
      this.speed = 0
      if (this.dwellLeft <= 0) this.nextStop += 1
      return
    }
    const accept = Math.max(0.5, p.acceptMeters ?? 1.5) / p.metersPerUnit
    if (stop !== undefined && this.traveled >= stop - accept && this.speed < 0.6) {
      this.speed = 0
      this.traveled = Math.min(stop, total)
      if ((p.dwellSeconds ?? 0) > 0) this.dwellLeft = p.dwellSeconds!
      else this.nextStop += 1
      return
    }
    const target = this.groundTargetSpeed(this.traveled, total)
    const delta = target - this.speed
    const limit = delta > 0 ? GROUND.accel * dt : -GROUND.decel * dt
    this.speed += delta > 0 ? Math.min(delta, limit) : Math.max(delta, limit)
    this.traveled += (this.speed * dt) / p.metersPerUnit
  }

  private advanceManual(dt: number): TelemetryFrame | null {
    const p = this.params!
    const pose = this.manualPose!
    const target = this.input.throttle * p.cruiseSpeed * GROUND.manualSpeedFactor
    const delta = target - this.speed
    const limit = delta > 0 ? GROUND.accel * dt : -GROUND.decel * dt
    this.speed += delta > 0 ? Math.min(delta, limit) : Math.max(delta, limit)
    const authority = Math.min(1, Math.abs(this.speed) / 1.5 + 0.25)
    pose.heading =
      (pose.heading +
        this.input.steer * GROUND.manualTurnRate * dt * authority * (this.speed >= 0 ? 1 : -1) +
        360) %
      360
    const h = (pose.heading * Math.PI) / 180
    const units = (this.speed * dt) / p.metersPerUnit
    pose.position = {
      x: pose.position.x + Math.sin(h) * units,
      y: pose.position.y - Math.cos(h) * units,
    }
    const last = this.state.frame
    if (!last) return null
    const rj = this.rejoin
    const near = rj ? this.nearestOnPath(pose.position, rj.traveled) : null
    const crossTrack = near
      ? Math.hypot(near.p.x - pose.position.x, near.p.y - pose.position.y) * p.metersPerUnit
      : 0
    const homeMeters =
      Math.hypot(pose.position.x - HOME.x, pose.position.y - HOME.y) * p.metersPerUnit
    const minutes = this.elapsedSeconds / 60
    const endurance = p.enduranceMin ?? DEFAULT_ENDURANCE_MIN
    const distance = last.distance + Math.abs(this.speed) * dt
    return {
      ...last,
      position: { ...pose.position },
      heading: pose.heading,
      groundSpeed: Math.round(this.speed * 10) / 10,
      distance,
      phase: 'mission',
      battery: Math.max(0, Math.round(p.batteryStart - minutes * (100 / endurance))),
      link: Math.max(20, Math.round(94 - Math.min(40, homeMeters / 40))),
      elapsedSeconds: this.elapsedSeconds,
      ground: {
        grade: last.ground?.grade ?? 0,
        elevation: Math.round(terrainHeight(pose.position, p.metersPerUnit) * 10) / 10,
        crossTrack: Math.round(crossTrack * 10) / 10,
        odometer: distance,
        driveMode: 'manual',
      },
      ...(last.water ? { water: last.water } : {}),
    }
  }

  private extend(trail: Point[], frame: TelemetryFrame) {
    const tail = trail[trail.length - 1]
    if (tail && Math.hypot(tail.x - frame.position.x, tail.y - frame.position.y) < TRAIL_STEP)
      return trail
    return [...trail, frame.position]
  }

  /** A rejoin leg has ended: continue the original plan from where the vehicle left it. */
  private finishRejoin() {
    const rj = this.rejoin
    if (!rj) return false
    this.rejoin = null
    this.coveredBefore += this.traveled
    this.mountPath(rj.pathKey)
    this.traveled = rj.traveled
    this.transit = rj.transit
    this.nextStop = (this.params?.stopUnits ?? []).findIndex(s => s > rj.traveled + 0.6)
    if (this.nextStop < 0) this.nextStop = (this.params?.stopUnits ?? []).length
    return true
  }

  private startLoop() {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      const p = this.params
      if (!p) return
      const dt = Math.min((now - this.last) / 1000, 0.1) * this.state.rate
      this.last = now
      this.elapsedSeconds += dt
      let frame: TelemetryFrame | null
      if (this.state.stage === 'manual') {
        frame = this.advanceManual(dt)
        if (frame) {
          if (isWater(p.domain)) this.integrateWater(frame, dt, true)
          this.integrateGroundAttitude(frame, dt)
        }
      } else {
        if (this.state.stage === 'holding') this.speed = 0
        else if (p.domain === 'air') {
          this.speed = p.cruiseSpeed
          this.traveled += (p.cruiseSpeed * dt) / p.metersPerUnit
        } else this.advanceGround(dt)
        if (this.traveled >= this.total() && this.finishRejoin()) {
          this.speed = Math.min(this.speed, GROUND.minCornerSpeed)
        }
        frame = this.sample(this.traveled, this.state.stage)
        if (frame) {
          if (isWater(p.domain)) this.integrateWater(frame, dt)
          if (p.domain === 'air') this.integrateAirAttitude(frame, dt)
          else this.integrateGroundAttitude(frame, dt)
        }
      }
      if (frame) {
        const done = frame.phase === 'complete'
        this.set({
          ...this.state,
          frame,
          trail: this.extend(this.state.trail, frame),
          playing: !done,
          stage: done ? 'complete' : this.state.stage,
        })
        if (done) {
          this.raf = 0
          return
        }
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}

const simulators = new Map<string, MissionSimulator>()

export function simulatorFor(vehicleId: string) {
  let sim = simulators.get(vehicleId)
  if (!sim) {
    sim = new MissionSimulator()
    simulators.set(vehicleId, sim)
  }
  return sim
}

/** Every simulator that has been created this session, keyed by vehicle id. */
export const activeSimulators = () => simulators
