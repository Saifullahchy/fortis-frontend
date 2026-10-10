import {
  Activity,
  AlertTriangle,
  Anchor,
  Battery,
  Camera,
  CircleStop,
  Compass as CompassIcon,
  Crosshair,
  Gamepad2,
  Gauge,
  History,
  Home,
  LocateFixed,
  Maximize2,
  Mountain,
  Octagon,
  Pause,
  Play,
  PlaneLanding,
  PlaneTakeoff,
  Radio,
  Route as RouteIcon,
  ScanLine,
  Settings2,
  ShieldCheck,
  Target,
  Waves,
} from '../../components/icons'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useGetMissionsQuery } from '../../services/api/baseApi'
import { TypeIcon } from '../../components/common'
import { FloatingPanel, PanelDock } from '../../components/layout/FloatingPanel'
import type { Vehicle } from '../../types/domain'
import { FlightView3D } from './FlightView3D'
import { HomeSourceChip } from './HomeSourceChip'
import {
  AttitudeIndicator,
  Compass,
  Inclinometer,
  LiveFeed,
  TeleopPad,
  type CameraMode,
} from './LiveFlightWidgets'
import { DepthGauge, NavRose } from './MarineWidgets'
import { SonarFeed } from './SonarView'
import { WorkspaceHeader } from './WorkspaceHeader'
import { useHome, useHomeSector } from './homePosition'
import { useStreetNetwork, type ViewRect } from '../map/streetNetwork'
import { HOME, METERS_PER_UNIT } from './missionGeometry'
import { livePlanFor } from './missionPlan'
import {
  ACOUSTIC_STATUS_INTERVAL,
  isActive,
  seabedDepth,
  type TelemetryFrame,
} from './missionSimulator'
import { linkKindFor, useVehicleTelemetry } from './useVehicleTelemetry'
import { profileFor, stageTone, type StripIcon } from '../vehicles/vehicleProfile'

const NO_AREAS: never[] = []
const noop = () => {}
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const timeOfDay = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const STRIP_ICONS: Record<StripIcon, ReactNode> = {
  speed: <Gauge />,
  altitude: <PlaneTakeoff />,
  time: <Activity />,
  gps: <Target />,
  camera: <Camera />,
  grade: <Mountain />,
  odometer: <RouteIcon />,
  elevation: <Mountain />,
  depth: <Waves />,
  course: <CompassIcon />,
  link: <Radio />,
  fix: <LocateFixed />,
  pressure: <Gauge />,
}

/**
 * Live operations for one vehicle: the 3D view with HUD, payload feed, instruments, the command
 * set and alerts. Everything class-specific comes from the vehicle's profile.
 */
export function OperationsWorkspace({ vehicle }: { vehicle: Vehicle }) {
  const profile = profileFor(vehicle.type)
  const air = profile.domain === 'air'
  const under = profile.domain === 'underwater'
  const water = under || profile.domain === 'surface'
  useHomeSector(profile.domain)
  const [maxAltitude, setMaxAltitude] = useState(profile.limits.maxAltitude ?? 0)
  const [maxSpeed, setMaxSpeed] = useState(profile.limits.maxSpeed)
  const [mode, setMode] = useState<CameraMode>('EO')
  const [gimbal, setGimbal] = useState(air ? { pitch: -75, yaw: 0 } : { pitch: -14, yaw: 0 })
  const [view3d, setView3d] = useState(true)
  /** What fills the stage: the map (feeds as picture-in-picture), the camera, or the sonar. */
  const [primary, setPrimary] = useState<'map' | 'camera' | 'sonar'>('map')
  const feedPrimary = primary !== 'map'
  const sonar = profile.payload === 'sonar'
  /** Dive lights, percent (underwater only). */
  const [lights, setLights] = useState(60)
  /** Sonar display gain, percent (water craft). */
  const [sonarGain, setSonarGain] = useState(60)
  const pathRef = useRef<SVGPathElement>(null)
  const home = useHome()
  const [view, setView] = useState<ViewRect | null>(null)
  const streets = useStreetNetwork(profile.streetRouting, view)
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
    profile,
    plan,
    vehicle.battery,
    missionsLoaded && !missionsFetching,
    vehicle.connection,
  )
  const standby = useMemo<TelemetryFrame>(
    () => ({
      position: HOME,
      heading: vehicle.heading,
      altitude: 0,
      groundSpeed: 0,
      distance: 0,
      total: plan?.totalMeters ?? 0,
      progress: 0,
      phase: 'standby',
      battery: vehicle.battery,
      link: vehicle.link,
      satellites: 18,
      elapsedSeconds: 0,
      remainingMeters: plan?.totalMeters ?? 0,
      remainingSeconds: plan && plan.speed ? plan.totalMeters / plan.speed : 0,
      waypoint: { index: 0, total: plan?.waypointCount ?? 0 },
      pitch: 0,
      roll: 0,
      verticalSpeed: 0,
      ...(air
        ? {}
        : {
            ground: { grade: 0, elevation: 0, crossTrack: 0, odometer: 0, driveMode: 'auto' },
            ...(water
              ? {
                  water: {
                    course: vehicle.heading,
                    set: 0,
                    drift: 0,
                    depth: 0,
                    seabed: Math.round(seabedDepth(HOME, METERS_PER_UNIT) * 10) / 10,
                    altitudeAboveBottom: Math.round(seabedDepth(HOME, METERS_PER_UNIT) * 10) / 10,
                    positionError: 1.5,
                    linkAge: 0,
                    linkInterval:
                      linkKindFor(profile.domain, vehicle.connection) === 'acoustic'
                        ? ACOUSTIC_STATUS_INTERVAL
                        : 0,
                    stationKeeping: false,
                    leak: false,
                    internalPressure: 101.3,
                    waterTemp: 24.5,
                  },
                }
              : {}),
          }),
    }),
    [
      vehicle.heading,
      vehicle.battery,
      vehicle.link,
      vehicle.connection,
      plan,
      air,
      water,
      profile.domain,
    ],
  )
  const frame = telemetry.frame ?? standby
  const stage = plan ? telemetry.stage : 'standby'
  const active = isActive(stage)
  const manual = stage === 'manual'
  const minutesLeft = Math.round(frame.battery * (profile.limits.enduranceMin / 100))
  const canTeleop = profile.teleop && vehicle.capabilities.includes('manualControl')

  const alerts = useMemo(
    () =>
      profile.alerts({
        frame,
        stage,
        plan: plan ? { name: plan.mission.name, altitude: plan.altitude, speed: plan.speed } : null,
        limits: { maxAltitude, maxSpeed },
        newerDraft,
      }),
    [profile, frame, stage, plan, maxAltitude, maxSpeed, newerDraft],
  )

  const hudInfo = useMemo(
    () => ({
      details: [
        `${vehicle.controller}${vehicle.firmware ? ` ${vehicle.firmware}` : ''} · ${
          vehicle.board ??
          (profile.model === 'quadcopter'
            ? 'Quadcopter'
            : profile.model === 'rover'
              ? 'Rover'
              : profile.model === 'submersible'
                ? 'Submersible'
                : 'Vessel')
        }`,
        plan
          ? `${plan.mission.name} · ${plan.mission.status === 'ready' ? 'UPLOADED' : 'DRAFT'}`
          : 'NO MISSION',
      ],
    }),
    [vehicle, plan, profile.model],
  )
  const nudge = (dp: number, dy: number) =>
    setGimbal(g => ({
      pitch: air
        ? Math.max(-90, Math.min(0, g.pitch + dp))
        : Math.max(-40, Math.min(20, g.pitch + dp)),
      yaw: Math.max(-90, Math.min(90, g.yaw + dy)),
    }))
  const drive = useCallback(
    (input: { throttle: number; steer: number }) => telemetry.drive(input),
    [telemetry.drive],
  )
  const stageLabel = profile.stages[stage]
  const strip = profile.strip(frame)
  const payloadTitle =
    profile.payload === 'camera'
      ? 'Camera payload'
      : profile.payload === 'lidar'
        ? 'Sensor payload'
        : 'Sonar payload'

  return (
    <div className="drone-workspace">
      <WorkspaceHeader
        vehicle={vehicle}
        profile={profile}
        active="live"
        backTo="/"
        lifecycle={plan ? { label: stageLabel, tone: stageTone(stage) } : undefined}
        link={frame.link}
        battery={frame.battery}
      />

      <div className="drone-flight-layout">
        <section
          className={`drone-primary-view${feedPrimary ? ' feed-primary' : ''}`}
          data-drag-host
          data-tour="live-view"
        >
          <FlightView3D
            profile={profile}
            pathRef={pathRef}
            pathKey={plan?.path ?? ''}
            metersPerUnit={METERS_PER_UNIT}
            altitude={air ? (plan?.altitude ?? maxAltitude) : 0}
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
            network={profile.streetRouting ? streets.network : null}
            basemap={profile.streetRouting ? 'tactical' : 'satellite'}
            onViewChange={profile.streetRouting ? setView : undefined}
            sonarMosaic={sonar ? { key: vehicle.id, gain: sonarGain } : undefined}
            fitRoute
            motion={
              !plan || stage === 'standby' || stage === 'complete' || stage === 'aborted'
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
              <button onClick={() => setPrimary('map')} title="Back to map view">
                <Maximize2 />
              </button>
            </div>
          )}
          <div className="live-topbar">
            <span className={`live-chip stage-${stage}`}>
              <i /> LIVE · {vehicle.id} · {stageLabel}
            </span>
            <HomeSourceChip />
            {profile.streetRouting && (
              <span className={`street-chip ${streets.status}`} title={streets.error}>
                <i />
                {streets.status === 'ready'
                  ? 'MAP DATA · READY'
                  : streets.status === 'error'
                    ? 'MAP DATA · UNAVAILABLE'
                    : `MAP DATA · ${streets.coverage.loaded}/${streets.coverage.wanted} TILES`}
              </span>
            )}
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
            <div className="live-progress" data-tour="live-progress">
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
              {frame.water?.stationKeeping && (
                <span>
                  <label>STATION</label>
                  <b>HOLDING</b>
                </span>
              )}
              <span>
                <label>{air ? 'FLOWN' : water ? 'LOGGED' : 'COVERED'}</label>
                <b>{(frame.distance / 1000).toFixed(2)} km</b>
              </span>
              <span>
                <label>REMAINING</label>
                <b>
                  {(frame.remainingMeters / 1000).toFixed(2)} km · {clock(frame.remainingSeconds)}
                </b>
              </span>
              {frame.ground && frame.ground.driveMode === 'manual' && (
                <span>
                  <label>OFF ROUTE</label>
                  <b>{frame.ground.crossTrack.toFixed(0)} m</b>
                </span>
              )}
              <i className="live-progress-bar">
                <b style={{ width: `${frame.progress * 100}%` }} />
              </i>
            </div>
          )}
          <LiveFeed
            frame={frame}
            mode={mode}
            gimbal={gimbal}
            primary={primary === 'camera'}
            slot2={primary === 'sonar'}
            onSwap={() => setPrimary(p => (p === 'camera' ? 'map' : 'camera'))}
            caption={
              air
                ? `GIMBAL ${gimbal.pitch}°`
                : under
                  ? `TILT ${gimbal.pitch}° · LIGHTS ${lights}%`
                  : `MAST ${gimbal.yaw >= 0 ? '+' : ''}${gimbal.yaw}°`
            }
            underwater={under}
          />
          {sonar && (
            <SonarFeed
              frame={frame}
              underwater={under}
              gain={sonarGain}
              primary={primary === 'sonar'}
              slot2={primary !== 'sonar'}
              onSwap={() => setPrimary(p => (p === 'sonar' ? 'map' : 'sonar'))}
            />
          )}
          <div className="instruments" data-tour="instruments">
            {under && frame.water && (
              <DepthGauge
                depth={frame.water.depth}
                seabed={frame.water.seabed}
                maxDepth={maxAltitude}
                verticalSpeed={frame.verticalSpeed}
              />
            )}
            {profile.instruments === 'attitude' ? (
              <AttitudeIndicator
                pitch={frame.pitch}
                roll={frame.roll}
                climb={water && !under ? undefined : frame.verticalSpeed}
                theme={water ? 'sea' : 'air'}
              />
            ) : (
              <Inclinometer
                pitch={frame.pitch}
                roll={frame.roll}
                grade={frame.ground?.grade ?? 0}
                limit={profile.limits.maxGrade ?? 25}
              />
            )}
            {/* A vessel's compass is the nav rose: heading, course over ground and the current
                that separates them. Everything else keeps the plain compass. */}
            {!under && frame.water ? (
              <NavRose
                heading={frame.heading}
                course={frame.water.course}
                set={frame.water.set}
                drift={frame.water.drift}
                stationKeeping={frame.water.stationKeeping}
              />
            ) : (
              <Compass heading={frame.heading} />
            )}
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
              icon={<TypeIcon type={vehicle.type} size={20} />}
              title={vehicle.name}
              subtitle={`${vehicle.controller} · ${vehicle.protocol}`}
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
                  <label>{profile.words.commandsLabel}</label>
                  <div className="cmd-grid" data-tour="cmd-grid">
                    <CmdButton
                      icon={<ShieldCheck />}
                      label={stage === 'armed' ? `${profile.commands.arm}D` : profile.commands.arm}
                      disabled={!plan || stage !== 'standby'}
                      onClick={telemetry.arm}
                      tour="cmd-arm"
                    />
                    <CmdButton
                      icon={air ? <PlaneTakeoff /> : under ? <Waves /> : <Play />}
                      label={profile.commands.launch}
                      accent
                      disabled={stage !== 'armed'}
                      onClick={telemetry.launch}
                      tour="cmd-launch"
                    />
                    <CmdButton
                      icon={stage === 'holding' ? <Play /> : <Pause />}
                      label={stage === 'holding' ? profile.commands.resume : profile.commands.hold}
                      disabled={!active || manual}
                      onClick={stage === 'holding' ? telemetry.resume : telemetry.hold}
                      tour="cmd-hold"
                    />
                    <CmdButton
                      icon={<Home />}
                      label={profile.commands.return}
                      confirm={`CONFIRM ${profile.commands.return}`}
                      disabled={!active || stage === 'returning'}
                      onClick={telemetry.returnHome}
                      tour="cmd-return"
                    />
                    <CmdButton
                      icon={air ? <PlaneLanding /> : water && !under ? <Anchor /> : <CircleStop />}
                      label={profile.commands.stop}
                      confirm={`CONFIRM ${profile.commands.stop}`}
                      disabled={!active}
                      onClick={telemetry.stop}
                      tour="cmd-stop"
                    />
                    <CmdButton
                      icon={<Octagon />}
                      label={profile.commands.abort}
                      danger
                      confirm={`CONFIRM ${profile.commands.abort}`}
                      disabled={stage === 'standby' || stage === 'aborted' || stage === 'complete'}
                      onClick={telemetry.abort}
                      tour="cmd-abort"
                    />
                  </div>
                  {(stage === 'complete' || stage === 'aborted') && (
                    <button className="mp-btn block" onClick={telemetry.reset}>
                      Reset to standby
                    </button>
                  )}
                </section>
                {canTeleop && (
                  <section>
                    <label>MANUAL CONTROL</label>
                    <div className="mp-row">
                      <button
                        className={`mp-btn${manual ? '' : ' accent'}`}
                        disabled={manual || (stage !== 'active' && stage !== 'holding')}
                        onClick={telemetry.takeControl}
                      >
                        <Gamepad2 /> Take control
                      </button>
                      <button className="mp-btn" disabled={!manual} onClick={telemetry.resumeAuto}>
                        <RouteIcon /> Resume route
                      </button>
                    </div>
                    <TeleopPad active={manual} onDrive={drive} />
                    <p className="mp-hint">
                      {manual
                        ? `WASD or arrow keys ${under ? 'pilot' : water ? 'steer' : 'drive'}; release to stop. Resume route rejoins the plan.`
                        : 'Available while the mission is under way or paused.'}
                    </p>
                  </section>
                )}
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
              subtitle={`${frame.battery}% · ${frame.link}% link · limit ${air || under ? `${maxAltitude} m / ` : ''}${maxSpeed} m/s`}
              defaultOpen={false}
            >
              <div className="mp-body">
                <section>
                  <label>POWER & LINK</label>
                  <div className="drone-power">
                    <Battery />
                    <span>
                      <b>{frame.battery}%</b>
                      <small>
                        {minutesLeft} min remaining
                        {!air && plan
                          ? ` · ~${((minutesLeft * 60 * plan.speed) / 1000).toFixed(1)} km range`
                          : ''}
                      </small>
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
                  <label>
                    {air
                      ? 'FLIGHT LIMITS'
                      : under
                        ? 'DIVE LIMITS'
                        : water
                          ? 'HELM LIMITS'
                          : 'DRIVE LIMITS'}
                  </label>
                  {(air || under) && (
                    <Range
                      label={air ? 'Maximum altitude' : 'Maximum depth'}
                      value={maxAltitude}
                      min={air ? 30 : 5}
                      max={air ? 300 : 100}
                      unit="m"
                      onChange={setMaxAltitude}
                    />
                  )}
                  <Range
                    label="Maximum speed"
                    value={maxSpeed}
                    min={air ? 2 : 1}
                    max={air ? 24 : under ? 5 : 12}
                    unit="m/s"
                    onChange={setMaxSpeed}
                  />
                </section>
                {frame.water && (
                  <section>
                    <label>{under ? 'HULL & WATER' : 'WATER'}</label>
                    <div className="camera-stats">
                      {under && (
                        <span>
                          HULL<b>{frame.water.internalPressure.toFixed(1)} kPa</b>
                        </span>
                      )}
                      {under && (
                        <span>
                          LEAK<b>{frame.water.leak ? 'DETECTED' : 'DRY'}</b>
                        </span>
                      )}
                      <span>
                        WATER<b>{frame.water.waterTemp.toFixed(1)} °C</b>
                      </span>
                      {!under && (
                        <span>
                          CURRENT
                          <b>
                            {(frame.water.drift * 1.944).toFixed(1)} kts ·{' '}
                            {String(frame.water.set).padStart(3, '0')}°
                          </b>
                        </span>
                      )}
                      {!under && (
                        <span>
                          SEABED<b>{frame.water.seabed.toFixed(1)} m</b>
                        </span>
                      )}
                    </div>
                  </section>
                )}
              </div>
            </FloatingPanel>

            <FloatingPanel
              id="camera"
              className="drone-control-panel"
              icon={profile.payload === 'camera' ? <Camera /> : <ScanLine />}
              title={payloadTitle}
              subtitle={`${mode} · ${air ? `gimbal ${gimbal.pitch}°` : under ? `tilt ${gimbal.pitch}° · lights ${lights}%` : `mast ${gimbal.yaw}°`}`}
              defaultOpen={false}
            >
              <div className="mp-body">
                <section>
                  <label>{air ? 'CAMERA PAYLOAD' : under ? 'DIVE CAMERA' : 'MAST CAMERA'}</label>
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
                      {air ? 'GIMBAL' : under ? 'TILT' : 'PAN'}
                      <b>{air || under ? gimbal.pitch : gimbal.yaw}°</b>
                    </span>
                  </div>
                  {under && (
                    <div className="drone-range">
                      <span>
                        <label>Lights</label>
                        <b>{lights}%</b>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={10}
                        value={lights}
                        onChange={e => setLights(Number(e.target.value))}
                      />
                    </div>
                  )}
                </section>
                {profile.payload !== 'camera' && (
                  <section>
                    <label>{profile.payload === 'lidar' ? 'LIDAR' : 'SONAR'}</label>
                    <div className="camera-stats">
                      <span>
                        RANGE
                        <b>{profile.payload === 'lidar' ? '120 m' : under ? '50 m' : '80 m'}</b>
                      </span>
                      <span>
                        RATE<b>{profile.payload === 'lidar' ? '10 Hz' : '4 Hz'}</b>
                      </span>
                      <span>
                        {frame.water ? (under ? 'BOTTOM' : 'DEPTH') : 'NEAREST'}
                        <b>
                          {frame.water
                            ? `${(under ? frame.water.altitudeAboveBottom : frame.water.seabed).toFixed(1)} m`
                            : active
                              ? 'CLEAR'
                              : '—'}
                        </b>
                      </span>
                    </div>
                    {water && (
                      <div className="drone-range">
                        <span>
                          <label>Sonar gain</label>
                          <b>{sonarGain}%</b>
                        </span>
                        <input
                          type="range"
                          min={20}
                          max={100}
                          step={5}
                          value={sonarGain}
                          onChange={e => setSonarGain(Number(e.target.value))}
                        />
                      </div>
                    )}
                  </section>
                )}
                <div className="gimbal-pad">
                  <button onClick={() => nudge(5, 0)}>↑</button>
                  <button onClick={() => nudge(0, -10)}>←</button>
                  <i
                    onClick={() => setGimbal(air ? { pitch: -75, yaw: 0 } : { pitch: -14, yaw: 0 })}
                    title="Centre camera"
                  >
                    <Crosshair />
                  </i>
                  <button onClick={() => nudge(0, 10)}>→</button>
                  <button onClick={() => nudge(-5, 0)}>↓</button>
                </div>
              </div>
            </FloatingPanel>

            <FloatingPanel
              id="timeline"
              className="drone-control-panel"
              icon={<History />}
              title="Mission timeline"
              subtitle={
                telemetry.events.length
                  ? `${telemetry.events.length} events · ${clock(frame.elapsedSeconds)} elapsed`
                  : 'No events yet'
              }
              defaultOpen={false}
            >
              <div className="mp-body">
                <section>
                  <label>STAGE HISTORY</label>
                  {telemetry.events.length === 0 ? (
                    <p className="mp-hint">
                      Stage changes are logged here once the mission starts.
                    </p>
                  ) : (
                    <ol className="timeline">
                      {[...telemetry.events].reverse().map(e => (
                        <li key={e.at} className={`tone-${stageTone(e.stage)}`}>
                          <i />
                          <b>{profile.stages[e.stage]}</b>
                          <small>{timeOfDay(e.at)}</small>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </FloatingPanel>
          </PanelDock>
        </section>

        <footer className="drone-telemetry-strip" data-tour="telemetry-strip">
          {strip.map(item => (
            <Telemetry
              key={item.label}
              icon={STRIP_ICONS[item.icon]}
              label={item.label}
              value={item.value}
            />
          ))}
          <div className={`flight-state stage-${stage}`}>
            <i />
            <span>
              <label>STATE</label>
              <b>{stageLabel}</b>
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
  accent,
  danger,
  disabled,
  onClick,
  tour,
}: {
  icon: ReactNode
  label: string
  confirm?: string
  accent?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  /** Walkthrough anchor (data-tour). */
  tour?: string
}) {
  const [pending, setPending] = useState(false)
  const timer = useRef(0)
  const press = () => {
    if (!confirm) return onClick()
    if (pending) {
      window.clearTimeout(timer.current)
      setPending(false)
      return onClick()
    }
    setPending(true)
    timer.current = window.setTimeout(() => setPending(false), 4000)
  }
  return (
    <button
      className={`cmd-btn${accent ? ' accent' : ''}${danger ? ' danger' : ''}${pending ? ' pending' : ''}`}
      disabled={disabled}
      data-tour={tour}
      onClick={press}
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
