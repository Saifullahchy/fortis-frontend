import { useEffect, useSyncExternalStore } from 'react'
import { simulatorFor, type FlightStage, type SimParams } from './flightSimulator'
import type { Point } from './missionGeometry'

export interface TelemetryFrame {
  position: Point
  heading: number
  altitude: number
  groundSpeed: number
  distance: number
  total: number
  progress: number
  phase: 'standby' | 'climb' | 'mission' | 'return' | 'landed'
  battery: number
  link: number
  satellites: number
  flightSeconds: number
  /** Attitude in degrees: pitch nose-up positive, roll right-wing-down positive. */
  pitch: number
  roll: number
  /** Climb rate in m/s, positive up. */
  verticalSpeed: number
  remainingMeters: number
  remainingSeconds: number
  waypoint: { index: number; total: number }
}

export interface TelemetrySource {
  frame: TelemetryFrame | null
  trail: Point[]
  playing: boolean
  rate: number
  stage: FlightStage
  play: () => void
  pause: () => void
  reset: () => void
  setRate: (rate: number) => void
  arm: () => void
  takeoff: () => void
  hold: () => void
  resume: () => void
  returnHome: () => void
  land: () => void
  abort: () => void
}

interface Options extends SimParams {
  vehicleId: string
  /** Leave false until the plan is known; an empty path would otherwise reset a live flight. */
  enabled?: boolean
}

/**
 * Binds a view to the vehicle's shared simulator, so Live Flight and Mission Planning show the
 * same flight at the same moment. The simulator survives navigation between the two.
 */
export function useFlightSimulation(options: Options): TelemetrySource {
  const {
    vehicleId,
    enabled = true,
    pathKey,
    metersPerUnit,
    cruiseSpeed,
    cruiseAltitude,
    transitUnits,
    batteryStart,
    waypointCount,
  } = options
  const sim = simulatorFor(vehicleId)
  const [out, back] = transitUnits
  useEffect(() => {
    if (!enabled) return
    sim.configure({
      pathKey,
      metersPerUnit,
      cruiseSpeed,
      cruiseAltitude,
      transitUnits: [out, back],
      batteryStart,
      waypointCount,
    })
  }, [
    sim,
    enabled,
    pathKey,
    metersPerUnit,
    cruiseSpeed,
    cruiseAltitude,
    out,
    back,
    batteryStart,
    waypointCount,
  ])
  const state = useSyncExternalStore(sim.subscribe, sim.getState)
  return {
    ...state,
    play: sim.play,
    pause: sim.pause,
    reset: sim.reset,
    setRate: sim.setRate,
    arm: sim.arm,
    takeoff: sim.takeoff,
    hold: sim.hold,
    resume: sim.resume,
    returnHome: sim.returnHome,
    land: sim.land,
    abort: sim.abort,
  }
}
