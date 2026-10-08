import { LocateFixed, LocateOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { placeLabel, useHome, useHomePlace } from './homePosition'

const fmt = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`

/** Where HOME comes from right now: device GPS, vehicle GPS, or the default sector. */
export function HomeSourceChip() {
  const home = useHome()
  const place = useHomePlace()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick(n => n + 1), 5000)
    return () => window.clearInterval(id)
  }, [])
  const age = home.updatedAt ? Math.round((Date.now() - home.updatedAt) / 1000) : null
  const label =
    home.source === 'vehicle'
      ? 'VEHICLE GPS'
      : home.source === 'device'
        ? `DEVICE GPS${home.accuracy ? ` ±${Math.round(home.accuracy)} m` : ''}`
        : 'DEFAULT SECTOR'
  const title = `${placeLabel(place)} · ${fmt(home.lat, home.lng)}${age !== null ? ` · updated ${age}s ago` : ''}${home.error ? ` · ${home.error}` : ''}`
  return (
    <span className={`home-chip ${home.source}`} title={title}>
      {home.source === 'default' ? <LocateOff /> : <LocateFixed />}
      HOME · {label}
    </span>
  )
}
