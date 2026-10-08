import type { Mission, PlannerDraft } from '../../types/domain'

const KEY = 'fortis.missions.v1'

/** Drafts saved before the planner became profile-driven kept flight parameters at the top level. */
type LegacyDraft = Partial<PlannerDraft> & {
  altitude?: number
  speed?: number
  overlap?: number
  spacing?: number
  returnAltitude?: number
}

function migrateDraft(draft: LegacyDraft | undefined): PlannerDraft | undefined {
  if (!draft || !draft.planMode) return undefined
  if (draft.params) return draft as PlannerDraft
  const { altitude, speed, overlap, spacing, returnAltitude, ...rest } = draft
  return {
    ...(rest as PlannerDraft),
    params: {
      ...(altitude !== undefined ? { altitude } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(overlap !== undefined ? { overlap } : {}),
      ...(spacing !== undefined ? { spacing } : {}),
      ...(returnAltitude !== undefined ? { returnAltitude } : {}),
    },
    activePreset: draft.activePreset ?? {},
  }
}

export function loadPlans(): Mission[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const plans = raw ? (JSON.parse(raw) as Mission[]) : []
    return plans.map(m =>
      m.plan
        ? {
            ...m,
            plan: {
              ...m.plan,
              domain: m.plan.domain ?? 'air',
              draft: migrateDraft(m.plan.draft as LegacyDraft | undefined),
            },
          }
        : m,
    )
  } catch {
    return []
  }
}

export function savePlans(plans: Mission[]) {
  window.localStorage.setItem(KEY, JSON.stringify(plans))
}
