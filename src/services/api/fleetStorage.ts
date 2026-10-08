import type { Vehicle } from '../../types/domain'

const KEY = 'fortis.fleet.v1'

export function loadFleet(): Vehicle[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Vehicle[]) : []
  } catch {
    return []
  }
}

export function saveFleet(fleet: Vehicle[]) {
  window.localStorage.setItem(KEY, JSON.stringify(fleet))
}
