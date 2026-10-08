import { Battery, Wifi } from 'lucide-react'
import type { Vehicle, VehicleType } from '../types/domain'
export function TypeIcon({ type, size = 18 }: { type: VehicleType; size?: number }) {
  return (
    <span className="domain-icon" style={{ width: size, height: size }}>
      <TacticalGlyph type={type} />
    </span>
  )
}
export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted'
export function StatusBadge({ status, tone }: { status: string; tone?: BadgeTone }) {
  return (
    <span
      className={`badge badge-${status.toLowerCase().replaceAll(' ', '-')}${tone ? ` tone-${tone}` : ''}`}
    >
      <i />
      {status.toUpperCase()}
    </span>
  )
}
export function BatteryMeter({ value }: { value: number }) {
  return (
    <span className="battery">
      <Battery size={15} />
      <b>{value}%</b>
      <span>
        <i style={{ width: `${value}%` }} />
      </span>
    </span>
  )
}
export function LinkMeter({ value }: { value: number }) {
  return (
    <span className="inline">
      <Wifi size={14} />
      {value}%
    </span>
  )
}
function TacticalGlyph({ type }: { type: VehicleType }) {
  if (type === 'UAV')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 3v26M5 16h22M9 9l14 14M23 9L9 23" />
        <circle cx="7" cy="7" r="3" />
        <circle cx="25" cy="7" r="3" />
        <circle cx="7" cy="25" r="3" />
        <circle cx="25" cy="25" r="3" />
        <path className="fill" d="M12 12h8v8h-8z" />
      </svg>
    )
  if (type === 'UGV')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 10h18l3 7-3 7H7l-3-7 3-7Z" />
        <path d="M10 10V7h12v3M11 15h10v5H11z" />
        <circle className="fill" cx="8" cy="25" r="2" />
        <circle className="fill" cx="24" cy="25" r="2" />
      </svg>
    )
  if (type === 'USV')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M4 18h24l-5 8H9l-5-8Z" />
        <path d="M11 18V9h10l4 9M16 9V5M7 28c3-2 5 2 8 0s5 2 10 0" />
      </svg>
    )
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 16c0-5 5-8 11-8s11 3 11 8-5 8-11 8S5 21 5 16Z" />
      <path d="M10 11V7h12v4M8 16h16M3 13v6M29 13v6" />
      <circle className="fill" cx="20" cy="16" r="2" />
    </svg>
  )
}
export function TacticalSymbol({
  vehicle,
  selected = false,
}: {
  vehicle: Vehicle
  selected?: boolean
}) {
  return (
    <div
      className={`tactical-symbol type-${vehicle.type.toLowerCase()} ${selected ? 'selected' : ''} ${vehicle.status}`}
      title={`${vehicle.id} ${vehicle.status}`}
    >
      <span>
        <TacticalGlyph type={vehicle.type} />
      </span>
      <em style={{ transform: `rotate(${vehicle.heading}deg)` }}>
        <i />
      </em>
    </div>
  )
}
