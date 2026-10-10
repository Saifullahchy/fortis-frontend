/**
 * Deterministic data for the walkthrough: the demo fleet plus an uploaded survey plan for the
 * demo aircraft, so every chapter can start on its own. The operator's own fleet and plans are
 * backed up when the tour starts and restored when it ends.
 */
import { platformApi } from '../../services/api/baseApi'
import { vehicles as demoFleet } from '../../services/api/mockData'
import { loadFleet, saveFleet } from '../../services/api/fleetStorage'
import { loadPlans, savePlans } from '../../services/api/missionStorage'
import type { AppDispatch } from '../../store'
import type { Mission, PlannerDraft } from '../../types/domain'
import { HOME, METERS_PER_UNIT, createSurveyRoute, distance } from '../pages/missionGeometry'
import { waypointsFromPathData } from '../pages/missionPlan'
import { emptyDraft } from '../pages/MissionsPage'
import { activeSimulators, simulatorFor } from '../pages/missionSimulator'
import { profileFor } from '../vehicles/vehicleProfile'
import { DEMO_VEHICLE } from './script'

const BACKUP_KEY = 'fortis.walkthrough.backup.v1'
const FLEET_KEY = 'fortis.fleet.v1'
const PLANS_KEY = 'fortis.missions.v1'
const PRESET = 'Dense capture'

function demoPlan(): Mission | null {
  const profile = profileFor('UAV')
  const preset = profile.presets.area[PRESET]
  if (!preset) return null
  const base = emptyDraft(profile)
  const draft: PlannerDraft = {
    ...base,
    planMode: 'survey',
    activePreset: { survey: PRESET },
    surveyPoints: preset.points.map(p => ({ ...p })),
    zones: preset.zones.map(zone => zone.map(p => ({ ...p }))),
    boundaryComplete: true,
    params: {
      ...base.params,
      ...(base.params.spacing !== undefined ? { spacing: preset.spacing } : {}),
      ...(base.params.overlap !== undefined ? { overlap: preset.overlap } : {}),
    },
  }
  const route = createSurveyRoute(
    draft.surveyPoints,
    (draft.params.spacing ?? 10) / METERS_PER_UNIT,
    draft.zones,
  )
  if (!route) return null
  const path = `M ${HOME.x} ${HOME.y} L ${route.start.x} ${route.start.y} ${route.path.replace(/^\s*M/, 'L')} L ${HOME.x} ${HOME.y}`
  const altitude = draft.params.altitude ?? 0
  return {
    id: `PLN-${DEMO_VEHICLE}`,
    name: profile.modes[0].title,
    vehicleId: DEMO_VEHICLE,
    status: 'ready',
    progress: 0,
    waypoints: waypointsFromPathData(path, altitude),
    plan: {
      draft,
      pathData: path,
      mode: 'survey',
      domain: profile.domain,
      altitude,
      speed: draft.params.speed ?? 0,
      transitMeters: [
        distance(HOME, route.start) * METERS_PER_UNIT,
        distance(route.end, HOME) * METERS_PER_UNIT,
      ],
      stopUnits: [],
      dwellSeconds: 0,
      acceptMeters: draft.params.acceptRadius,
    },
    updatedAt: new Date().toISOString(),
  }
}

/** Park every simulator and run the demo in real time (the app's own default is 4x). */
function resetSimulators() {
  activeSimulators().forEach(sim => sim.reset())
  demoFleet.forEach(v => simulatorFor(v.id).setRate(1))
}

const refresh = (dispatch: AppDispatch) =>
  dispatch(platformApi.util.invalidateTags(['Vehicle', 'Mission']))

export const hasBackup = () => window.localStorage.getItem(BACKUP_KEY) !== null

/** Seed the demo fleet and plan, backing up whatever the operator had first. */
export function installDemoFixture(dispatch: AppDispatch) {
  if (!hasBackup()) {
    const backup = {
      fleet: window.localStorage.getItem(FLEET_KEY),
      plans: window.localStorage.getItem(PLANS_KEY),
    }
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify(backup))
  }
  resetSimulators()
  saveFleet(demoFleet)
  const plan = demoPlan()
  savePlans([...loadPlans().filter(m => m.vehicleId !== DEMO_VEHICLE), ...(plan ? [plan] : [])])
  refresh(dispatch)
}

/** Put the demo aircraft's plan back to its uploaded state (a chapter may have changed it). */
export function resetDemoPlan(dispatch: AppDispatch) {
  resetSimulators()
  if (!loadFleet().length) saveFleet(demoFleet)
  const plan = demoPlan()
  savePlans([...loadPlans().filter(m => m.vehicleId !== DEMO_VEHICLE), ...(plan ? [plan] : [])])
  refresh(dispatch)
}

/** Restore the operator's own data. Safe to call when no backup exists. */
export function restoreDemoFixture(dispatch: AppDispatch) {
  const raw = window.localStorage.getItem(BACKUP_KEY)
  resetSimulators()
  if (raw) {
    try {
      const backup = JSON.parse(raw) as { fleet: string | null; plans: string | null }
      if (backup.fleet === null) window.localStorage.removeItem(FLEET_KEY)
      else window.localStorage.setItem(FLEET_KEY, backup.fleet)
      if (backup.plans === null) window.localStorage.removeItem(PLANS_KEY)
      else window.localStorage.setItem(PLANS_KEY, backup.plans)
    } catch {
      /* corrupt backup: leave the demo data in place rather than wipe anything */
    }
    window.localStorage.removeItem(BACKUP_KEY)
  }
  refresh(dispatch)
}
