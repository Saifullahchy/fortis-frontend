import type { Mission } from '../../types/domain'

const KEY = 'fortis.missions.v1'

export function loadPlans(): Mission[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Mission[]) : []
  } catch {
    return []
  }
}

export function savePlans(plans: Mission[]) {
  window.localStorage.setItem(KEY, JSON.stringify(plans))
}
