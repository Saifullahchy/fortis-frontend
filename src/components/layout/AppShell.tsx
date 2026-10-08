import { Activity, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Target } from 'lucide-react'
import { Path, Broadcast } from '@phosphor-icons/react'
import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import {
  placeLabel,
  startDeviceHomeTracking,
  useHomePlace,
} from '../../features/pages/homePosition'

const items = [
  ['/', 'Fleet', Broadcast],
  ['/missions', 'Missions', Path],
] as const
const KEY = 'fortis.sidebar.v1'
/** Vehicle workspaces (live flight, planning) are map-first: the rail collapses by default. */
const WORKSPACE = /^\/(vehicles|missions)\/[^/]+/

function readPreference(): boolean | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw === null ? null : raw === 'collapsed'
  } catch {
    return null
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [preference, setPreference] = useState<boolean | null>(readPreference)
  const [collapsed, setCollapsed] = useState(() => readPreference() ?? WORKSPACE.test(pathname))
  const place = useHomePlace()

  useEffect(() => {
    if (preference === null) setCollapsed(WORKSPACE.test(pathname))
  }, [pathname, preference])

  // HOME follows the ground station's GPS until vehicle telemetry supplies its own fix.
  useEffect(() => startDeviceHomeTracking(), [])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    setPreference(next)
    try {
      window.localStorage.setItem(KEY, next ? 'collapsed' : 'expanded')
    } catch {
      /* preference is a convenience only */
    }
  }

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">
            <Target size={21} />
          </div>
          <div className="brand-text">
            <strong>FORTIS</strong>
            <span>AUTONOMY COMMAND</span>
          </div>
        </div>
        <nav>
          {items.map(([to, name, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} title={name}>
              <span className="nav-icon">
                <Icon size={18} weight="regular" />
              </span>
              <span className="nav-label">{name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sysline" title="Platform nominal · all core services online">
            <Activity size={16} />
            <span>
              <b>Platform nominal</b>
              <small>All core services online</small>
            </span>
          </div>
          <button
            className="sidebar-toggle"
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            UNIFIED OPERATIONS <span>/</span>{' '}
            <em title={place?.region ? `${place.region}` : undefined}>{placeLabel(place)}</em>
          </div>
          <div className="top-stats">
            <span>
              <i className="pulse" /> LIVE SIMULATION
            </span>
            <span>UTC+06:00</span>
            <button>
              <SlidersHorizontal size={16} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  )
}
