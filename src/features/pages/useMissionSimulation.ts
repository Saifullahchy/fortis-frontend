import { useEffect, useSyncExternalStore } from 'react'
import {
  simulatorFor,
  type DriveInput,
  type MissionStage,
  type SimEvent,
  type SimParams,
  type TelemetryFrame,
} from './missionSimulator'
import type { Point } from './missionGeometry'

export type { TelemetryFrame } from './missionSimulator'

export interface TelemetrySource {
  frame: TelemetryFrame | null
  trail: Point[]
  playing: boolean
  rate: number
  stage: MissionStage
  events: SimEvent[]
  play: () => void
  pause: () => void
  reset: () => void
  setRate: (rate: number) => void
  arm: () => void
  launch: () => void
  hold: () => void
  resume: () => void
  returnHome: () => void
  stop: () => void
  abort: () => void
  takeControl: () => void
  drive: (input: DriveInput) => void
  resumeAuto: () => void
}

interface Options extends SimParams {
  vehicleId: string
  /** Leave false until the plan is known; an empty path would otherwise reset a live mission. */
  enabled?: boolean
}

/**
 * Binds a view to the vehicle's shared simulator, so the live workspace and the planner show
 * the same mission at the same moment. The simulator survives navigation between the two.
 */
export function useMissionSimulation(options: Options): TelemetrySource {
  const {
    vehicleId,
    enabled = true,
    domain,
    pathKey,
    metersPerUnit,
    cruiseSpeed,
    cruiseAltitude,
    transitUnits,
    batteryStart,
    waypointCount,
    stopUnits,
    dwellSeconds,
    acceptMeters,
    enduranceMin,
  } = options
  const sim = simulatorFor(vehicleId)
  const [out, back] = transitUnits
  const stopsKey = (stopUnits ?? []).map(s => s.toFixed(1)).join(',')
  useEffect(() => {
    if (!enabled) return
    sim.configure({
      domain,
      pathKey,
      metersPerUnit,
      cruiseSpeed,
      cruiseAltitude,
      transitUnits: [out, back],
      batteryStart,
      waypointCount,
      stopUnits: stopsKey ? stopsKey.split(',').map(Number) : [],
      dwellSeconds,
      acceptMeters,
      enduranceMin,
    })
  }, [
    sim,
    enabled,
    domain,
    pathKey,
    metersPerUnit,
    cruiseSpeed,
    cruiseAltitude,
    out,
    back,
    batteryStart,
    waypointCount,
    stopsKey,
    dwellSeconds,
    acceptMeters,
    enduranceMin,
  ])
  const state = useSyncExternalStore(sim.subscribe, sim.getState)
  return {
    ...state,
    play: sim.play,
    pause: sim.pause,
    reset: sim.reset,
    setRate: sim.setRate,
    arm: sim.arm,
    launch: sim.launch,
    hold: sim.hold,
    resume: sim.resume,
    returnHome: sim.returnHome,
    stop: sim.stop,
    abort: sim.abort,
    takeControl: sim.takeControl,
    drive: sim.drive,
    resumeAuto: sim.resumeAuto,
  }
}
