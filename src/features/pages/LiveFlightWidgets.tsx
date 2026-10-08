import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TelemetryFrame } from './useMissionSimulation'
import { toGeo } from './MissionHud'
import { METERS_PER_UNIT } from './missionGeometry'
export type CameraMode = 'EO' | 'THERMAL' | 'MAP'
const Z = 17
const GRID = 5

const tileAt = (lat: number, lng: number) => {
  const n = 2 ** Z
  const rad = (lat * Math.PI) / 180
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  }
}

const FILTER: Record<CameraMode, string> = {
  EO: 'none',
  THERMAL: 'grayscale(1) contrast(1.6) brightness(1.1) invert(0.08)',
  MAP: 'saturate(0.35) brightness(0.75) contrast(1.1)',
}

const stamp = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60]
    .map(n => String(n).padStart(2, '0'))
    .join(':')

export function LiveFeed({
  frame,
  mode,
  gimbal,
  primary,
  onSwap,
  caption,
  underwater = false,
  slot2 = false,
}: {
  frame: TelemetryFrame
  mode: CameraMode
  gimbal: { pitch: number; yaw: number }
  /** True when the feed fills the stage and the 3D map is the picture-in-picture. */
  primary: boolean
  onSwap: () => void
  /** Readout for the camera mount, e.g. "GIMBAL -75°" or "MAST +20°". */
  caption?: string
  /** Below the surface: the imagery is tinted and dimmed like a lit water column. */
  underwater?: boolean
  /** Second slot (right of the first tile) while another feed or the map holds the first. */
  slot2?: boolean
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const g = toGeo(frame.position, METERS_PER_UNIT)
  const here = tileAt(g.lat, g.lng)
  const x0 = Math.floor(here.x) - 2
  const y0 = Math.floor(here.y) - 2
  const tiles = Array.from({ length: GRID * GRID }, (_, i) => ({
    x: x0 + (i % GRID),
    y: y0 + Math.floor(i / GRID),
  }))
  const px = (here.x - x0) * 256
  const py = (here.y - y0) * 256
  const rotate = -(frame.heading + gimbal.yaw)
  const zoom = (primary ? 3.2 : 2) * (underwater ? 1.6 : 1)
  const depth = frame.water?.depth ?? 0
  const murk = underwater ? Math.min(0.6, 0.15 + depth / 60) : 0
  const filter = underwater
    ? `${FILTER[mode] === 'none' ? '' : FILTER[mode]} sepia(0.45) hue-rotate(140deg) saturate(1.7) brightness(${(1.15 - murk * 0.5).toFixed(2)}) contrast(1.1)`
    : FILTER[mode]
  return (
    <div
      className={`live-feed${primary ? ' primary' : ''}${underwater ? ' underwater' : ''}${slot2 ? ' slot-2' : ''}`}
    >
      <div className="lf-view" style={{ filter }}>
        <div className="lf-pivot" style={{ transform: `rotate(${rotate}deg) scale(${zoom})` }}>
          <div className="lf-tiles" style={{ transform: `translate(${-px}px, ${-py}px)` }}>
            {tiles.map(t => (
              <img
                key={`${t.x}/${t.y}`}
                alt=""
                draggable={false}
                src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${t.y}/${t.x}`}
                style={{ left: (t.x - x0) * 256, top: (t.y - y0) * 256 }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="lf-hud">
        <div className="lf-top">
          <span className="lf-rec">
            <i /> LIVE · {mode} · 1080P · 24 FPS
          </span>
          <button onClick={onSwap} title={primary ? 'Back to map view' : 'Full-screen feed'}>
            {primary ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
        <div className="lf-reticle">
          <i />
        </div>
        <div className="lf-bottom">
          <span>{caption ?? `GIMBAL ${gimbal.pitch}°`}</span>
          <span>
            {frame.water
              ? underwater
                ? `DEPTH ${frame.water.depth.toFixed(1)} m · ALT ${frame.water.altitudeAboveBottom.toFixed(1)} m`
                : `UKC ${frame.water.seabed.toFixed(1)} m · ${frame.water.waterTemp.toFixed(0)} °C`
              : frame.ground
                ? `GRADE ${frame.ground.grade.toFixed(0)}%`
                : `ALT ${Math.round(frame.altitude)} m`}
          </span>
          <span>{stamp(elapsed)}</span>
        </div>
      </div>
      <em className="lf-note">SIMULATED FEED</em>
    </div>
  )
}

export function Compass({ heading }: { heading: number }) {
  const hdg = ((heading % 360) + 360) % 360
  const ticks = Array.from({ length: 120 }, (_, i) => i * 3)
  const numbers = Array.from({ length: 12 }, (_, i) => i * 30)
  const cardinals: Array<[number, string]> = [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ]
  const inter: Array<[number, string]> = [
    [45, 'NE'],
    [135, 'SE'],
    [225, 'SW'],
    [315, 'NW'],
  ]
  // Eight-point rose behind the needle.
  const rose = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <div className="compass" aria-label={`Heading ${Math.round(hdg)} degrees`}>
      <svg viewBox="-100 -100 200 200">
        <circle r="98" fill="#05080b" />
        {/* Fixed card: the aircraft's nose is the top; the needle swings to true north. */}
        {ticks.map(t => (
          <line
            key={t}
            x1="0"
            y1="-78"
            x2="0"
            y2={t % 30 === 0 ? -68 : t % 15 === 0 ? -71 : -73}
            transform={`rotate(${t})`}
            className={t % 30 === 0 ? 'major' : 'minor'}
          />
        ))}
        {numbers.map(n => (
          <text key={n} transform={`rotate(${n}) translate(0 -89) rotate(${-n})`} className="deg">
            {n}
          </text>
        ))}
        {cardinals.map(([a, l]) => (
          <text
            key={l}
            transform={`rotate(${a}) translate(0 -50) rotate(${-a})`}
            className={`cardinal${l === 'N' ? ' n' : ''}`}
          >
            {l}
          </text>
        ))}
        {inter.map(([a, l]) => (
          <text key={l} transform={`rotate(${a}) translate(0 -54) rotate(${-a})`} className="inter">
            {l}
          </text>
        ))}
        <circle r="34" className="rose-ring" />
        {rose.map(a => (
          <path
            key={a}
            d={a % 90 === 0 ? 'M0 -32 L5 0 L0 32 L-5 0 Z' : 'M0 -22 L4 0 L0 22 L-4 0 Z'}
            transform={`rotate(${a})`}
            className="rose"
          />
        ))}
        {/* Nose marker at the top of the card. */}
        <path d="M0 -94 L-4 -84 L4 -84 Z" className="lubber" />
        <rect x="-1" y="-84" width="2" height="8" className="lubber" />
        {/* Needle: red half to north, white tail to south. */}
        <g transform={`rotate(${-hdg})`}>
          <path d="M0 -44 L-3.5 0 L3.5 0 Z" className="needle-n" />
          <path d="M0 44 L-3.5 0 L3.5 0 Z" className="needle-s" />
          <circle r="4" className="hub" />
        </g>
      </svg>
      <b>{String(Math.round(hdg)).padStart(3, '0')}°</b>
    </div>
  )
}

const ROLL_MARKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]
const PITCH_PX = 2.2 // pixels per degree on the ladder
const clampDeg = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))

/**
 * Attitude indicator (artificial horizon), drawn to the real instrument convention:
 * - the horizon rolls about the centre and slides along the rolled vertical with pitch
 *   (nose-up moves the horizon down, right bank turns it anticlockwise on screen);
 * - the roll scale is fixed to the bezel and a pointer under it turns with the bank;
 * - the aircraft symbol never moves. Angles come straight from telemetry (MAVLink ATTITUDE).
 */
export function AttitudeIndicator({
  pitch,
  roll,
  climb,
  theme = 'air',
}: {
  pitch: number
  roll: number
  /** Vertical speed, m/s, shown beside the attitude readout; omit to hide it. */
  climb?: number
  /** Sea: the lower half is water, the symbol a hull, and the readout says heel and trim. */
  theme?: 'air' | 'sea'
}) {
  const p = clampDeg(pitch, 35)
  const r = clampDeg(roll, 90)
  const sea = theme === 'sea'
  const ladder = [-30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30]
  return (
    <div
      className="attitude"
      role="img"
      aria-label={`Pitch ${Math.round(pitch)} degrees, roll ${Math.round(roll)} degrees`}
    >
      <svg viewBox="-60 -60 120 120">
        <defs>
          <clipPath id="ai-clip">
            <circle r="48" />
          </clipPath>
          <linearGradient id="ai-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1f6fd0" />
            <stop offset="1" stopColor="#5aa8f0" />
          </linearGradient>
          <linearGradient id="ai-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8d5a26" />
            <stop offset="1" stopColor="#4e3012" />
          </linearGradient>
          <linearGradient id="ai-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a7f9a" />
            <stop offset="1" stopColor="#07303f" />
          </linearGradient>
        </defs>
        <g clipPath="url(#ai-clip)">
          <g transform={`rotate(${-r}) translate(0 ${p * PITCH_PX})`}>
            <rect x="-200" y="-320" width="400" height="320" fill="url(#ai-sky)" />
            <rect
              x="-200"
              y="0"
              width="400"
              height="320"
              fill={sea ? 'url(#ai-sea)' : 'url(#ai-ground)'}
            />
            <line x1="-200" x2="200" y1="0" y2="0" stroke="#fff" strokeWidth="1.3" />
            {ladder.map(d => {
              const major = d % 10 === 0
              const w = major ? (Math.abs(d) >= 20 ? 18 : 14) : 6
              const y = -d * PITCH_PX
              return (
                <g key={d}>
                  <line x1={-w} x2={w} y1={y} y2={y} stroke="#fff" strokeWidth={major ? 1 : 0.8} />
                  {major && (
                    <>
                      <text x={-w - 3} y={y + 1.8} textAnchor="end">
                        {Math.abs(d)}
                      </text>
                      <text x={w + 3} y={y + 1.8} textAnchor="start">
                        {Math.abs(d)}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </g>
        </g>
        {/* Roll scale on the bezel. */}
        <g>
          {ROLL_MARKS.map(m =>
            m === 0 ? (
              <path key={m} d="M0 -48 L-3.4 -42 L3.4 -42 Z" fill="#fff" />
            ) : (
              <line
                key={m}
                x1="0"
                y1="-48"
                x2="0"
                y2={Math.abs(m) % 30 === 0 || Math.abs(m) === 45 ? -42 : -44.5}
                transform={`rotate(${m})`}
                stroke="#fff"
                strokeWidth={Math.abs(m) % 30 === 0 ? 1.4 : 1}
              />
            ),
          )}
        </g>
        {/* Bank pointer, turns with the aircraft. */}
        <g transform={`rotate(${-r})`}>
          <path d="M0 -41 L-3.4 -35 L3.4 -35 Z" fill="#ff9f1a" />
        </g>
        {/* Fixed craft symbol: wings for an aircraft, a hull for a boat or submersible. */}
        {sea ? (
          <g fill="none" stroke="#ffd21f" strokeWidth="2.2" strokeLinecap="round">
            <path d="M-28 0 H-14" />
            <path d="M14 0 H28" />
            <path d="M-11 -2 L-8 4 L8 4 L11 -2" />
            <path d="M-3 -2 V-7 H3" />
          </g>
        ) : (
          <g fill="none" stroke="#ffd21f" strokeWidth="2.2" strokeLinecap="round">
            <path d="M-28 0 H-12" />
            <path d="M12 0 H28" />
            <path d="M-9 0 L-4.5 5 L0 0 L4.5 5 L9 0" />
          </g>
        )}
        <circle r="1.7" fill="#ffd21f" />
        <circle r="48" fill="none" stroke="#20292e" strokeWidth="4" />
        <circle r="50" fill="none" stroke="#4a5d69" strokeWidth="1" />
      </svg>
      <b>
        {sea ? 'TRIM' : 'P'} {pitch >= 0 ? '+' : ''}
        {pitch.toFixed(0)}° · {sea ? 'HEEL' : 'R'} {roll >= 0 ? '+' : ''}
        {roll.toFixed(0)}°
        {climb !== undefined &&
          ` · ${Math.abs(climb) < 0.05 ? '→' : climb > 0 ? '↑' : '↓'}${Math.abs(climb).toFixed(1)} m/s`}
      </b>
    </div>
  )
}

/**
 * Inclinometer for ground vehicles: a side-on and head-on silhouette that tilt with the terrain,
 * with the rollover envelope marked. Pitch and roll are the same telemetry an IMU reports.
 */
export function Inclinometer({
  pitch,
  roll,
  grade = 0,
  limit = 25,
}: {
  pitch: number
  roll: number
  /** Slope along the heading, percent. */
  grade?: number
  /** Roll angle at which the warning band starts, degrees. */
  limit?: number
}) {
  const p = clampDeg(pitch, 45)
  const r = clampDeg(roll, 60)
  const warn = Math.abs(roll) > limit
  return (
    <div
      className={`inclinometer${warn ? ' warn' : ''}`}
      role="img"
      aria-label={`Pitch ${Math.round(pitch)} degrees, roll ${Math.round(roll)} degrees`}
    >
      <svg viewBox="-60 -60 120 120">
        <circle r="48" className="dial" />
        {/* Roll envelope: safe arc, warning band and the rollover limits. */}
        {[-limit, limit].map(a => (
          <line
            key={a}
            x1="0"
            y1="-48"
            x2="0"
            y2="-40"
            transform={`rotate(${a})`}
            className="limit"
          />
        ))}
        {ROLL_MARKS.filter(m => Math.abs(m) <= 60).map(m => (
          <line
            key={m}
            x1="0"
            y1="-48"
            x2="0"
            y2={m % 30 === 0 ? -43 : -45.5}
            transform={`rotate(${m})`}
            className="tick"
          />
        ))}
        {/* Head-on view (upper half): rolls with the vehicle. */}
        <g transform={`translate(0 -14) rotate(${r})`}>
          <line x1="-30" x2="30" y1="8" y2="8" className="ground" />
          <rect x="-13" y="-6" width="26" height="9" rx="1.5" className="body" />
          <rect x="-16" y="1" width="6" height="7" rx="1" className="wheel" />
          <rect x="10" y="1" width="6" height="7" rx="1" className="wheel" />
          <rect x="-2" y="-12" width="4" height="6" className="mast" />
        </g>
        {/* Side view (lower half): pitches with the slope. */}
        <g transform={`translate(0 22) rotate(${-p})`}>
          <line x1="-30" x2="30" y1="8" y2="8" className="ground" />
          <rect x="-16" y="-5" width="32" height="8" rx="1.5" className="body" />
          <rect x="10" y="-9" width="6" height="4" className="mast" />
          <circle cx="-9" cy="6" r="4" className="wheel" />
          <circle cx="9" cy="6" r="4" className="wheel" />
        </g>
        <circle r="48" fill="none" stroke="#20292e" strokeWidth="4" />
        <circle r="50" fill="none" stroke="#4a5d69" strokeWidth="1" />
      </svg>
      <b>
        P {pitch >= 0 ? '+' : ''}
        {pitch.toFixed(0)}° · R {roll >= 0 ? '+' : ''}
        {roll.toFixed(0)}° · {grade >= 0 ? '↗' : '↘'}
        {Math.abs(grade).toFixed(0)}%
      </b>
    </div>
  )
}

const KEYS: Record<string, [number, number]> = {
  w: [1, 0],
  arrowup: [1, 0],
  s: [-1, 0],
  arrowdown: [-1, 0],
  a: [0, -1],
  arrowleft: [0, -1],
  d: [0, 1],
  arrowright: [0, 1],
}

/**
 * Teleoperation pad: hold a direction (pointer or WASD / arrows) to drive; release to stop.
 * It is a dead-man control, so a dropped pointer or a blurred window halts the vehicle.
 */
export function TeleopPad({
  active,
  onDrive,
}: {
  active: boolean
  onDrive: (input: { throttle: number; steer: number }) => void
}) {
  const [held, setHeld] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!active) return
    let throttle = 0
    let steer = 0
    held.forEach(k => {
      const [t, s] = KEYS[k] ?? [0, 0]
      throttle += t
      steer += s
    })
    onDrive({
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
    })
  }, [held, active, onDrive])
  useEffect(() => {
    if (!active) return
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!KEYS[k] || (e.target instanceof Element && e.target.closest('input, textarea'))) return
      e.preventDefault()
      setHeld(h => (h.has(k) ? h : new Set(h).add(k)))
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!KEYS[k]) return
      setHeld(h => {
        if (!h.has(k)) return h
        const next = new Set(h)
        next.delete(k)
        return next
      })
    }
    const release = () => setHeld(new Set())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      release()
    }
  }, [active])
  const press = (k: string) => () => setHeld(h => new Set(h).add(k))
  const lift = (k: string) => () =>
    setHeld(h => {
      const next = new Set(h)
      next.delete(k)
      return next
    })
  const btn = (k: string, label: string) => (
    <button
      key={k}
      className={held.has(k) ? 'on' : ''}
      disabled={!active}
      onPointerDown={press(k)}
      onPointerUp={lift(k)}
      onPointerLeave={lift(k)}
      onPointerCancel={lift(k)}
    >
      {label}
    </button>
  )
  return (
    <div className={`teleop-pad${active ? ' active' : ''}`}>
      {btn('w', '▲')}
      {btn('a', '◀')}
      <i>{active ? 'HOLD TO DRIVE' : 'TAKE CONTROL'}</i>
      {btn('d', '▶')}
      {btn('s', '▼')}
    </div>
  )
}
