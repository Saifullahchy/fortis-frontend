import { useSyncExternalStore } from 'react'
import { setMissionOrigin } from './MissionHud'
import { HOME, METERS_PER_UNIT } from './missionGeometry'

export type HomeSource = 'default' | 'device' | 'vehicle'

export interface HomePosition {
  lat: number
  lng: number
  /** Horizontal accuracy in metres, when the source reports it. */
  accuracy?: number
  source: HomeSource
  updatedAt: number
  /** Why the device fix is unavailable, when it is. */
  error?: string
}

/** Fallback when no fix is available: the demo sector. */
const DEFAULT_HOME: HomePosition = { lat: 23.8, lng: 90.3585, source: 'default', updatedAt: 0 }
/** Ignore device jitter smaller than this so the map does not re-frame on every fix. */
const MIN_MOVE_M = 12

let current: HomePosition = DEFAULT_HOME
const listeners = new Set<() => void>()

const metres = (a: HomePosition, b: HomePosition) => {
  const dLat = (b.lat - a.lat) * 111320
  const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

/**
 * Anchors the mission grid so the HOME marker sits on the given position. In production the
 * authoritative home is the vehicle's own GPS fix at arm time; the ground station's device
 * location fills in before telemetry arrives, so the operator always plans around where they are.
 */
export function setHome(next: Omit<HomePosition, 'updatedAt'>) {
  const candidate: HomePosition = { ...next, updatedAt: Date.now() }
  const sameSource = candidate.source === current.source
  if (sameSource && metres(current, candidate) < MIN_MOVE_M && !candidate.error) {
    // Keep the grid still, but let the freshness/accuracy readout tick over.
    current = { ...current, accuracy: candidate.accuracy, updatedAt: candidate.updatedAt }
    listeners.forEach(fn => fn())
    return
  }
  current = candidate
  // Place the origin so that toGeo(HOME) lands exactly on the home fix.
  const lat = candidate.lat + ((HOME.y - 350) * METERS_PER_UNIT) / 111320
  const lng =
    candidate.lng -
    ((HOME.x - 500) * METERS_PER_UNIT) / (111320 * Math.cos((candidate.lat * Math.PI) / 180))
  setMissionOrigin(lat, lng)
  listeners.forEach(fn => fn())
}

export function useHome(): HomePosition & { key: string } {
  const home = useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  return { ...home, key: `${home.lat.toFixed(5)},${home.lng.toFixed(5)}` }
}

/** Follows the device's GPS for as long as the app is open. Returns a stop function. */
export function startDeviceHomeTracking() {
  if (!('geolocation' in navigator)) {
    setHome({ ...DEFAULT_HOME, error: 'Location not supported on this device' })
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    pos =>
      setHome({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        source: 'device',
      }),
    err =>
      setHome({
        ...DEFAULT_HOME,
        error:
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Location unavailable',
      }),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
