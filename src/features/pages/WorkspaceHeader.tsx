import { ArrowLeft, Battery, Route, Video, Wifi } from '../../components/icons'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge, TypeIcon, type BadgeTone } from '../../components/common'
import type { Vehicle } from '../../types/domain'
import type { VehicleProfile } from '../vehicles/vehicleProfile'

/**
 * One header for every vehicle workspace (live operations, mission planning): identity on the
 * left, workspace tabs in the middle, the vehicle's health cluster on the right.
 */
export function WorkspaceHeader({
  vehicle,
  profile,
  active,
  backTo,
  lifecycle,
  link,
  battery,
  extra,
}: {
  vehicle: Vehicle
  profile: VehicleProfile
  active: 'live' | 'plan'
  backTo: string
  /** Mission lifecycle badge (e.g. draft, uploaded, in flight, driving). */
  lifecycle?: { label: string; tone: BadgeTone }
  link: number
  battery: number
  extra?: ReactNode
}) {
  return (
    <header className="ws-header">
      <div className="ws-identity">
        <Link to={backTo} className="ws-back" aria-label="Back">
          <ArrowLeft />
        </Link>
        <span className="ws-icon">
          <TypeIcon type={vehicle.type} size={22} />
        </span>
        <div className="ws-title">
          <span>
            {vehicle.id} · {vehicle.controller}
            {vehicle.firmware ? ` ${vehicle.firmware}` : ''}
          </span>
          <h1>{vehicle.name}</h1>
        </div>
      </div>
      <nav className="ws-tabs" aria-label="Workspace">
        {profile.live && (
          <Link to={`/vehicles/${vehicle.id}`} className={active === 'live' ? 'active' : ''}>
            <Video /> {profile.words.liveTab}
          </Link>
        )}
        <Link to={`/missions/${vehicle.id}`} className={active === 'plan' ? 'active' : ''}>
          <Route /> Mission planning
        </Link>
      </nav>
      <div className="ws-status">
        {extra}
        {lifecycle && <StatusBadge status={lifecycle.label} tone={lifecycle.tone} />}
        <StatusBadge status={vehicle.status} />
        <span className="ws-meter" title="Link quality">
          <Wifi size={14} />
          <b>{link}%</b>
        </span>
        <span className="ws-meter" title="Battery">
          <Battery size={14} />
          <b>{battery}%</b>
          <i>
            <em style={{ width: `${battery}%` }} />
          </i>
        </span>
      </div>
    </header>
  )
}
