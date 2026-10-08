import { useMissionSimulation, type TelemetrySource } from './useMissionSimulation'
import type { LinkKind } from './missionSimulator'
import { METERS_PER_UNIT } from './missionGeometry'
import type { LivePlan } from './missionPlan'
import type { VehicleProfile } from '../vehicles/vehicleProfile'

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
  profile: VehicleProfile,
  plan: LivePlan | null,
  batteryStart: number,
  ready: boolean,
  connection = '',
): VehicleTelemetry {
  const sim = useMissionSimulation({
    vehicleId,
    enabled: ready,
    domain: profile.domain,
    pathKey: plan?.path ?? '',
    metersPerUnit: METERS_PER_UNIT,
    cruiseSpeed: plan?.speed ?? 0,
    cruiseAltitude: plan?.altitude ?? 0,
    transitUnits: plan?.transitUnits ?? [0, 0],
    batteryStart,
    waypointCount: plan?.waypointCount ?? 0,
    stopUnits: plan?.stopUnits ?? [],
    dwellSeconds: plan?.dwellSeconds ?? 0,
    acceptMeters: plan?.acceptMeters,
    enduranceMin: profile.limits.enduranceMin,
    linkKind: linkKindFor(profile.domain, connection),
    bottomClearance: plan?.bottomClearance,
  })
  return { ...sim, source: 'simulation' }
}

/** Underwater craft report over a tether or an acoustic modem; everything else is radio. */
export function linkKindFor(domain: string, connection: string): LinkKind {
  const c = connection.toLowerCase()
  if (c.includes('tether')) return 'tether'
  if (c.includes('acoustic') || domain === 'underwater') return 'acoustic'
  return 'rf'
}
