import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Point } from './missionGeometry'
import type { TelemetrySource } from './useFlightSimulation'

/** Geographic anchor of the planning grid; moved by setMissionOrigin() to follow the home fix. */
const ORIGIN = { lat: 23.81, lng: 90.36 }
export function setMissionOrigin(lat: number, lng: number) {
  ORIGIN.lat = lat
  ORIGIN.lng = lng
}
export const getMissionOrigin = () => ({ ...ORIGIN })
const RATES = [1, 4, 10, 25]

export const toGeo = (p: Point, metersPerUnit: number) => {
  const lat = ORIGIN.lat - ((p.y - 350) * metersPerUnit) / 111320
  const lng =
    ORIGIN.lng + ((p.x - 500) * metersPerUnit) / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180))
  return { lat, lng }
}
export const fromGeo = (lat: number, lng: number, metersPerUnit: number): Point => ({
  x: 500 + ((lng - ORIGIN.lng) * 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)) / metersPerUnit,
  y: 350 - ((lat - ORIGIN.lat) * 111320) / metersPerUnit,
})
const fmtGeo = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

function useFps() {
  const [fps, setFps] = useState(60)
  useEffect(() => {
    let raf = 0
    let frames = 0
    let since = performance.now()
    const tick = (now: number) => {
      frames += 1
      if (now - since >= 1000) {
        setFps(Math.round((frames * 1000) / (now - since)))
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}

export function MapStatusStrip({
  cursor,
  metersPerUnit,
}: {
  cursor: Point | null
  metersPerUnit: number
}) {
  const fps = useFps()
  const geo = cursor ? toGeo(cursor, metersPerUnit) : null
  return (
    <div className="map-status-strip">
      <span className="mss-coords">{geo ? fmtGeo(geo.lat, geo.lng) : '— — —'}</span>
      <span className="mss-fps">{fps} FPS</span>
      <span className="mss-credit">Esri World Imagery · FORTIS</span>
    </div>
  )
}

export function SimulationHud({
  sim,
  disabled,
  view3d,
  onSetView,
}: {
  sim: TelemetrySource
  disabled: boolean
  view3d: boolean
  onSetView: (view3d: boolean) => void
}) {
  const f = sim.frame
  const eta = f && f.groundSpeed ? (f.total - f.distance) / f.groundSpeed : 0
  return (
    <div className="sim-hud">
      <div className="sim-head">
        <span className={`sim-phase ${f?.phase ?? 'standby'}`}>
          SIM · {(f?.phase ?? 'standby').toUpperCase()}
        </span>
        <div className="sim-rates">
          {RATES.map(r => (
            <button key={r} className={sim.rate === r ? 'on' : ''} onClick={() => sim.setRate(r)}>
              {r}×
            </button>
          ))}
        </div>
        <div className="view-switch" role="group" aria-label="Map view">
          <button className={view3d ? '' : 'on'} onClick={() => onSetView(false)}>
            2D
          </button>
          <button className={view3d ? 'on' : ''} onClick={() => onSetView(true)}>
            3D
          </button>
        </div>
        <button
          className="sim-btn"
          disabled={disabled}
          onClick={sim.playing ? sim.pause : sim.play}
          title={sim.playing ? 'Pause simulation' : 'Fly planned route'}
        >
          {sim.playing ? <Pause /> : <Play />}
        </button>
        <button className="sim-btn" disabled={disabled} onClick={sim.reset} title="Reset">
          <RotateCcw />
        </button>
      </div>
      <div className="sim-bar">
        <i style={{ width: `${(f?.progress ?? 0) * 100}%` }} />
      </div>
      <dl>
        <div>
          <dt>ALT</dt>
          <dd>{f?.altitude ?? 0} m</dd>
        </div>
        <div>
          <dt>GS</dt>
          <dd>{(f?.groundSpeed ?? 0).toFixed(0)} m/s</dd>
        </div>
        <div>
          <dt>HDG</dt>
          <dd>{String(Math.round(f?.heading ?? 0)).padStart(3, '0')}°</dd>
        </div>
        <div>
          <dt>DIST</dt>
          <dd>
            {((f?.distance ?? 0) / 1000).toFixed(2)} / {((f?.total ?? 0) / 1000).toFixed(2)} km
          </dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd>{clock(eta)}</dd>
        </div>
      </dl>
    </div>
  )
}
