import { Crosshair, Layers3, LocateFixed, Minus, Navigation, Plus, ScanLine } from '../../components/icons'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { actions } from '../../store'
import { useGetVehiclesQuery } from '../../services/api/baseApi'
import { TacticalSymbol } from '../../components/common'
import { CesiumCanvas, type ViewBounds } from './cesium/CesiumCanvas'
import type { Vehicle } from '../../types/domain'
import { useState } from 'react'

function Entity({ v }: { v: Vehicle }) {
  const d = useAppDispatch(),
    selected = useAppSelector(s => s.selection.selectedVehicleId === v.id)
  return (
    <button
      className={`entity ${selected ? 'entity-selected' : ''}`}
      style={{ left: `${v.lng}%`, top: `${v.lat}%` }}
      onClick={() => d(actions.selectVehicle(v.id))}
    >
      <TacticalSymbol vehicle={v} selected={selected} />
      <span>
        {v.id}
        <small>
          {v.mode} · {v.battery}%
        </small>
      </span>
    </button>
  )
}

export function CommandMap({
  compact = false,
  vehicleIds,
  showTacticalOverlays = true,
  focus,
  onView,
}: {
  compact?: boolean
  vehicleIds?: string[]
  showTacticalOverlays?: boolean
  focus?: { lng: number; lat: number; height: number }
  onView?: (bounds: ViewBounds | null) => void
}) {
  const { data = [] } = useGetVehiclesQuery(),
    map = useAppSelector(s => s.map),
    selectedVehicleId = useAppSelector(s => s.selection.selectedVehicleId),
    d = useAppDispatch()
  const [zoomStep, setZoomStep] = useState(0),
    [layersOpen, setLayersOpen] = useState(false)
  const visibleVehicles = vehicleIds ? data.filter(v => vehicleIds.includes(v.id)) : data
  return (
    <section className={`map-panel ${compact ? 'map-compact' : ''}`}>
      <div className="map-canvas">
        <CesiumCanvas
          mode={map.mode}
          camera={map.camera}
          selectedVehicleId={selectedVehicleId}
          zoomStep={zoomStep}
          focus={focus}
          onView={onView}
        />
        <div className="grid" />
        {showTacticalOverlays && map.layers.includes('missions') && (
          <svg className="route-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M19 80 L38 46 L53 53 L69 31" />
            {map.layers.includes('geofences') && (
              <path className="restricted" d="M68 74 C75 59 90 61 92 77 C84 91 72 88 68 74Z" />
            )}
          </svg>
        )}
        {map.layers.includes('vehicles') && visibleVehicles.map(v => <Entity key={v.id} v={v} />)}
        <div className="north">
          <Navigation size={17} /> N
        </div>
        <div className="scale">2 km</div>
        <div className="zoom">
          <button aria-label="Zoom in" onClick={() => setZoomStep(x => x + 1)}>
            <Plus />
          </button>
          <button aria-label="Zoom out" onClick={() => setZoomStep(x => x - 1)}>
            <Minus />
          </button>
        </div>
      </div>
      <div className="map-top">
        <div className="segmented">
          {(['TACTICAL', 'SATELLITE', 'TERRAIN', '3D'] as const).map(x => (
            <button
              className={map.mode === x ? 'active' : ''}
              onClick={() => {
                d(actions.setMapMode(x))
                if (x === '3D') d(actions.setCamera('3D'))
              }}
              key={x}
            >
              {x}
            </button>
          ))}
        </div>
        <button className="tool" onClick={() => setLayersOpen(x => !x)}>
          <Layers3 size={16} />
          LAYERS <b>{map.layers.length}</b>
        </button>
      </div>
      {layersOpen && (
        <div className="layer-menu">
          {[
            ['vehicles', 'Vehicle symbols'],
            ['missions', 'Mission routes'],
            ['geofences', 'Restricted zones'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => d(actions.toggleLayer(id))}>
              <i className={map.layers.includes(id) ? 'on' : ''} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="map-bottom">
        <div className="segmented">
          {(['TOP', '3D', 'FOLLOW'] as const).map(x => (
            <button
              className={map.camera === x ? 'active' : ''}
              onClick={() => d(actions.setCamera(x))}
              key={x}
            >
              {x === 'TOP' ? <Crosshair /> : x === '3D' ? <ScanLine /> : <LocateFixed />}
              {x}
            </button>
          ))}
        </div>
        <span>23.7806° N · 90.4070° E</span>
      </div>
    </section>
  )
}
