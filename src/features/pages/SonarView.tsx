import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { TelemetryFrame } from './missionSimulator'
import { BEAMS, BINS, FAN_DEG, PING_MS, RANGE_M, computeReturns } from './sonarMosaic'

/**
 * Forward-looking sonar fan, drawn the way an Oculus or Ping360 screen looks: black water,
 * grey-white returns with speckle, range rings and the craft at the apex. It shows the latest
 * ping only; the picture changes when the next ping lands, never between pings. What the sonar
 * has seen over time is the mosaic on the map, not this tile.
 */
export function SonarView({
  frame,
  underwater,
  gain = 60,
}: {
  frame: TelemetryFrame
  /** Below the surface the fan looks ahead along the bottom; on the surface it looks down. */
  underwater: boolean
  /** Display gain, percent. */
  gain?: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let raf = 0
    let lastPing = 0
    let returns: Float32Array | null = null
    const draw = (now: number) => {
      const f = frameRef.current
      if (!returns || now - lastPing >= PING_MS) {
        lastPing = now
        returns = computeReturns(f, underwater, gain, Math.floor(now / PING_MS))
      }
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      const ctx = el.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const apex = { x: w / 2, y: h - 10 }
      const half = (FAN_DEG / 2) * (Math.PI / 180)
      const radius = Math.min(h - 22, w / (2 * Math.sin(half)) - 6)
      // Returns: one filled sector per beam and bin, greyscale by intensity.
      for (let b = 0; b < BEAMS; b++) {
        const rel = -half + (b / (BEAMS - 1)) * 2 * half
        const a0 = rel - half / (BEAMS - 1)
        const a1 = rel + half / (BEAMS - 1)
        for (let i = 0; i < BINS; i++) {
          const v = returns[b * BINS + i]
          if (v < 0.07) continue
          const r0 = (i / BINS) * radius
          const r1 = ((i + 1) / BINS) * radius
          ctx.beginPath()
          ctx.arc(apex.x, apex.y, r1, a0 - Math.PI / 2, a1 - Math.PI / 2)
          ctx.arc(apex.x, apex.y, r0, a1 - Math.PI / 2, a0 - Math.PI / 2, true)
          ctx.closePath()
          const l = Math.round(18 + v * 82)
          ctx.fillStyle = `hsl(0 0% ${l}%)`
          ctx.fill()
        }
      }
      // Range rings and the fan outline, with the ranges labelled down the left edge.
      ctx.strokeStyle = '#e6d84a'
      ctx.lineWidth = 1
      ctx.font = '600 10px "JetBrains Mono", monospace'
      ctx.fillStyle = '#e6d84a'
      ctx.textAlign = 'right'
      for (let k = 1; k <= 4; k++) {
        const rr = (k / 4) * radius
        ctx.beginPath()
        ctx.arc(apex.x, apex.y, rr, -half - Math.PI / 2, half - Math.PI / 2)
        ctx.stroke()
        ctx.fillText(
          `${(k / 4) * RANGE_M} m`,
          apex.x - rr * Math.sin(half) - 3,
          apex.y - rr * Math.cos(half) + 12,
        )
      }
      for (const a of [-half, half]) {
        ctx.beginPath()
        ctx.moveTo(apex.x, apex.y)
        ctx.lineTo(apex.x + radius * Math.sin(a), apex.y - radius * Math.cos(a))
        ctx.stroke()
      }
      // Own craft at the apex.
      ctx.fillStyle = '#39d0ff'
      ctx.beginPath()
      ctx.moveTo(apex.x, apex.y - 7)
      ctx.lineTo(apex.x - 4, apex.y + 3)
      ctx.lineTo(apex.x + 4, apex.y + 3)
      ctx.closePath()
      ctx.fill()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [underwater, gain])
  return <canvas ref={canvas} className="sonar-view" aria-label="Forward-looking sonar" />
}

/**
 * The sonar as a feed tile beside the camera, with its own full-screen swap. A sonar-payload
 * craft shows it at all times: for a survey boat or a submersible the sonar picture is the
 * primary sensor and the camera the secondary one.
 */
export function SonarFeed({
  frame,
  underwater,
  gain,
  primary,
  slot2,
  onSwap,
}: {
  frame: TelemetryFrame
  underwater: boolean
  gain: number
  /** True when the sonar fills the stage and the 3D map is the picture-in-picture. */
  primary: boolean
  /** Second slot (right of the first tile) while the first is taken. */
  slot2: boolean
  onSwap: () => void
}) {
  const w = frame.water
  const bottom = w ? (underwater ? w.altitudeAboveBottom : w.seabed) : 0
  return (
    <div className={`live-feed sonar${primary ? ' primary' : ''}${slot2 ? ' slot-2' : ''}`}>
      <SonarView frame={frame} underwater={underwater} gain={gain} />
      <div className="lf-hud">
        <div className="lf-top">
          <span className="lf-rec">
            <i /> LIVE · SONAR · FLS {FAN_DEG}° · {RANGE_M} M · 4 HZ
          </span>
          <button onClick={onSwap} title={primary ? 'Back to map view' : 'Full-screen sonar'}>
            {primary ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
        <div className="lf-bottom">
          <span>GAIN {gain}%</span>
          <span>
            {underwater ? 'ALT' : 'UKC'} {bottom.toFixed(1)} m
          </span>
          <span>
            {frame.water?.stationKeeping
              ? 'ON STATION'
              : `HDG ${String(Math.round(frame.heading)).padStart(3, '0')}°`}
          </span>
        </div>
      </div>
      <em className="lf-note">SIMULATED SONAR</em>
    </div>
  )
}
