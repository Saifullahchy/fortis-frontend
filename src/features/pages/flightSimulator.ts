import { HOME, type Point } from './missionGeometry'
import type { TelemetryFrame } from './useFlightSimulation'

export type FlightStage =
  'standby' | 'armed' | 'flying' | 'holding' | 'returning' | 'landed' | 'aborted'

export interface SimParams {
  pathKey: string
  metersPerUnit: number
  cruiseSpeed: number
  cruiseAltitude: number
  transitUnits: [number, number]
  /** Battery on board at arm time, percent. */
  batteryStart: number
  waypointCount: number
}

export interface SimState {
  frame: TelemetryFrame | null
  trail: Point[]
  playing: boolean
  rate: number
  stage: FlightStage
}

const TRAIL_STEP = 2.5
const ENDURANCE_MIN = 35
const IDLE: SimState = { frame: null, trail: [], playing: false, rate: 4, stage: 'standby' }
const AIRBORNE: FlightStage[] = ['flying', 'holding', 'returning']

export const isAirborne = (stage: FlightStage) => AIRBORNE.includes(stage)

/**
 * One simulator per vehicle, shared by every view that renders it. Lives outside React so a
 * running flight keeps ticking while the operator switches between Live Flight and Planning.
 * It exposes the same command set a flight controller would (arm / takeoff / hold / RTL / land /
 * abort); a real telemetry adapter pushes frames through `receive()` instead of the rAF loop.
 */
class FlightSimulator {
  private state: SimState = IDLE
  private params: SimParams | null = null
  private path: SVGPathElement | null = null
  private host: SVGSVGElement | null = null
  private traveled = 0
  private flightSeconds = 0
  /** Attitude integrated from the motion: bank from turn rate, nose-down with forward speed. */
  private attitude = {
    pitch: 0,
    roll: 0,
    heading: 0,
    lastSpeed: 0,
    lastAltitude: 0,
    verticalSpeed: 0,
    gustClock: 0,
    gustPitch: 0,
    gustRoll: 0,
  }
  private transit: [number, number] = [0, 0]
  /** Distance flown on earlier legs (e.g. before an RTL re-route), in path units. */
  private flownBefore = 0
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
      this.traveled = 0
      this.flownBefore = 0
      this.flightSeconds = 0
      this.attitude = {
        pitch: 0,
        roll: 0,
        heading: 0,
        lastSpeed: 0,
        lastAltitude: 0,
        verticalSpeed: 0,
        gustClock: 0,
        gustPitch: 0,
        gustRoll: 0,
      }
      this.stopLoop()
      this.set({ ...IDLE, rate: this.state.rate })
    } else if (!isAirborne(this.state.stage)) {
      this.transit = params.transitUnits
    }
  }

  // ---- commands -------------------------------------------------------------------------------

  arm = () => {
    if (!this.total() || this.state.stage !== 'standby') return
    this.set({ ...this.state, stage: 'armed', frame: this.sample(0, 'armed') })
  }

  takeoff = () => {
    if (this.state.stage !== 'armed') return
    this.traveled = 0
    this.flownBefore = 0
    this.flightSeconds = 0
    this.set({ ...this.state, stage: 'flying', playing: true, trail: [] })
    this.startLoop()
  }

  hold = () => {
    if (this.state.stage !== 'flying' && this.state.stage !== 'returning') return
    this.stopLoop()
    this.set({ ...this.state, stage: 'holding', playing: false })
  }

  resume = () => {
    if (this.state.stage !== 'holding') return
    const returning = this.transit[0] === 0 && this.transit[1] === this.total()
    this.set({ ...this.state, stage: returning ? 'returning' : 'flying', playing: true })
    this.startLoop()
  }

  returnHome = () => {
    const frame = this.state.frame
    const p = this.params
    if (!frame || !p || !isAirborne(this.state.stage)) return
    this.stopLoop()
    const from = frame.position
    this.flownBefore += this.traveled
    this.mountPath(`M ${from.x} ${from.y} L ${HOME.x} ${HOME.y}`)
    this.traveled = 0
    this.transit = [0, this.total()]
    this.set({ ...this.state, stage: 'returning', playing: true })
    this.startLoop()
  }

  land = () => {
    const frame = this.state.frame
    if (!frame || !isAirborne(this.state.stage)) return
    this.stopLoop()
    this.set({
      ...this.state,
      stage: 'landed',
      playing: false,
      frame: { ...frame, altitude: 0, groundSpeed: 0, phase: 'landed' },
    })
  }

  abort = () => {
    const frame = this.state.frame
    if (this.state.stage === 'standby' || this.state.stage === 'aborted') return
    this.stopLoop()
    this.set({
      ...this.state,
      stage: 'aborted',
      playing: false,
      frame: frame ? { ...frame, altitude: 0, groundSpeed: 0, phase: 'landed' } : null,
    })
  }

  /** Back to a parked vehicle on the planned route (post-flight / sandbox reset). */
  reset = () => {
    const p = this.params
    this.stopLoop()
    if (p) {
      this.mountPath(p.pathKey)
      this.transit = p.transitUnits
    }
    this.traveled = 0
    this.flownBefore = 0
    this.flightSeconds = 0
    this.state = { ...this.state, playing: false, stage: 'standby' }
    this.set({ ...this.state, trail: [], frame: this.sample(0, 'standby') })
  }

  /** Convenience for the planner's play button: arm + take off, or resume a hold. */
  play = () => {
    const stage = this.state.stage
    if (stage === 'holding') return this.resume()
    if (stage === 'landed' || stage === 'aborted') this.reset()
    if (this.state.stage === 'standby') this.arm()
    this.takeoff()
  }

  pause = () => this.hold()

  setRate = (rate: number) => this.set({ ...this.state, rate })

  /** Hook for a real stream: feed frames in and the UI follows them. */
  receive(frame: TelemetryFrame, stage: FlightStage) {
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
    this.state = next
    this.listeners.forEach(fn => fn())
  }

  private mountPath(d: string) {
    this.host?.remove()
    this.host = null
    this.path = null
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
  }

  private total() {
    return this.path?.getTotalLength() ?? 0
  }

  private sample(units: number, stage: FlightStage): TelemetryFrame | null {
    const path = this.path
    const p = this.params
    if (!path || !p) return null
    const total = path.getTotalLength()
    if (!total) return null
    const at = Math.min(Math.max(units, 0), total)
    const pt = path.getPointAtLength(at)
    const ahead = path.getPointAtLength(Math.min(at + 3, total))
    const behind = path.getPointAtLength(Math.max(at - 3, 0))
    const heading = (Math.atan2(ahead.x - behind.x, behind.y - ahead.y) * 180) / Math.PI
    const climbUnits = 60 / p.metersPerUnit
    const done = at >= total
    const airborne = isAirborne(stage)
    const phase: TelemetryFrame['phase'] = done
      ? 'landed'
      : !airborne
        ? 'standby'
        : stage === 'returning'
          ? 'return'
          : at < this.transit[0]
            ? 'climb'
            : at > total - this.transit[1]
              ? 'return'
              : 'mission'
    // An RTL leg starts at cruise altitude; only the original takeoff ramps up.
    const up = stage === 'returning' ? 1 : Math.min(at / climbUnits, 1)
    const down = Math.min((total - at) / climbUnits, 1)
    const before = this.flownBefore * p.metersPerUnit
    const minutes = this.flightSeconds / 60
    const battery = Math.max(0, Math.round(p.batteryStart - minutes * (100 / ENDURANCE_MIN)))
    const homeMeters = Math.hypot(pt.x - HOME.x, pt.y - HOME.y) * p.metersPerUnit
    const remainingMeters = (total - at) * p.metersPerUnit
    const moving = airborne && !done
    return {
      position: { x: pt.x, y: pt.y },
      heading: (heading + 360) % 360,
      altitude: Math.round(p.cruiseAltitude * Math.min(up, down)),
      groundSpeed: moving ? p.cruiseSpeed : 0,
      distance: before + at * p.metersPerUnit,
      total: before + total * p.metersPerUnit,
      progress: at / total,
      phase,
      battery,
      link: Math.max(20, Math.round(94 - Math.min(40, homeMeters / 40))),
      satellites: 18 + Math.round(2 * Math.sin(this.flightSeconds / 7)),
      flightSeconds: this.flightSeconds,
      pitch: Math.round(this.attitude.pitch * 10) / 10,
      roll: Math.round(this.attitude.roll * 10) / 10,
      verticalSpeed: Math.round(this.attitude.verticalSpeed * 10) / 10,
      remainingMeters,
      remainingSeconds: p.cruiseSpeed ? remainingMeters / p.cruiseSpeed : 0,
      waypoint: {
        index: Math.min(p.waypointCount, Math.ceil((at / total) * p.waypointCount)),
        total: p.waypointCount,
      },
    }
  }

  /**
   * A multirotor banks into turns and pitches nose-down to hold forward speed; vertical
   * climb and hover are level. Real telemetry replaces this with the autopilot's ATTITUDE.
   */
  private integrateAttitude(frame: TelemetryFrame, dt: number) {
    const a = this.attitude
    const dHeading = ((frame.heading - a.heading + 540) % 360) - 180
    a.heading = frame.heading
    const turnRate = dt > 0 ? dHeading / dt : 0
    const dSpeed = dt > 0 ? (frame.groundSpeed - a.lastSpeed) / dt : 0
    a.lastSpeed = frame.groundSpeed
    // Vertical speed from the altitude profile, smoothed like a baro-derived climb rate.
    const rawVs = dt > 0 ? (frame.altitude - a.lastAltitude) / dt : 0
    a.lastAltitude = frame.altitude
    a.verticalSpeed += (rawVs - a.verticalSpeed) * (1 - Math.exp(-dt * 3))
    const airborne = frame.altitude > 0
    const forward = frame.groundSpeed > 0 && frame.phase !== 'climb'
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

  private extend(trail: Point[], frame: TelemetryFrame) {
    const tail = trail[trail.length - 1]
    if (tail && Math.hypot(tail.x - frame.position.x, tail.y - frame.position.y) < TRAIL_STEP)
      return trail
    return [...trail, frame.position]
  }

  private startLoop() {
    if (this.raf) return
    this.last = performance.now()
    const tick = (now: number) => {
      const p = this.params
      if (!p) return
      const dt = Math.min((now - this.last) / 1000, 0.1) * this.state.rate
      this.last = now
      this.flightSeconds += dt
      this.traveled += (p.cruiseSpeed * dt) / p.metersPerUnit
      const frame = this.sample(this.traveled, this.state.stage)
      if (frame) this.integrateAttitude(frame, dt)
      if (frame) {
        const landed = frame.phase === 'landed'
        this.set({
          ...this.state,
          frame,
          trail: this.extend(this.state.trail, frame),
          playing: !landed,
          stage: landed ? 'landed' : this.state.stage,
        })
        if (landed) {
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

const simulators = new Map<string, FlightSimulator>()

export function simulatorFor(vehicleId: string) {
  let sim = simulators.get(vehicleId)
  if (!sim) {
    sim = new FlightSimulator()
    simulators.set(vehicleId, sim)
  }
  return sim
}
