import { ChevronRight, Radio, Search } from '../../components/icons'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BatteryMeter, StatusBadge, TypeIcon } from '../../components/common'
import { useGetMissionsQuery, useGetVehiclesQuery } from '../../services/api/baseApi'
import { useAppDispatch } from '../../store/hooks'
import { actions } from '../../store'
import type { Mission, Vehicle } from '../../types/domain'
import { isActive, simulatorFor, type SimState } from './missionSimulator'
import { modeSpec, profileFor, stageTone } from '../vehicles/vehicleProfile'
import type { PlanMode } from '../../types/domain'

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** Latest simulator state for every vehicle, re-rendering at a readable cadence (not per frame). */
function useSimStates(vehicleIds: string[]) {
  const key = vehicleIds.join(',')
  const [states, setStates] = useState<Record<string, SimState>>({})
  useEffect(() => {
    const ids = key ? key.split(',') : []
    const read = () => Object.fromEntries(ids.map(id => [id, simulatorFor(id).getState()]))
    setStates(read())
    let pending = 0
    const schedule = () => {
      if (pending) return
      pending = window.setTimeout(() => {
        pending = 0
        setStates(read())
      }, 250)
    }
    const stops = ids.map(id => simulatorFor(id).subscribe(schedule))
    return () => {
      stops.forEach(stop => stop())
      window.clearTimeout(pending)
    }
  }, [key])
  return states
}

interface Row {
  mission: Mission
  vehicle: Vehicle
  modeLabel: string
  status: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  live: boolean
  progress: number
  eta: string
  distance: string
  updated: string
}

/**
 * Fleet-wide mission board: every mission across vehicle classes with its live state, plus the
 * vehicle picker that opens a per-vehicle planning workspace.
 */
export function MissionBoard() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { data: vehicles = [] } = useGetVehiclesQuery()
  const { data: missions = [] } = useGetMissionsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  })
  const [query, setQuery] = useState('')
  const sims = useSimStates(vehicles.map(v => v.id))

  const rows = useMemo<Row[]>(
    () =>
      missions
        .map(mission => {
          const vehicle = vehicles.find(v => v.id === mission.vehicleId)
          if (!vehicle) return null
          const profile = profileFor(vehicle.type)
          const sim = sims[vehicle.id]
          const frame = sim?.frame ?? null
          const live = !!frame && sim.stage !== 'standby' && mission.status !== 'idle'
          const mode = mission.plan?.mode
            ? modeSpec(profile, mission.plan.mode as PlanMode).label
            : mission.waypoints.length
              ? 'Waypoints'
              : '—'
          const status = live ? profile.stages[sim.stage] : mission.status
          const tone = live
            ? stageTone(sim.stage)
            : mission.status === 'executing' || mission.status === 'ready'
              ? ('ok' as const)
              : mission.status === 'paused'
                ? ('warn' as const)
                : mission.status === 'aborted' || mission.status === 'failed'
                  ? ('bad' as const)
                  : ('muted' as const)
          const progress = live && frame ? Math.round(frame.progress * 100) : mission.progress
          const eta = live && frame && isActive(sim.stage) ? clock(frame.remainingSeconds) : '—'
          const distance =
            live && frame
              ? `${(frame.distance / 1000).toFixed(2)} / ${(frame.total / 1000).toFixed(2)} km`
              : mission.plan?.transitMeters
                ? `${((mission.waypoints.length ? mission.plan.transitMeters[0] + mission.plan.transitMeters[1] : 0) / 1000).toFixed(2)} km transit`
                : '—'
          const updated = mission.updatedAt
            ? new Date(mission.updatedAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : vehicle.lastSeen
          return {
            mission,
            vehicle,
            modeLabel: mode,
            status,
            tone,
            live,
            progress,
            eta,
            distance,
            updated,
          }
        })
        .filter((row): row is Row => row !== null)
        .filter(row => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return [row.mission.name, row.mission.id, row.vehicle.name, row.vehicle.id, row.status]
            .join(' ')
            .toLowerCase()
            .includes(q)
        })
        .sort((a, b) => Number(b.live) - Number(a.live)),
    [missions, vehicles, sims, query],
  )
  const underWay = rows.filter(
    r => r.live && isActive(sims[r.vehicle.id]?.stage ?? 'standby'),
  ).length
  const executing = rows.filter(r => r.mission.status === 'executing' || r.live).length
  const ready = rows.filter(r => r.mission.status === 'ready' && !r.live).length
  const drafts = rows.filter(r => r.mission.status === 'idle').length
  const available = vehicles.filter(v => v.status !== 'offline').length
  const q = query.trim().toLowerCase()
  const pickable = vehicles.filter(
    v => !q || `${v.name} ${v.id} ${v.type} ${v.mission}`.toLowerCase().includes(q),
  )

  return (
    <div className="mission-select-page">
      <header className="mission-select-head">
        <div>
          <p>MISSION CONTROL</p>
          <h1>Mission board</h1>
          <span>Every mission across the fleet, with live state while it runs.</span>
        </div>
        <div className="mission-select-summary board-summary">
          <b>{underWay}</b>
          <span>UNDER WAY</span>
          <b>{executing}</b>
          <span>ACTIVE</span>
          <b>{ready}</b>
          <span>UPLOADED</span>
          <b>{drafts}</b>
          <span>DRAFTS</span>
          <b>{available}</b>
          <span>AVAILABLE ASSETS</span>
        </div>
      </header>
      {vehicles.length === 0 && (
        <div className="fleet-empty fleet-empty-inline">
          <h2>No vehicles yet</h2>
          <span>Add a vehicle in Fleet to start planning missions.</span>
          <Link className="primary" to="/">
            Go to Fleet
          </Link>
        </div>
      )}
      <div className="mission-search">
        <Search />
        <input
          placeholder="Search vehicle or mission…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <span>{rows.length} MISSIONS</span>
      </div>
      <section className="mission-board" data-tour="mission-board">
        <table>
          <thead>
            <tr>
              <th>Mission</th>
              <th>Vehicle</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Distance</th>
              <th>ETA</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="empty">
                <td colSpan={9}>No missions yet. Pick a vehicle below to plan one.</td>
              </tr>
            )}
            {rows.map(row => {
              const profile = profileFor(row.vehicle.type)
              return (
                <tr key={row.mission.id} className={row.live ? 'live' : ''}>
                  <td>
                    <b>{row.mission.name}</b>
                    <small>{row.mission.id}</small>
                  </td>
                  <td>
                    <span className="board-vehicle">
                      <TypeIcon type={row.vehicle.type} size={18} />
                      <span>
                        <b>{row.vehicle.name}</b>
                        <small>
                          {row.vehicle.id} · {row.vehicle.type}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td>{row.modeLabel}</td>
                  <td>
                    <StatusBadge status={row.status} tone={row.tone} />
                  </td>
                  <td>
                    <span className="board-progress">
                      <i>
                        <b style={{ width: `${row.progress}%` }} />
                      </i>
                      {row.progress}%
                    </span>
                  </td>
                  <td>{row.distance}</td>
                  <td>{row.eta}</td>
                  <td>{row.updated}</td>
                  <td className="board-actions">
                    <Link
                      to={`/missions/${row.vehicle.id}`}
                      data-tour={`mission-plan-${row.vehicle.id}`}
                    >
                      Plan
                    </Link>
                    {profile.live && (
                      <Link
                        to={`/vehicles/${row.vehicle.id}`}
                        data-tour={`mission-live-${row.vehicle.id}`}
                      >
                        Live
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <h2 className="mission-pick-title">Select a vehicle to plan</h2>
      <div className="mission-vehicle-grid">
        {pickable.map(vehicle => {
          const mission = missions.find(item => item.vehicleId === vehicle.id)
          return (
            <button
              key={vehicle.id}
              className="mission-vehicle-card"
              disabled={vehicle.status === 'offline'}
              onClick={() => {
                dispatch(actions.selectVehicle(vehicle.id))
                navigate(`/missions/${vehicle.id}`)
              }}
            >
              <div className="mission-vehicle-top">
                <span className="mission-domain-icon">
                  <TypeIcon type={vehicle.type} size={26} />
                </span>
                <span>
                  <b>{vehicle.name}</b>
                  <small>
                    {vehicle.id} · {vehicle.type}
                  </small>
                </span>
                <StatusBadge status={vehicle.status} />
              </div>
              <div className="mission-assignment">
                <label>{mission ? 'ASSIGNED MISSION' : 'MISSION STATUS'}</label>
                <strong>{mission?.name ?? 'No mission planned'}</strong>
                <small>
                  {mission
                    ? `${mission.status.toUpperCase()} · ${mission.progress}% complete`
                    : 'Open workspace to create a route'}
                </small>
              </div>
              <div className="mission-card-foot">
                <BatteryMeter value={vehicle.battery} />
                <span>
                  <Radio /> {vehicle.connection}
                </span>
                <ChevronRight />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
