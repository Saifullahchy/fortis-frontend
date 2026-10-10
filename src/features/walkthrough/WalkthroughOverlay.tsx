import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { ChevronRight, Play, RotateCcw, X } from '../../components/icons'
import { Logo } from '../../components/Logo'
import { measure, sameRect, type Rect } from './dom'
import { useWalkthrough } from './WalkthroughContext'
import { VoicePicker } from './VoicePicker'
import type { Placement } from './types'

const PAD = 8
const CARD_W = 332
const GAP = 14
const EDGE = 12
/** Dim outside the spotlight. Light enough that the map and flight stay readable behind it. */
const SHADE = 0.34

/** Follow an element's box while the overlay is up (panels drag, pages scroll, maps resize). */
function useTargetRect(el: Element | null) {
  const [rect, setRect] = useState<Rect | null>(el ? measure(el) : null)
  // Measure a new element during the same render it arrives, so the card never sees a null box.
  const [tracked, setTracked] = useState(el)
  if (tracked !== el) {
    setTracked(el)
    setRect(el ? measure(el) : null)
  }
  useEffect(() => {
    if (!el) {
      setRect(null)
      return
    }
    let last: Rect | null = null
    const update = () => {
      if (!el.isConnected) return
      const next = measure(el)
      if (!sameRect(last, next)) {
        last = next
        setRect(next)
      }
    }
    update()
    let raf = 0
    const loop = () => {
      update()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [el])
  return rect
}

const pad = (r: Rect): Rect => ({
  top: r.top - PAD,
  left: r.left - PAD,
  width: r.width + PAD * 2,
  height: r.height + PAD * 2,
})

interface Point {
  left: number
  top: number
}

/** Where the callout sits for a given anchor box: beside it where it fits, inside it when huge. */
function place(hole: Rect | null, size: { w: number; h: number }, want: Placement): Point {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!hole) {
    return { left: Math.round((vw - size.w) / 2), top: Math.round(vh * 0.4 - size.h / 2) }
  }
  const fits = {
    right: vw - (hole.left + hole.width) - GAP >= size.w + EDGE,
    left: hole.left - GAP >= size.w + EDGE,
    bottom: vh - (hole.top + hole.height) - GAP >= size.h + EDGE,
    top: hole.top - GAP >= size.h + EDGE,
  }
  const order: Placement[] =
    want === 'auto' ? ['right', 'left', 'bottom', 'top'] : [want, 'right', 'left', 'bottom', 'top']
  const side = order.find(s => s !== 'auto' && fits[s as keyof typeof fits]) ?? 'bottom'
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
  let left: number
  let top: number
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? hole.left + hole.width + GAP : hole.left - GAP - size.w
    top = clamp(hole.top + hole.height / 2 - size.h / 2, EDGE, vh - size.h - EDGE)
  } else {
    top = side === 'bottom' ? hole.top + hole.height + GAP : hole.top - GAP - size.h
    left = clamp(hole.left + hole.width / 2 - size.w / 2, EDGE, vw - size.w - EDGE)
  }
  // Large targets (the whole map) can leave no room on any side: float inside the hole instead.
  if (left < EDGE || top < EDGE || left + size.w > vw - EDGE || top + size.h > vh - EDGE) {
    left = clamp(hole.left + hole.width - size.w - 24, EDGE, vw - size.w - EDGE)
    top = clamp(hole.top + 24, EDGE, vh - size.h - EDGE)
  }
  return { left: Math.round(left), top: Math.round(top) }
}

/**
 * Tween a value toward its goal over a fixed time (not a fixed number of frames), so the motion
 * takes the same ~350 ms whether the display runs at 120 Hz or is throttled. A goal that changes
 * mid-flight restarts from the current position. The first goal appears in place.
 */
function useTween<T>(goal: T | null, mix: (a: T, b: T, t: number) => T, key: string, ms = 350) {
  const [shown, setShown] = useState<T | null>(goal)
  const current = useRef<T | null>(goal)
  const latest = useRef<T | null>(goal)
  latest.current = goal
  useEffect(() => {
    const g = latest.current
    if (!g) {
      current.current = null
      setShown(null)
      return
    }
    const from = current.current
    if (!from) {
      current.current = g
      setShown(g)
      return
    }
    const started = performance.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      current.current = t >= 1 ? g : mix(from, g, eased)
      setShown(current.current)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return shown
}

const mixRect = (a: Rect, b: Rect, t: number): Rect => ({
  top: a.top + (b.top - a.top) * t,
  left: a.left + (b.left - a.left) * t,
  width: a.width + (b.width - a.width) * t,
  height: a.height + (b.height - a.height) * t,
})
const mixPoint = (a: Point, b: Point, t: number): Point => ({
  left: a.left + (b.left - a.left) * t,
  top: a.top + (b.top - a.top) * t,
})
const rectKey = (r: Rect | null) =>
  r ? [r.left, r.top, r.width, r.height].map(Math.round).join(':') : ''
const pointKey = (p: Point | null) => (p ? `${Math.round(p.left)}:${Math.round(p.top)}` : '')

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function WalkthroughOverlay() {
  const t = useWalkthrough()
  const { pathname } = useLocation()
  const raw = useTargetRect(t.target)
  const rawHole = raw && t.status === 'running' ? pad(raw) : null
  /** Last anchor seen on this page: while the next target is located, everything stays put. */
  const lastHole = useRef<Rect | null>(null)
  const lastPath = useRef(pathname)
  if (lastPath.current !== pathname) {
    lastPath.current = pathname
    lastHole.current = null
  }
  if (rawHole) lastHole.current = rawHole
  const anchor = rawHole ?? (t.locating ? lastHole.current : null)
  const hole = useTween(anchor, mixRect, rectKey(anchor))
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: CARD_W, h: 160 })
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const next = { w: el.offsetWidth, h: el.offsetHeight }
    setSize(s => (s.w === next.w && s.h === next.h ? s : next))
  }, [t.step, t.status, t.locating, anchor?.width, anchor?.height])
  /** The card heads straight for its final spot next to the *final* anchor, not the moving ring. */
  const cardGoal =
    t.status === 'running' && t.step && (anchor || !t.locating)
      ? place(anchor, size, t.step.placement ?? 'auto')
      : null
  const cardPos = useTween(cardGoal, mixPoint, pointKey(cardGoal))

  if (t.status === 'idle') return null
  // On the landing page only the veil shows, so a chapter start fades out of the menu cleanly.
  if (pathname === '/demo') {
    return t.veil
      ? createPortal(
          <div className="wt-root">
            <div className="wt-veil on" aria-hidden />
          </div>,
          document.body,
        )
      : null
  }

  const step = t.step
  const chapter = t.chapter
  const advance = step?.advance ?? 'next'
  const clickThrough =
    t.status === 'running' && !!hole && (advance === 'click' || !!step?.interactive)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardStyle: CSSProperties | undefined = cardPos
    ? { left: Math.round(cardPos.left), top: Math.round(cardPos.top) }
    : undefined
  const total = chapter?.steps.length ?? 0
  const pct = t.progress.duration ? Math.min(100, (t.progress.at / t.progress.duration) * 100) : 0
  const chapterIndex = chapter ? t.chapters.findIndex(c => c.id === chapter.id) : -1
  const nextChapter = chapterIndex >= 0 ? t.chapters[chapterIndex + 1] : undefined

  return createPortal(
    <div className="wt-root" aria-live="polite">
      <div className={`wt-veil${t.veil ? ' on' : ''}`} aria-hidden />
      <svg className="wt-shade" width={vw} height={vh} aria-hidden>
        <defs>
          <mask id="wt-mask">
            <rect x="0" y="0" width={vw} height={vh} fill="#fff" />
            {hole && (
              <rect
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx="4"
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={vw}
          height={vh}
          fill="#02060a"
          opacity="0.72"
          mask="url(#wt-mask)"
        />
      </svg>

      {/* Click shields: the whole screen, or everything except the hole on click steps. */}
      {clickThrough && hole ? (
        <>
          <div className="wt-shield" style={{ top: 0, left: 0, width: vw, height: hole.top }} />
          <div
            className="wt-shield"
            style={{
              top: hole.top + hole.height,
              left: 0,
              width: vw,
              height: vh - hole.top - hole.height,
            }}
          />
          <div
            className="wt-shield"
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }}
          />
          <div
            className="wt-shield"
            style={{
              top: hole.top,
              left: hole.left + hole.width,
              width: vw - hole.left - hole.width,
              height: hole.height,
            }}
          />
        </>
      ) : (
        <div className="wt-shield" style={{ inset: 0 }} />
      )}

      {hole && (
        <div
          className={`wt-ring${clickThrough ? ' hot' : ''}`}
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}

      <div className="wt-bar">
        <span className="wt-brand">
          <Logo size={16} /> FORTIS DEMO
        </span>
        {chapter && (
          <span className="wt-chapter">
            {chapter.title}
            {t.status === 'running' && (
              <b>
                {t.index + 1}/{total}
              </b>
            )}
          </span>
        )}
        <VoicePicker compact onChange={t.replay} />
        <button
          className={t.muted ? '' : 'on'}
          onClick={() => t.setMuted(!t.muted)}
          title={t.muted ? 'Sound off' : 'Sound on'}
          aria-label={t.muted ? 'Unmute narration' : 'Mute narration'}
        >
          <SoundIcon muted={t.muted} />
          <span>{t.muted ? 'Sound off' : 'Sound on'}</span>
        </button>
        <button
          onClick={t.replay}
          title="Replay step"
          aria-label="Replay step"
          disabled={t.status !== 'running'}
        >
          <RotateCcw size={14} />
        </button>
        <button onClick={t.exit} title="Exit demo" aria-label="Exit demo">
          <X size={14} />
        </button>
      </div>

      {t.status === 'complete' && chapter && (
        <div className="wt-card wt-complete" ref={cardRef} style={place(null, size, 'auto')}>
          <p className="wt-kicker">Chapter complete</p>
          <h2>{chapter.title}</h2>
          <p className="wt-text">
            {nextChapter
              ? `Up next: ${nextChapter.title}. ${nextChapter.blurb}`
              : 'That is the full tour. Head back to the menu to replay any chapter.'}
          </p>
          <div className="wt-actions">
            {nextChapter && (
              <button className="wt-btn primary" onClick={() => t.start(nextChapter.id)}>
                <Play size={14} /> {nextChapter.title}
              </button>
            )}
            <button className="wt-btn" onClick={() => t.start(chapter.id)}>
              <RotateCcw size={14} /> Replay
            </button>
            <button className="wt-btn" onClick={t.exit}>
              Main menu
            </button>
          </div>
        </div>
      )}

      {t.status === 'running' && step && cardPos && (
        <div
          className={`wt-card${t.locating ? ' locating' : ''}`}
          ref={cardRef}
          style={cardStyle}
          role="dialog"
          aria-label={step.title ?? 'Walkthrough'}
        >
          <div className="wt-body" key={step.id}>
            {step.title && <p className="wt-kicker">{step.title}</p>}
            <p className="wt-text">{step.text}</p>
            {step.items && (
              <ul className="wt-items">
                {step.items.map(item => {
                  const [label, ...rest] = item.split(':')
                  return (
                    <li key={item}>
                      <b>{label.trim()}</b>
                      {rest.length ? <span>{rest.join(':').trim()}</span> : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {(advance === 'click' || step.hint) && (
              <p className="wt-hint">
                <i /> {step.hint ?? 'Click the highlighted control to continue'}
              </p>
            )}
          </div>
          <div className="wt-progress" aria-hidden>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="wt-foot">
            <span className="wt-time">
              {clock(t.progress.at)} / {clock(t.progress.duration)}
            </span>
            <span className="wt-count">
              {t.index + 1} / {total}
            </span>
            <button className="wt-btn" onClick={t.back} disabled={t.index === 0}>
              Back
            </button>
            <button className={`wt-btn${advance === 'click' ? '' : ' primary'}`} onClick={t.next}>
              {t.index + 1 === total ? 'Finish' : advance === 'click' ? 'Skip' : 'Next'}{' '}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {muted ? (
        <path d="m23 9-6 6M17 9l6 6" />
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a9 9 0 0 1 0 14" />
        </>
      )}
    </svg>
  )
}
