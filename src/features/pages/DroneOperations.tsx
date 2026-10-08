import {
  Activity,
  AlertTriangle,
  Battery,
  Camera,
  Crosshair,
  Gauge,
  Maximize2,
  Home,
  Octagon,
  Pause,
  PlaneLanding,
  PlaneTakeoff,
  Play,
  Radio,
  Settings2,
  ShieldCheck,
  Target,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Vehicle } from '../../types/domain'
import { TypeIcon } from '../../components/common'
import { FlightView3D } from './FlightView3D'
import { AttitudeIndicator, Compass, LiveFeed, type CameraMode } from './LiveFlightWidgets'
import { isAirborne, type FlightStage } from './flightSimulator'
import { livePlanFor } from './missionPlan'
import { HOME, METERS_PER_UNIT } from './missionGeometry'
import { useGetMissionsQuery } from '../../services/api/baseApi'
import type { TelemetryFrame } from './useFlightSimulation'
import { useVehicleTelemetry } from './useVehicleTelemetry'
import { WorkspaceHeader } from './WorkspaceHeader'
import { HomeSourceChip } from './HomeSourceChip'
import { useHome } from './homePosition'
import { FloatingPanel, PanelDock } from '../../components/layout/FloatingPanel'

const NO_AREAS: never[] = []
const ENDURANCE_MIN = 35
const noop = () => {}
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

const STAGE_LABEL: Record<FlightStage, string> = {
  standby: 'STANDBY',
  armed: 'ARMED',
  flying: 'IN FLIGHT',
  holding: 'HOLDING',
  returning: 'RETURNING',
  landed: 'LANDED',
  aborted: 'ABORTED',
}

type Alert = { level: 'warn' | 'critical'; text: string }

export function DroneOperations({ vehicle }: { vehicle: Vehicle }) {
  const [maxAltitude, setMaxAltitude] = useState(120)
  const [maxSpeed, setMaxSpeed] = useState(12)
  const [mode, setMode] = useState<CameraMode>('EO')
  const [gimbal, setGimbal] = useState({ pitch: -75, yaw: 0 })
  const [view3d, setView3d] = useState(true)
  /** Swap the stage: map with feed picture-in-picture, or feed full with the map as the PiP. */
  const [feedPrimary, setFeedPrimary] = useState(false)
  const pathRef = useRef<SVGPathElement>(null)
  const home = useHome()
  const {
    data: missions = [],
    isSuccess: missionsLoaded,
    isFetching: missionsFetching,
  } = useGetMissionsQuery(undefined, { refetchOnMountOrArgChange: true })
  const plan = useMemo(() => livePlanFor(missions, vehicle.id), [missions, vehicle.id])
  const newerDraft = useMemo(
    () => missions.some(m => m.vehicleId === vehicle.id && m.plan?.draft && m.status === 'idle'),
    [missions, vehicle.id],
  )
  const telemetry = useVehicleTelemetry(
    vehicle.id,
    plan,
    vehicle.battery,
    missionsLoaded && !missionsFetching,
  )
  const standby = useMemo<TelemetryFrame>(
    () => ({
      position: HOME,
      heading: vehicle.heading,
      altitude: 0,
      groundSpeed: 0,
      distance: 0,
      total: 0,
      progress: 0,
      phase: 'standby',
      battery: vehicle.battery,
      link: vehicle.link,
      satellites: 18,
      flightSeconds: 0,
      remainingMeters: 0,
      remainingSeconds: 0,
      waypoint: { index: 0, total: plan?.waypointCount ?? 0 },
      pitch: 0,
      roll: 0,
      verticalSpeed: 0,
    }),
    [vehicle.heading, vehicle.battery, vehicle.link, plan?.waypointCount],
  )
  const frame = telemetry.frame ?? standby
  const stage = plan ? telemetry.stage : 'standby'
  const airborne = isAirborne(stage)
  const minutesLeft = Math.round(frame.battery * (ENDURANCE_MIN / 100))

  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = []
    if (frame.battery < 20) list.push({ level: 'critical', text: 'Battery critical · land now' })
    else if (frame.battery < 30) list.push({ level: 'warn', text: 'Battery low · plan return' })
    if (frame.link < 50) list.push({ level: 'critical', text: 'Link degraded · failsafe armed' })
    else if (frame.link < 65) list.push({ level: 'warn', text: 'Link weak' })
    if (plan && plan.altitude > maxAltitude)
      list.push({
        level: 'warn',
        text: `Plan altitude ${plan.altitude} m exceeds ${maxAltitude} m limit`,
      })
    if (plan && plan.speed > maxSpeed)
      list.push({
        level: 'warn',
        text: `Plan speed ${plan.speed} m/s exceeds ${maxSpeed} m/s limit`,
      })
    if (newerDraft && plan)
      list.push({ level: 'warn', text: 'Newer plan draft not uploaded · flying previous version' })
    if (stage === 'aborted')
      list.push({ level: 'critical', text: 'Mission aborted · motors stopped' })
    return list
  }, [frame.battery, frame.link, plan, maxAltitude, maxSpeed, newerDraft, stage])

  const hudInfo = useMemo(
    () => ({
      details: [
        `${vehicle.controller}${vehicle.firmware ? ` ${vehicle.firmware}` : ''} · ${vehicle.board ?? 'Quadcopter'}`,
        plan
          ? `${plan.mission.name} · ${plan.mission.status === 'ready' ? 'UPLOADED' : 'DRAFT'}`
          : 'NO MISSION',
      ],
    }),
    [vehicle, plan],
  )
  const nudge = (dp: number, dy: number) =>
    setGimbal(g => ({
      pitch: Math.max(-90, Math.min(0, g.pitch + dp)),
      yaw: Math.max(-90, Math.min(90, g.yaw + dy)),
    }))

  return (
    <div className="drone-workspace">
      <WorkspaceHeader
        vehicle={vehicle}
        active="live"
        backTo="/"
        lifecycle={plan ? STAGE_LABEL[stage].toLowerCase() : undefined}
        link={frame.link}
        battery={frame.battery}
      />

      <div className="drone-flight-layout">
        <section
          className={`drone-primary-view${feedPrimary ? ' feed-primary' : ''}`}
          data-drag-host
        >
          <FlightView3D
            pathRef={pathRef}
            pathKey={plan?.path ?? ''}
            metersPerUnit={METERS_PER_UNIT}
            altitude={plan?.altitude ?? maxAltitude}
            areas={plan?.areas ?? NO_AREAS}
            home={HOME}
            frame={frame}
            trail={telemetry.trail}
            handles={NO_AREAS}
            onMovePoint={noop}
            onAddPoint={noop}
            view3d={view3d}
            gimbal={gimbal}
            callsign={vehicle.id}
            hud={hudInfo}
            originKey={home.key}
            rotors={
              !plan || stage === 'standby' || stage === 'landed' || stage === 'aborted'
                ? 'off'
                : stage === 'armed'
                  ? 'idle'
                  : 'run'
            }
          />
          <svg className="sim-path-source" aria-hidden width="0" height="0">
            <path ref={pathRef} d={plan?.path ?? ''} />
          </svg>
          {feedPrimary && (
            <div className="map-pip">
              <span>
                <i /> 3D MAP · {view3d ? 'TACTICAL' : 'TOP-DOWN'}
              </span>
              <button onClick={() => setFeedPrimary(false)} title="Back to map view">
                <Maximize2 />
              </button>
            </div>
          )}
          <div className="live-topbar">
            <span className={`live-chip stage-${stage}`}>
              <i /> LIVE · {vehicle.id} · {STAGE_LABEL[stage]}
            </span>
            <HomeSourceChip />
            <div className="view-switch" role="group" aria-label="Map view">
              <button className={view3d ? '' : 'on'} onClick={() => setView3d(false)}>
                2D
              </button>
              <button className={view3d ? 'on' : ''} onClick={() => setView3d(true)}>
                3D
              </button>
            </div>
          </div>
          {plan && (
            <div className="live-progress">
              <span>
                <label>MISSION</label>
                <b>{plan.mission.name}</b>
              </span>
              {frame.waypoint.total > 0 && (
                <span>
                  <label>WAYPOINT</label>
                  <b>
                    {frame.waypoint.index} / {frame.waypoint.total}
                  </b>
                </span>
              )}
              <span>
                <label>FLOWN</label>
                <b>{(frame.distance / 1000).toFixed(2)} km</b>
              </span>
              <span>
                <label>REMAINING</label>
                <b>
                  {(frame.remainingMeters / 1000).toFixed(2)} km · {clock(frame.remainingSeconds)}
                </b>
              </span>
              <i className="live-progress-bar">
                <b style={{ width: `${frame.progress * 100}%` }} />
              </i>
            </div>
          )}
          <LiveFeed
            frame={frame}
            mode={mode}
            gimbal={gimbal}
            primary={feedPrimary}
            onSwap={() => setFeedPrimary(p => !p)}
          />
          <div className="instruments">
            <AttitudeIndicator pitch={frame.pitch} roll={frame.roll} climb={frame.verticalSpeed} />
            <Compass heading={frame.heading} />
          </div>
          {!plan && (
            <div className="live-empty">
              {newerDraft
                ? 'Plan saved but not uploaded to the vehicle.'
                : 'No mission planned for this vehicle.'}
              <Link to={`/missions/${vehicle.id}`}>
                {newerDraft ? 'Upload in planning' : 'Plan a mission'}
              </Link>
            </div>
          )}
          <PanelDock>
            <FloatingPanel
              id="commands"
              className="drone-control-panel"
              icon={<TypeIcon type="UAV" size={20} />}
              title={vehicle.name}
              subtitle={`${vehicle.controller} · ${vehicle.protocol} flight controller`}
              actions={
                <Link
                  className="mp-icon-btn"
                  to={`/missions/${vehicle.id}`}
                  title="Open mission planning"
                >
                  <Settings2 />
                </Link>
              }
            >
              <div className="mp-body">
                <section>
                  <label>FLIGHT COMMANDS</label>
                  <div className="cmd-grid">
                    <CmdButton
                      icon={<ShieldCheck />}
                      label={stage === 'armed' ? 'ARMED' : 'ARM'}
                      disabled={!plan || stage !== 'standby'}
                      onClick={telemetry.arm}
                    />
                    <CmdButton
                      icon={<PlaneTakeoff />}
                      label="TAKEOFF"
                      accent
                      disabled={stage !== 'armed'}
                      onClick={telemetry.takeoff}
                    />
                    <CmdButton
                      icon={stage === 'holding' ? <Play /> : <Pause />}
                      label={stage === 'holding' ? 'RESUME' : 'HOLD'}
                      disabled={!airborne}
                      onClick={stage === 'holding' ? telemetry.resume : telemetry.hold}
                    />
                    <CmdButton
                      icon={<Home />}
                      label="RTL"
                      confirm="CONFIRM RTL"
                      disabled={!airborne || stage === 'returning'}
                      onClick={telemetry.returnHome}
                    />
                    <CmdButton
                      icon={<PlaneLanding />}
                      label="LAND"
                      confirm="CONFIRM LAND"
                      disabled={!airborne}
                      onClick={telemetry.land}
                    />
                    <CmdButton
                      icon={<Octagon />}
                      label="ABORT"
                      danger
                      confirm="CONFIRM ABORT"
                      disabled={stage === 'standby' || stage === 'aborted' || stage === 'landed'}
                      onClick={telemetry.abort}
                    />
                  </div>
                  {(stage === 'landed' || stage === 'aborted') && (
                    <button className="mp-btn block" onClick={telemetry.reset}>
                      Reset to standby
                    </button>
                  )}
                </section>
                <section>
                  <label>ALERTS</label>
                  {alerts.length === 0 ? (
                    <div className="alert-row ok">
                      <ShieldCheck /> No active warnings
                    </div>
                  ) : (
                    alerts.map(a => (
                      <div key={a.text} className={`alert-row ${a.level}`}>
                        <AlertTriangle /> {a.text}
                      </div>
                    ))
                  )}
                </section>
              </div>
            </FloatingPanel>

            <FloatingPanel
              id="status"
              className="drone-control-panel"
              icon={<Battery />}
              title="Vehicle status"
              subtitle={`${frame.battery}% · ${frame.link}% link · limits ${maxAltitude} m / ${maxSpeed} m/s`}
              defaultOpen={false}
            >
              <div className="mp-body">
                <section>
                  <label>POWER & LINK</label>
                  <div className="drone-power">
                    <Battery />
                    <span>
                      <b>{frame.battery}%</b>
                      <small>{minutesLeft} min remaining</small>
                    </span>
                  </div>
                  <div className={`bar${frame.battery < 30 ? ' low' : ''}`}>
                    <i style={{ width: `${frame.battery}%` }} />
                  </div>
                  <div className="drone-link">
                    <Radio /> {vehicle.connection}
                    <b>{frame.link}%</b>
                  </div>
                </section>
                <section>
                  <label>FLIGHT LIMITS</label>
                  <Range
                    label="Maximum altitude"
                    value={maxAltitude}
                    min={30}
                    max={300}
                    unit="m"
                    onChange={setMaxAltitude}
                  />
                  <Range
                    label="Maximum speed"
                    value={maxSpeed}
                    min={2}
                    max={24}
                    unit="m/s"
                    onChange={setMaxSpeed}
                  />
                </section>
              </div>
            </FloatingPanel>

            <FloatingPanel
              id="camera"
              className="drone-control-panel"
              icon={<Camera />}
              title="Camera payload"
              subtitle={`${mode} · gimbal ${gimbal.pitch}°`}
              defaultOpen={false}
            >
              <div className="mp-body">
                <section>
                  <label>CAMERA PAYLOAD</label>
                  <div className="camera-modes">
                    {(['EO', 'THERMAL', 'MAP'] as CameraMode[]).map(m => (
                      <button
                        key={m}
                        className={mode === m ? 'active' : ''}
                        onClick={() => setMode(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div className="camera-stats">
                    <span>
                      ISO<b>400</b>
                    </span>
                    <span>
                      SHUTTER<b>1/800</b>
                    </span>
                    <span>
                      GIMBAL<b>{gimbal.pitch}°</b>
                    </span>
                  </div>
                </section>
                <div className="gimbal-pad">
                  <button onClick={() => nudge(5, 0)}>↑</button>
                  <button onClick={() => nudge(0, -10)}>←</button>
                  <i onClick={() => setGimbal({ pitch: -75, yaw: 0 })} title="Centre gimbal">
                    <Crosshair />
                  </i>
                  <button onClick={() => nudge(0, 10)}>→</button>
                  <button onClick={() => nudge(-5, 0)}>↓</button>
                </div>
              </div>
            </FloatingPanel>
          </PanelDock>
        </section>

        <footer className="drone-telemetry-strip">
          <Telemetry
            icon={<Gauge />}
            label="GROUND SPEED"
            value={`${frame.groundSpeed.toFixed(0)} m/s`}
          />
          <Telemetry
            icon={<PlaneTakeoff />}
            label="ALTITUDE"
            value={`${Math.round(frame.altitude)} m`}
          />
          <Telemetry icon={<Activity />} label="FLIGHT TIME" value={clock(frame.flightSeconds)} />
          <Telemetry icon={<Target />} label="GPS" value={`RTK FIX · ${frame.satellites}`} />
          <Telemetry
            icon={<Camera />}
            label="CAPTURED"
            value={`${Math.floor(frame.distance / 12)} frames`}
          />
          <div className={`flight-state stage-${stage}`}>
            <i />
            <span>
              <label>STATE</label>
              <b>{STAGE_LABEL[stage]}</b>
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Destructive commands ask once: first click arms the confirm, second within 4 s fires. */
function CmdButton({
  icon,
  label,
  confirm,
  disabled,
  accent,
  danger,
  onClick,
}: {
  icon: ReactNode
  label: string
  confirm?: string
  disabled?: boolean
  accent?: boolean
  danger?: boolean
  onClick: () => void
}) {
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!pending) return
    const t = window.setTimeout(() => setPending(false), 4000)
    return () => window.clearTimeout(t)
  }, [pending])
  useEffect(() => {
    if (disabled) setPending(false)
  }, [disabled])
  const cls = ['cmd-btn', accent && 'accent', danger && 'danger', pending && 'pending']
    .filter(Boolean)
    .join(' ')
  return (
    <button
      className={cls}
      disabled={disabled}
      onClick={() => {
        if (confirm && !pending) {
          setPending(true)
          return
        }
        setPending(false)
        onClick()
      }}
    >
      {icon}
      {pending ? confirm : label}
    </button>
  )
}

function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <div className="drone-range">
      <span>
        <label>{label}</label>
        <b>
          {value} {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}
function Telemetry({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="drone-telemetry">
      <span>{icon}</span>
      <p>
        <label>{label}</label>
        <b>{value}</b>
      </p>
    </div>
  )
}
