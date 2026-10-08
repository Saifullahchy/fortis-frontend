import { useFlightSimulation, type TelemetrySource } from './useFlightSimulation'
import { METERS_PER_UNIT } from './missionGeometry'
import type { LivePlan } from './missionPlan'

export interface VehicleTelemetry extends TelemetrySource {
  source: 'simulation' | 'stream'
}

/**
 * Single seam for vehicle telemetry. Today it mirrors the vehicle's shared simulator, which only
 * moves when an operator arms and launches it (from either page); to go live, feed a
 * TelemetryFrame stream (WebSocket / SSE) into `simulatorFor(vehicleId).receive()` here and
 * route the command methods to the vehicle's MAVLink / ROS 2 bridge.
 */
export function useVehicleTelemetry(
  vehicleId: string,
  plan: LivePlan | null,
  batteryStart: number,
  ready: boolean,
): VehicleTelemetry {
  const sim = useFlightSimulation({
    vehicleId,
    enabled: ready,
    pathKey: plan?.path ?? '',
    metersPerUnit: METERS_PER_UNIT,
    cruiseSpeed: plan?.speed ?? 0,
    cruiseAltitude: plan?.altitude ?? 0,
    transitUnits: plan?.transitUnits ?? [0, 0],
    batteryStart,
    waypointCount: plan?.waypointCount ?? 0,
  })
  return { ...sim, source: 'simulation' }
}
