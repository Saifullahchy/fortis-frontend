import type { MissionWaypoint, Vehicle } from '../../../types/domain'
export type MapMode = 'TACTICAL' | 'SATELLITE' | 'TERRAIN' | '3D'
export type CameraMode = 'TOP' | '3D' | 'FOLLOW' | 'FPV'
export interface MapController {
  addVehicle(vehicle: Vehicle): void
  updateVehicle(vehicle: Vehicle): void
  removeVehicle(vehicleId: string): void
  focusVehicle(vehicleId: string): void
  followVehicle(vehicleId: string): void
  stopFollowing(): void
  addWaypoint(waypoint: MissionWaypoint): void
  removeWaypoint(id: string): void
  setMapMode(mode: MapMode): void
  setCameraMode(mode: CameraMode): void
  toggleLayer(layer: string): void
  destroy(): void
}
