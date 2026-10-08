import { ArrowLeft, Battery, Route, Video, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge, TypeIcon } from '../../components/common'
import type { Vehicle } from '../../types/domain'

/**
 * One header for every vehicle workspace (Live Flight, Mission Planning): identity on the left,
 * workspace tabs in the middle, the vehicle's health cluster on the right.
 */
export function WorkspaceHeader({
  vehicle,
  active,
  backTo,
  lifecycle,
  link,
  battery,
  extra,
}: {
  vehicle: Vehicle
  active: 'live' | 'plan'
  backTo: string
  /** Mission lifecycle word shown as the leading badge (e.g. draft, uploaded, in flight). */
  lifecycle?: string
  link: number
  battery: number
  extra?: ReactNode
}) {
  const tabs = vehicle.type === 'UAV'
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
      {tabs && (
        <nav className="ws-tabs" aria-label="Workspace">
          <Link to={`/vehicles/${vehicle.id}`} className={active === 'live' ? 'active' : ''}>
            <Video /> Live flight
          </Link>
          <Link to={`/missions/${vehicle.id}`} className={active === 'plan' ? 'active' : ''}>
            <Route /> Mission planning
          </Link>
        </nav>
      )}
      <div className="ws-status">
        {extra}
        {lifecycle && <StatusBadge status={lifecycle} />}
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
