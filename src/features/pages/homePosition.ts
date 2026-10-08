import { useEffect, useState, useSyncExternalStore } from 'react'
import { setMissionOrigin } from './MissionHud'
import { HOME, METERS_PER_UNIT } from './missionGeometry'
import type { VehicleDomain } from '../../types/domain'

export type HomeSource = 'default' | 'device' | 'vehicle'
/** Which demo sector the grid sits in: inland for air and ground, the coast for water craft. */
export type HomeSector = 'land' | 'coastal'

export interface HomePosition {
  lat: number
  lng: number
  /** Horizontal accuracy in metres, when the source reports it. */
  accuracy?: number
  source: HomeSource
  updatedAt: number
  /** Why the device fix is unavailable, when it is. */
  error?: string
  sector?: HomeSector
}

/** Fallback when no fix is available: the demo sector. */
const DEFAULT_HOME: HomePosition = { lat: 23.8, lng: 90.3585, source: 'default', updatedAt: 0 }
/**
 * Water craft launch from the east beach of Saint Martin's Island, just south of the jetty:
 * open sea to the north and east where the planning grid lies, moored boats and the jetty
 * within sonar range. The device fix is ignored for them (an operator inland is not where the
 * boat is); the vehicle's own GPS still wins once it reports.
 */
const COASTAL_HOME: HomePosition = {
  lat: 20.6298,
  lng: 92.3277,
  source: 'default',
  sector: 'coastal',
  updatedAt: 0,
}
/** Ignore device jitter smaller than this so the map does not re-frame on every fix. */
const MIN_MOVE_M = 12

let current: HomePosition = DEFAULT_HOME
let sector: HomeSector = 'land'
let snapshot: HomePosition = DEFAULT_HOME
const listeners = new Set<() => void>()

const resolve = (): HomePosition =>
  sector === 'coastal' && current.source !== 'vehicle' ? COASTAL_HOME : current

/** Place the origin so that toGeo(HOME) lands exactly on the home fix, then wake subscribers. */
function apply(notify = true) {
  const h = resolve()
  const lat = h.lat + ((HOME.y - 350) * METERS_PER_UNIT) / 111320
  const lng =
    h.lng - ((HOME.x - 500) * METERS_PER_UNIT) / (111320 * Math.cos((h.lat * Math.PI) / 180))
  setMissionOrigin(lat, lng)
  snapshot = h
  if (notify) listeners.forEach(fn => fn())
}

/** Selects the demo sector for the vehicle class being worked on (no-op once a real fix is in). */
export function setHomeSector(domain: VehicleDomain | undefined, notify = true) {
  const next: HomeSector = domain === 'surface' || domain === 'underwater' ? 'coastal' : 'land'
  if (next === sector) return
  sector = next
  apply(notify)
}

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
    apply()
    return
  }
  current = candidate
  apply()
}

/** Binds a workspace to its class's sector before the first render that reads the grid. */
export function useHomeSector(domain: VehicleDomain | undefined) {
  // Move the grid before this render reads it (silently: no setState in other components
  // mid-render), then wake every subscriber once the tree has committed.
  setHomeSector(domain, false)
  useEffect(() => {
    setHomeSector(domain)
    listeners.forEach(fn => fn())
  }, [domain])
}

export function useHome(): HomePosition & { key: string } {
  const home = useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snapshot,
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

export interface HomePlace {
  /** Nearest city or town, when known. */
  city?: string
  region?: string
  country?: string
  countryCode?: string
}

const places = new Map<string, Promise<HomePlace>>()

/** Reverse-geocodes a position to city / region / country (OpenStreetMap Nominatim). */
function lookupPlace(lat: number, lng: number): Promise<HomePlace> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
  let pending = places.get(key)
  if (!pending) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lng}`
    pending = fetch(url, { headers: { Accept: 'application/json' } })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { address?: Record<string, string> }) => {
        const a = json.address ?? {}
        return {
          city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county,
          region: a.state ?? a.region ?? a.state_district,
          country: a.country,
          countryCode: a.country_code?.toUpperCase(),
        }
      })
    places.set(key, pending)
    pending.catch(() => places.delete(key))
  }
  return pending
}

/** Where HOME is in words: "Dhaka · Bangladesh". Resolves lazily; null until known. */
export function useHomePlace(): HomePlace | null {
  const home = useHome()
  const [place, setPlace] = useState<HomePlace | null>(null)
  useEffect(() => {
    let live = true
    lookupPlace(home.lat, home.lng).then(
      p => live && setPlace(p),
      () => live && setPlace({}),
    )
    return () => {
      live = false
    }
  }, [home.key, home.lat, home.lng])
  return place
}

export const placeLabel = (place: HomePlace | null, fallback = 'HOME SECTOR') => {
  if (!place) return 'LOCATING…'
  const parts = [place.city, place.country].filter(Boolean)
  return parts.length ? parts.join(' · ').toUpperCase() : fallback
}
