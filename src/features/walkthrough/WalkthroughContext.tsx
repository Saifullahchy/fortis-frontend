import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppDispatch } from '../../store/hooks'
import { simulatorFor } from '../pages/missionSimulator'
import { installDemoFixture, resetDemoPlan, restoreDemoFixture } from './demoFixture'
import { clickFirst, closePanel, openPanel, sleep, waitFor } from './dom'
import { play, warmVoices, type Stop } from './narration'
import { CHAPTERS, chapterById } from './script'
import type { StepContext, TourChapter, TourStep } from './types'

export type TourStatus = 'idle' | 'running' | 'complete'

export interface TourState {
  status: TourStatus
  chapter: TourChapter | null
  index: number
  step: TourStep | null
  /** The spotlighted element once it has been found; null while locating or when none. */
  target: Element | null
  /** True while navigating or waiting for the target to appear. */
  locating: boolean
  /** Full-screen fade while a chapter starts and the console remounts. */
  veil: boolean
  /** Narration progress for the current step, seconds. */
  progress: { at: number; duration: number }
  muted: boolean
  /** Bumps on every chapter start so the console remounts with fresh demo data. */
  session: number
}

export interface TourApi extends TourState {
  chapters: TourChapter[]
  /** Install the demo data and run a chapter from its first step. */
  start: (chapterId: string, index?: number) => void
  next: () => void
  back: () => void
  replay: () => void
  /** Leave the tour, restore the operator's data and return to the demo landing. */
  exit: () => void
  setMuted: (muted: boolean) => void
}

const Ctx = createContext<TourApi | null>(null)
const SESSION_KEY = 'fortis.walkthrough.v1'
const MUTE_KEY = 'fortis.walkthrough.muted'

const initial: TourState = {
  status: 'idle',
  chapter: null,
  index: 0,
  step: null,
  target: null,
  locating: false,
  veil: false,
  progress: { at: 0, duration: 0 },
  session: 0,
  muted: (() => {
    try {
      return window.localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })(),
}

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<TourState>(initial)
  const stateRef = useRef(state)
  stateRef.current = state
  /** Increments on every step change so stale async work can bail out. */
  const run = useRef(0)
  /** Step `before` hooks chained so they never overlap. */
  const hooks = useRef<Promise<unknown>>(Promise.resolve())
  const stopAudio = useRef<Stop | null>(null)
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const ctx = useMemo<StepContext>(
    () => ({
      navigate: path => navigateRef.current(path),
      dispatch,
      waitFor,
      click: clickFirst,
      openPanel,
      closePanel,
      sim: simulatorFor,
      sleep,
    }),
    [dispatch],
  )

  const patch = (next: Partial<TourState>) => setState(s => ({ ...s, ...next }))

  const stopNarration = () => {
    stopAudio.current?.()
    stopAudio.current = null
  }
  /** `go` is defined after `showStep` but called from it; the ref breaks the cycle. */
  const goRef = useRef<(chapter: TourChapter, index: number) => void>(() => {})
  const go = (chapter: TourChapter, index: number) => goRef.current(chapter, index)

  const showStep = useCallback(
    async (chapter: TourChapter, index: number) => {
      const token = ++run.current
      const live = () => run.current === token
      stopNarration()
      const step = chapter.steps[index]
      if (!step) return
      try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ chapter: chapter.id, index }))
      } catch {
        /* resume after reload is a convenience only */
      }
      patch({
        status: 'running',
        chapter,
        index,
        step,
        target: null,
        locating: true,
        progress: { at: 0, duration: 0 },
      })
      if (step.route && pathRef.current !== step.route) {
        navigateRef.current(step.route)
        await sleep(60)
      }
      if (!live()) return
      // An explicit `waitFor` lets the page mount before the hook touches it. The target itself
      // is awaited only after the hook, since the hook is often what makes it appear.
      if (step.waitFor) await waitFor(step.waitFor, 10_000)
      if (!live()) return
      if (step.skipIf?.(ctx)) return go(chapter, index + 1)
      // Hooks run one after another, even if the visitor skips ahead while one is still working.
      const hook = hooks.current.then(() => step.before?.(ctx)).catch(() => undefined)
      hooks.current = hook
      await hook
      if (!live()) return
      if (step.settle) await sleep(step.settle)
      if (!live()) return
      // `before` may have opened a panel or switched a mode: now wait for the target to appear.
      if (step.target) await waitFor(step.target, 10_000)
      if (!live()) return
      const target = step.target ? document.querySelector(step.target) : null
      if (target && 'scrollIntoView' in target) {
        ;(target as HTMLElement).scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        })
        await sleep(160)
      }
      if (!live()) return
      patch({ target, locating: false, veil: false })
      const shownAt = performance.now()

      const advance = step.advance ?? 'next'
      stopAudio.current = play(step.id, step.say ?? step.text, {
        muted: stateRef.current.muted,
        onProgress: (at, duration) => {
          if (live()) patch({ progress: { at, duration } })
        },
        onEnd: () => {
          if (!live()) return
          stopAudio.current = null
          if (advance === 'auto') {
            // Hold for reading time (or the step's own dwell) before moving on.
            const words = (step.say ?? step.text).trim().split(/\s+/).length
            const minMs = (step.dwell ?? Math.max(6, words * 0.45)) * 1000
            const wait = Math.max(700, minMs - (performance.now() - shownAt))
            window.setTimeout(() => live() && go(chapter, index + 1), wait)
          }
        },
      })

      if (advance === 'click' && target) {
        const done = () => {
          if (!live()) return
          document.removeEventListener('click', onClick, true)
          window.clearInterval(poll)
          window.setTimeout(() => live() && go(chapter, index + 1), 350)
        }
        const onClick = (event: MouseEvent) => {
          const node = event.target as Node | null
          if (!node || !target.contains(node)) return
          if (step.until) return
          done()
        }
        document.addEventListener('click', onClick, true)
        const poll = window.setInterval(() => {
          if (!live()) return window.clearInterval(poll)
          if (step.until?.(ctx)) done()
        }, 200)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx],
  )

  goRef.current = useCallback(
    (chapter: TourChapter, index: number) => {
      if (index >= chapter.steps.length) {
        ++run.current
        stopNarration()
        try {
          window.sessionStorage.removeItem(SESSION_KEY)
        } catch {
          /* ignore */
        }
        patch({ status: 'complete', step: null, target: null, locating: false, index })
        return
      }
      void showStep(chapter, Math.max(0, index))
    },
    [showStep],
  )

  const start = useCallback(
    (chapterId: string, index = 0) => {
      const chapter = chapterById(chapterId)
      if (!chapter) return
      warmVoices()
      if (stateRef.current.status === 'idle') installDemoFixture(dispatch)
      else resetDemoPlan(dispatch)
      // Remount the console so workspaces re-read the fixture instead of keeping stale plans.
      const session = stateRef.current.session + 1
      stateRef.current = { ...stateRef.current, session }
      patch({ session, veil: true })
      // Let the veil fade in before the console remounts behind it.
      window.setTimeout(() => go(chapter, index), 260)
    },
    [dispatch, go],
  )

  const next = useCallback(() => {
    const { chapter, index, status } = stateRef.current
    if (!chapter || status !== 'running') return
    go(chapter, index + 1)
  }, [go])

  const back = useCallback(() => {
    const { chapter, index, status } = stateRef.current
    if (!chapter || status !== 'running' || index === 0) return
    go(chapter, index - 1)
  }, [go])

  const replay = useCallback(() => {
    const { chapter, index, status } = stateRef.current
    if (!chapter || status !== 'running') return
    go(chapter, index)
  }, [go])

  const exit = useCallback(() => {
    ++run.current
    stopNarration()
    try {
      window.sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
    setState(s => ({ ...initial, muted: s.muted, session: s.session + 1 }))
    navigateRef.current('/demo')
    // Restore once the landing page has replaced the console: a workspace that loses its vehicle
    // redirects to the fleet page, which would otherwise win over the navigation above.
    window.setTimeout(() => restoreDemoFixture(dispatch), 80)
  }, [dispatch])

  const setMuted = useCallback(
    (muted: boolean) => {
      try {
        window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
      } catch {
        /* ignore */
      }
      patch({ muted })
      // Restart the current step's narration under the new setting.
      const { chapter, index, status } = stateRef.current
      if (chapter && status === 'running') {
        stateRef.current = { ...stateRef.current, muted }
        go(chapter, index)
      }
    },
    [go],
  )

  // Resume after a reload mid-tour (the fixture backup is still in place).
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY)
      if (!raw) return
      if (pathRef.current === '/demo') {
        // Reloaded on the landing page mid-tour: drop the tour and hand the data back.
        window.sessionStorage.removeItem(SESSION_KEY)
        restoreDemoFixture(dispatch)
        return
      }
      const saved = JSON.parse(raw) as { chapter: string; index: number }
      const chapter = chapterById(saved.chapter)
      if (chapter) {
        stateRef.current = { ...stateRef.current, status: 'running' }
        go(chapter, saved.index)
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard: arrows step, Escape leaves.
  useEffect(() => {
    if (state.status === 'idle') return
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (event.key === 'Escape') exit()
      else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        if (state.status === 'running') next()
      } else if (event.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.status, next, back, exit])

  useEffect(() => () => stopNarration(), [])

  // Marks the document while a tour is up, so demo-only styling (hidden dev aids) can apply.
  useEffect(() => {
    document.body.classList.toggle('wt-active', state.status !== 'idle')
    return () => document.body.classList.remove('wt-active')
  }, [state.status])

  const api = useMemo<TourApi>(
    () => ({ ...state, chapters: CHAPTERS, start, next, back, replay, exit, setMuted }),
    [state, start, next, back, replay, exit, setMuted],
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useWalkthrough() {
  const api = useContext(Ctx)
  if (!api) throw new Error('useWalkthrough must be used inside WalkthroughProvider')
  return api
}
