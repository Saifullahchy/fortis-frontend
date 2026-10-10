import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Play } from '../../components/icons'
import { Logo } from '../../components/Logo'
import { play, warmVoices, type Stop } from './narration'
import { useWalkthrough } from './WalkthroughContext'
import { VoicePicker } from './VoicePicker'
import type { TourChapter } from './types'

/**
 * The interactive demo entry: a chapter menu, then a chapter intro card. Modelled on a guided
 * product tour: pick a chapter, hear what it covers, press Get started and the tour drives the
 * real application.
 */
export function DemoLanding() {
  const t = useWalkthrough()
  const [intro, setIntro] = useState<TourChapter | null>(null)
  const stop = useRef<Stop | null>(null)
  const [preview, setPreview] = useState(true)

  useEffect(() => {
    document.title = intro
      ? `${intro.title} · FORTIS interactive demo`
      : 'FORTIS Autonomy Command · Interactive demo'
    return () => {
      document.title = 'Fortis Autonomy Command'
    }
  }, [intro])

  useEffect(() => () => stop.current?.(), [])

  // Landing here while a tour is still up (back button, typed URL) ends it and restores data.
  // Checked once on mount only: a chapter started from this page must not be undone.
  const mountedWith = useRef(t.status)
  const exitRef = useRef(t.exit)
  exitRef.current = t.exit
  useEffect(() => {
    if (mountedWith.current !== 'idle') exitRef.current()
  }, [])

  const openIntro = (chapter: TourChapter) => {
    warmVoices()
    stop.current?.()
    setIntro(chapter)
    if (!t.muted) {
      stop.current = play(
        `${chapter.id}-intro`,
        chapter.say ?? `${chapter.title}. ${chapter.blurb}`,
        {
          muted: false,
          onProgress: () => {},
          onEnd: () => {},
        },
      )
    }
  }
  const menu = () => {
    stop.current?.()
    setIntro(null)
  }
  const begin = (chapter: TourChapter) => {
    stop.current?.()
    t.start(chapter.id)
  }

  const index = intro ? t.chapters.findIndex(c => c.id === intro.id) : -1

  return (
    <div className={`demo-landing${intro ? ' intro' : ''}`}>
      <header className="demo-top">
        <span className="demo-brand">
          <Logo size={22} />
          <b>FORTIS</b>
          <small>AUTONOMY COMMAND</small>
        </span>
        <span className="demo-tag">Interactive demo</span>
        <VoicePicker onChange={() => intro && openIntro(intro)} />
        <Link to="/" className="demo-link">
          Open the console <ChevronRight size={14} />
        </Link>
      </header>

      <main className="demo-stage">
        {!intro ? (
          <section className="demo-hero">
            <div className="demo-mark">
              <Logo size={46} />
            </div>
            <h1>FORTIS Autonomy Command</h1>
            <p>Command autonomous operations across air, ground, surface and underwater.</p>
            <div className="demo-chapters">
              {t.chapters.map((chapter, i) => (
                <button
                  key={chapter.id}
                  className="demo-chapter"
                  onClick={() => openIntro(chapter)}
                >
                  <small>
                    {String(i + 1).padStart(2, '0')} · {chapter.minutes} min
                  </small>
                  <b>{chapter.title}</b>
                </button>
              ))}
            </div>
            <p className="demo-note">
              Narrated tour of mission planning and the live console. Everything runs in simulation.
            </p>
          </section>
        ) : (
          <section className="demo-intro" key={intro.id}>
            <small className="demo-kicker">
              Chapter {String(index + 1).padStart(2, '0')} · {intro.minutes} min
            </small>
            <h1>{intro.title}</h1>
            <p>{intro.blurb}</p>
            <div className="demo-actions">
              <button className="wt-btn primary lg" onClick={() => begin(intro)}>
                <Play size={16} /> Get started
              </button>
              <button className="wt-btn lg" onClick={menu}>
                Main menu
              </button>
            </div>
            <ol className="demo-steps">
              {intro.steps.map(step => (
                <li key={step.id}>{step.title ?? step.text}</li>
              ))}
            </ol>
          </section>
        )}

        {preview && (
          <div className="demo-frame" aria-hidden>
            <img
              src="/walkthrough/preview.jpg"
              width={2880}
              height={1800}
              alt=""
              onError={() => setPreview(false)}
              draggable={false}
            />
          </div>
        )}
      </main>
    </div>
  )
}
