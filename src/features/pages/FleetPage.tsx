import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Plus, Radio, Route, RotateCcw, Trash2, X } from '../../components/icons'
import {
  useAddVehicleMutation,
  useGetVehiclesQuery,
  useLoadDemoFleetMutation,
  useRemoveVehicleMutation,
} from '../../services/api/baseApi'
import { BatteryMeter, StatusBadge, TypeIcon } from '../../components/common'
import type { VehicleType } from '../../types/domain'

const TYPES: Array<{ type: VehicleType; title: string; hint: string }> = [
  { type: 'UAV', title: 'Aerial', hint: 'Drones, multirotor, fixed-wing' },
  { type: 'UGV', title: 'Ground', hint: 'Rovers, tracked and wheeled robots' },
  { type: 'USV', title: 'Surface', hint: 'Boats and surface vessels' },
  { type: 'UUV', title: 'Underwater', hint: 'ROVs and underwater vehicles' },
]

const CONTROLLERS: Record<VehicleType, string[]> = {
  UAV: ['PX4', 'ArduPilot', 'Custom'],
  UGV: ['ROS 2 / Nav2', 'ArduPilot Rover', 'Custom'],
  USV: ['ArduPilot Boat', 'ROS 2', 'Custom'],
  UUV: ['ArduSub', 'ROS 2', 'Custom'],
}
const PROTOCOLS = ['MAVLink', 'ROS 2', 'DDS', 'Custom']
const LINKS: Record<VehicleType, string[]> = {
  UAV: ['RF', 'RF + 4G', 'Cellular', 'Satellite'],
  UGV: ['RF', 'Cellular', '5G', 'Mesh'],
  USV: ['RF', 'Cellular', 'Satellite'],
  UUV: ['Acoustic', 'Tether', 'RF (surface)'],
}
const BOARDS: Record<VehicleType, string[]> = {
  UAV: [
    'Pixhawk 6X',
    'Pixhawk 6C',
    'Cube Orange+',
    'Holybro Durandal',
    'CUAV X7+',
    'Matek H743-SLIM',
    'Jetson Orin Nano',
  ],
  UGV: ['Pixhawk 6C', 'Cube Orange+', 'Jetson Orin Nano', 'Raspberry Pi 5', 'Clearpath Husky PC'],
  USV: ['Pixhawk 6C', 'Cube Orange+', 'Navigator (BlueOS)', 'Jetson Orin Nano', 'Raspberry Pi 5'],
  UUV: ['Navigator (BlueOS)', 'Pixhawk 6C', 'Cube Orange+', 'Jetson Orin Nano'],
}
const versionsFor = (controller: string) => {
  if (controller.includes('PX4')) return ['1.15.2', '1.16.0-beta', 'main']
  if (controller.includes('ROS')) return ['Jazzy', 'Kilted', 'Rolling']
  if (controller === 'Custom') return ['1.0.0', '1.1.0-beta', 'main']
  return ['4.7.1', '4.7.2', 'master']
}
const CHANNELS = ['Stable', 'Beta', 'Latest']
const STEPS = ['Vehicle', 'Firmware', 'Board', 'Connect']

function AddVehicle({
  initial,
  chosen,
  onClose,
}: {
  initial: VehicleType
  chosen: boolean
  onClose: () => void
}) {
  const [add, { isLoading }] = useAddVehicleMutation()
  const [step, setStep] = useState(chosen ? 1 : 0)
  const [type, setType] = useState<VehicleType>(initial)
  const [controller, setController] = useState('')
  const [version, setVersion] = useState('')
  const [board, setBoard] = useState('')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState('MAVLink')
  const [connection, setConnection] = useState(LINKS[initial][0])

  const pickType = (next: VehicleType) => {
    setType(next)
    setController('')
    setVersion('')
    setBoard('')
    setConnection(LINKS[next][0])
    setStep(1)
  }
  const pickController = (c: string) => {
    setController(c)
    setVersion('')
    setProtocol(c.includes('ROS') ? 'ROS 2' : 'MAVLink')
  }
  const goTo = (target: number) => setStep(target)
  const done = [step > 0, step > 1, step > 2, false]
  const boards = BOARDS[type].filter(b => b.toLowerCase().includes(search.toLowerCase()))
  const versions = controller ? versionsFor(controller) : []

  return (
    <div className="fleet-modal" role="dialog" aria-label="Add vehicle">
      <form
        className="fleet-add"
        onSubmit={async event => {
          event.preventDefault()
          await add({
            name,
            type,
            controller,
            firmware: version,
            board,
            protocol,
            connection,
          }).unwrap()
          onClose()
        }}
      >
        <header>
          <div>
            <p>NEW VEHICLE</p>
            <h2>Add a vehicle</h2>
          </div>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>

        <nav className="wz-steps" aria-label="Steps">
          {STEPS.map((label, i) => (
            <button
              type="button"
              key={label}
              className={`wz-step${i === step ? ' current' : ''}${done[i] ? ' done' : ''}`}
              disabled={i > step}
              onClick={() => goTo(i)}
            >
              <span>{done[i] ? <Check size={12} /> : i + 1}</span>
              {label}
            </button>
          ))}
          <button
            type="button"
            className="wz-reset"
            onClick={() => {
              pickType(initial)
              setStep(0)
              setName('')
            }}
          >
            <RotateCcw size={13} /> Start over
          </button>
        </nav>

        <div className="wz-summary">
          {step > 0 && (
            <p>
              Vehicle: <b>{type}</b>{' '}
              <button type="button" onClick={() => goTo(0)}>
                change
              </button>
            </p>
          )}
          {step > 1 && (
            <p>
              Firmware:{' '}
              <b>
                {controller} {version}
              </b>{' '}
              <button type="button" onClick={() => goTo(1)}>
                change
              </button>
            </p>
          )}
          {step > 2 && (
            <p>
              Board: <b>{board}</b>{' '}
              <button type="button" onClick={() => goTo(2)}>
                change
              </button>
            </p>
          )}
        </div>

        {step === 0 && (
          <section>
            <h3 className="wz-title">SELECT VEHICLE</h3>
            <div className="fleet-add-types">
              {TYPES.map(t => (
                <button
                  type="button"
                  key={t.type}
                  className={t.type === type ? 'on' : ''}
                  onClick={() => {
                    pickType(t.type)
                  }}
                >
                  <TypeIcon type={t.type} size={22} />
                  <b>{t.title}</b>
                  <small>{t.type}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h3 className="wz-title">SELECT FIRMWARE</h3>
            <div className="wz-chips">
              {CONTROLLERS[type].map(c => (
                <button
                  type="button"
                  key={c}
                  className={c === controller ? 'on' : ''}
                  onClick={() => pickController(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            {controller && (
              <>
                <h3 className="wz-title">SELECT VERSION</h3>
                <div className="wz-chips">
                  {versions.map((v, i) => (
                    <button
                      type="button"
                      key={v}
                      className={`wz-version${v === version ? ' on' : ''}`}
                      onClick={() => {
                        setVersion(v)
                        setStep(2)
                      }}
                    >
                      <em className={CHANNELS[i].toLowerCase()}>{CHANNELS[i]}</em>
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {step === 2 && (
          <section>
            <h3 className="wz-title">SELECT BOARD</h3>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search boards..."
            />
            <ul className="wz-boards">
              {boards.map(b => (
                <li key={b}>
                  <button
                    type="button"
                    className={b === board ? 'on' : ''}
                    onClick={() => {
                      setBoard(b)
                      setStep(3)
                    }}
                  >
                    {b}
                  </button>
                </li>
              ))}
              {boards.length === 0 && <li className="wz-none">No matching board</li>}
            </ul>
          </section>
        )}

        {step === 3 && (
          <section>
            <h3 className="wz-title">CONNECT</h3>
            <label>
              Name
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`e.g. ${type === 'UAV' ? 'Falcon Alpha' : type === 'UGV' ? 'Rover Alpha' : type === 'USV' ? 'Harbor Boat' : 'Deep Scout'}`}
              />
            </label>
            <div className="fleet-add-row two">
              <label>
                Protocol
                <select value={protocol} onChange={e => setProtocol(e.target.value)}>
                  {PROTOCOLS.map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Link
                <select value={connection} onChange={e => setConnection(e.target.value)}>
                  {LINKS[type].map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <footer>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={isLoading}>
                Add vehicle
              </button>
            </footer>
          </section>
        )}
      </form>
    </div>
  )
}

export function FleetPage() {
  const navigate = useNavigate()
  const { data: fleet = [], isLoading } = useGetVehiclesQuery()
  const [loadDemo] = useLoadDemoFleetMutation()
  const [remove] = useRemoveVehicleMutation()
  const [adding, setAdding] = useState<{ type: VehicleType; chosen: boolean } | null>(null)

  if (isLoading) return <div className="empty">Loading fleet…</div>

  const online = fleet.filter(v => v.status === 'online').length
  const attention = fleet.filter(v => v.status === 'warning' || v.health !== 'healthy').length

  return (
    <div className="page fleet-page">
      {fleet.length === 0 ? (
        <div className="fleet-empty">
          <p>FLEET</p>
          <h1>Add your first vehicle</h1>
          <span>
            Pick a vehicle type to configure it. It will appear here as soon as it is added.
          </span>
          <div className="fleet-type-grid">
            {TYPES.map(t => (
              <button
                key={t.type}
                className="fleet-type-box"
                onClick={() => setAdding({ type: t.type, chosen: true })}
              >
                <TypeIcon type={t.type} size={34} />
                <b>{t.title}</b>
                <small>{t.hint}</small>
                <i>
                  <Plus /> Add {t.type}
                </i>
              </button>
            ))}
          </div>
          <button className="link-button" onClick={() => loadDemo()}>
            or load a demo fleet
          </button>
        </div>
      ) : (
        <>
          <div className="page-title">
            <div>
              <p>FLEET</p>
              <h1>
                Vehicles <span className="count">{fleet.length}</span>
              </h1>
            </div>
            <button
              className="primary"
              data-tour="fleet-add"
              onClick={() => setAdding({ type: 'UAV', chosen: false })}
            >
              + ADD VEHICLE
            </button>
          </div>
          <div className="fleet-stats" data-tour="fleet-stats">
            <span>
              <b>{online}</b> online
            </span>
            <span>
              <b>{fleet.length - online}</b> offline
            </span>
            <span className={attention ? 'warn' : ''}>
              <b>{attention}</b> need attention
            </span>
          </div>
          <div className="fleet-grid" data-tour="fleet-grid">
            {fleet.map(v => (
              <article key={v.id} className="fleet-card" data-tour={`fleet-card-${v.id}`}>
                <Link to={`/vehicles/${v.id}`} className="fleet-card-main">
                  <div className="fleet-card-top">
                    <span className="mission-domain-icon">
                      <TypeIcon type={v.type} size={26} />
                    </span>
                    <span>
                      <b>{v.name}</b>
                      <small>
                        {v.id} · {v.controller}
                        {v.firmware ? ` ${v.firmware}` : ''}
                      </small>
                    </span>
                    <StatusBadge status={v.status} />
                  </div>
                  <dl>
                    <div>
                      <dt>MODE</dt>
                      <dd>{v.mode}</dd>
                    </div>
                    <div>
                      <dt>MISSION</dt>
                      <dd>{v.mission}</dd>
                    </div>
                    <div>
                      <dt>LINK</dt>
                      <dd>
                        <Radio size={12} /> {v.connection}
                      </dd>
                    </div>
                  </dl>
                  <BatteryMeter value={v.battery} />
                </Link>
                <footer>
                  <button onClick={() => navigate(`/missions/${v.id}`)}>
                    <Route size={14} /> Mission
                  </button>
                  <button
                    className="danger"
                    aria-label={`Remove ${v.name}`}
                    onClick={() => remove(v.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </footer>
              </article>
            ))}
            <button
              className="fleet-card fleet-card-add"
              onClick={() => setAdding({ type: 'UAV', chosen: false })}
            >
              <Plus />
              <b>Add vehicle</b>
            </button>
          </div>
        </>
      )}
      {adding && (
        <AddVehicle initial={adding.type} chosen={adding.chosen} onClose={() => setAdding(null)} />
      )}
    </div>
  )
}
