import type { Viewer } from 'cesium'
import type { MissionWaypoint, Vehicle } from '../../../types/domain'
import type { CameraMode, MapController, MapMode } from '../adapters/MapController'
/** Cesium integration boundary. The prototype renderer can be swapped for this adapter without leaking Viewer into React or Redux. */
export class CesiumMapAdapter implements MapController {
  private vehicles = new Map<string, Vehicle>()
  constructor(private readonly viewer: Viewer) {}
  addVehicle(v: Vehicle) {
    this.vehicles.set(v.id, v)
  }
  updateVehicle(v: Vehicle) {
    this.vehicles.set(v.id, v)
  }
  removeVehicle(id: string) {
    this.vehicles.delete(id)
    this.viewer.entities.removeById(id)
  }
  focusVehicle(id: string) {
    const entity = this.viewer.entities.getById(id)
    if (entity) void this.viewer.flyTo(entity)
  }
  followVehicle(id: string) {
    this.viewer.trackedEntity = this.viewer.entities.getById(id)
  }
  stopFollowing() {
    this.viewer.trackedEntity = undefined
  }
  addWaypoint(_w: MissionWaypoint) {}
  removeWaypoint(id: string) {
    this.viewer.entities.removeById(id)
  }
  setMapMode(_mode: MapMode) {}
  setCameraMode(_mode: CameraMode) {}
  toggleLayer(_layer: string) {}
  destroy() {
    this.viewer.destroy()
  }
}
