import {
  ArrowLeft,
  Camera,
  Gamepad2,
  Gauge,
  Home,
  MapPin,
  Octagon,
  PlaneTakeoff,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useGetVehicleQuery } from '../../services/api/baseApi'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { actions } from '../../store'
import { BatteryMeter, LinkMeter, StatusBadge, TypeIcon } from '../../components/common'
import { DroneOperations } from './DroneOperations'
export function VehicleDashboard() {
  const { id = '' } = useParams(),
    { data: v } = useGetVehicleQuery(id),
    d = useAppDispatch(),
    controlled = useAppSelector(s => s.selection.controlledVehicleId === id)
  if (!v) return <div className="empty">Vehicle not found.</div>
  if (v.type === 'UAV') return <DroneOperations vehicle={v} />
  const controls =
    v.type === 'UUV'
      ? [
          [Gauge, 'Dive'],
          [PlaneTakeoff, 'Surface'],
          [Octagon, 'Hold'],
          [Home, 'Abort'],
        ]
      : [
          [Gamepad2, 'Manual'],
          [Octagon, 'Hold'],
          [Home, 'Return base'],
          [MapPin, 'Go to'],
        ]
  return (
    <div className="page">
      <Link className="back" to="/">
        <ArrowLeft />
        BACK TO FLEET
      </Link>
      <div className="dashboard-head">
        <span className="typebox">
          <TypeIcon type={v.type} size={28} />
        </span>
        <div>
          <p>
            {v.type} · {v.controller}
          </p>
          <h1>{v.name}</h1>
          <small>
            {v.id} · {v.protocol} · {v.connection}
          </small>
        </div>
        <StatusBadge status={v.status} />
        <div className="head-actions">
          <button>
            <Camera />
            VIDEO
          </button>
          <button className="primary">
            <MapPin />
            LOCATE ON MAP
          </button>
        </div>
      </div>
      <div className="dash-grid">
        <div className="dash-main">
          <section className="surface metric-block">
            <div className="section-title">
              <div>
                <Gauge />
                LIVE TELEMETRY
              </div>
              <span>12.4 HZ</span>
            </div>
            <div className="big-metrics">
              <div>
                <label>SPEED</label>
                <b>
                  {v.speed}
                  <small>m/s</small>
                </b>
              </div>
              <div>
                <label>{v.type === 'UUV' ? 'DEPTH' : 'ALTITUDE'}</label>
                <b>
                  {v.type === 'UUV' ? '42' : '318'}
                  <small>m</small>
                </b>
              </div>
              <div>
                <label>HEADING</label>
                <b>
                  {v.heading}
                  <small>°</small>
                </b>
              </div>
              <div>
                <label>LINK QUALITY</label>
                <b>
                  {v.link}
                  <small>%</small>
                </b>
              </div>
            </div>
          </section>
          <section className="surface">
            <div className="section-title">
              <div>
                <MapPin />
                POSITION
              </div>
            </div>
            <div className="position-map">
              <i />
              <span>
                23.7806° N<br />
                90.4070° E
              </span>
            </div>
          </section>
          <section className="surface health-grid">
            <div className="section-title">
              <div>
                <ShieldCheck />
                COMPONENT HEALTH
              </div>
              <StatusBadge status={v.health} />
            </div>
            {[
              'Autopilot',
              'Navigation',
              'Primary link',
              'Payload',
              'Power system',
              'Edge computer',
            ].map((x, i) => (
              <div key={x}>
                <span>{x}</span>
                <StatusBadge status={i === 2 && v.link < 70 ? 'warning' : 'healthy'} />
              </div>
            ))}
          </section>
        </div>
        <aside className="dash-side">
          <section className="surface status-card">
            <label>POWER</label>
            <BatteryMeter value={v.battery} />
            <div className="bar">
              <i style={{ width: `${v.battery}%` }} />
            </div>
            <small>Estimated 24 minutes remaining</small>
            <hr />
            <label>PRIMARY LINK</label>
            <b>
              <Radio />
              {v.connection}
              <LinkMeter value={v.link} />
            </b>
          </section>
          <section className="surface control-card">
            <div className="section-title">
              <div>
                <Gamepad2 />
                MANUAL CONTROL
              </div>
            </div>
            <div className={`control-state ${controlled ? 'owned' : ''}`}>
              <i />
              <span>
                <b>{controlled ? 'CONTROL OWNED' : 'OBSERVER MODE'}</b>
                <small>
                  {controlled ? 'Operator: SHIFT-01' : 'Take control to enable commands'}
                </small>
              </span>
            </div>
            {!controlled ? (
              <button className="take-control" onClick={() => d(actions.takeControl(v.id))}>
                TAKE CONTROL
              </button>
            ) : (
              <>
                <div className="control-grid">
                  {controls.map(([Icon, label]) => (
                    <button key={String(label)}>
                      <Icon />
                      {String(label)}
                    </button>
                  ))}
                </div>
                <button className="release" onClick={() => d(actions.takeControl(null))}>
                  RELEASE CONTROL
                </button>
              </>
            )}
            <p>Simulation only. No command is sent to hardware.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
