/**
 * Instruments for water vehicles. Both read straight from telemetry: a depth gauge for the
 * submersible (depth, seabed and the clearance between them) and a current rose for the vessel
 * (heading versus course over ground, and the set and drift that separate them).
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const pad3 = (deg: number) => String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0')

/**
 * Depth gauge: the water column from the surface down to the seabed with the craft drawn at
 * its depth, so the operator sees the bottom clearance rather than reading two numbers.
 */
export function DepthGauge({
  depth,
  seabed,
  maxDepth,
  verticalSpeed = 0,
}: {
  depth: number
  seabed: number
  /** Depth limit, drawn as a red line when it is inside the column. */
  maxDepth: number
  /** Positive up, m/s. */
  verticalSpeed?: number
}) {
  const range = Math.max(10, seabed + 3, depth + 3, Math.min(maxDepth + 2, seabed + 8))
  const yOf = (d: number) => -40 + (clamp(d, 0, range) / range) * 82
  const ySea = yOf(seabed)
  const yCraft = yOf(depth)
  const yLimit = maxDepth < range ? yOf(maxDepth) : null
  const step = range > 40 ? 10 : range > 16 ? 5 : 2
  const ticks: number[] = []
  for (let d = 0; d <= range; d += step) ticks.push(d)
  const clearance = Math.max(0, seabed - depth)
  const low = depth > 0.5 && clearance < 1.5
  return (
    <div
      className={`depth-gauge${low ? ' warn' : ''}`}
      role="img"
      aria-label={`Depth ${depth.toFixed(1)} metres, ${clearance.toFixed(1)} metres above the seabed`}
    >
      <svg viewBox="-60 -60 120 120">
        <defs>
          <clipPath id="dg-clip">
            <circle r="48" />
          </clipPath>
          <linearGradient id="dg-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b6f8a" />
            <stop offset="0.5" stopColor="#0d3b52" />
            <stop offset="1" stopColor="#061a26" />
          </linearGradient>
          <linearGradient id="dg-bed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8d6a3c" />
            <stop offset="1" stopColor="#3b2a14" />
          </linearGradient>
        </defs>
        <g clipPath="url(#dg-clip)">
          <rect x="-60" y="-60" width="120" height="120" fill="url(#dg-water)" />
          {/* Seabed: everything below the bathymetry at this position. */}
          <rect x="-60" y={ySea} width="120" height={60 - ySea + 2} fill="url(#dg-bed)" />
          <path
            d={`M-60 ${ySea} Q-45 ${ySea - 1.5} -30 ${ySea} T0 ${ySea} T30 ${ySea} T60 ${ySea}`}
            fill="none"
            stroke="#c9a06a"
            strokeWidth="0.9"
          />
          {/* Surface: a wavy line at the top of the column. */}
          <path
            d="M-60 -40 Q-50 -42 -40 -40 T-20 -40 T0 -40 T20 -40 T40 -40 T60 -40"
            fill="none"
            stroke="#bfefff"
            strokeWidth="1.1"
          />
          {ticks.map(d => (
            <g key={d}>
              <line x1="-48" x2={d % (step * 2) === 0 ? -40 : -44} y1={yOf(d)} y2={yOf(d)} />
              {d % (step * 2) === 0 && d > 0 && (
                <text x="-37" y={yOf(d) + 1.8} className="dg-tick">
                  {d}
                </text>
              )}
            </g>
          ))}
          {yLimit !== null && (
            <line x1="-48" x2="48" y1={yLimit} y2={yLimit} className="dg-limit" />
          )}
          {/* Clearance bar: the water between the keel and the seabed. */}
          {depth > 0.3 && (
            <line x1="22" x2="22" y1={yCraft + 2} y2={ySea - 0.5} className="dg-clearance" />
          )}
          {/* The craft: a small hull with its sail, at depth. */}
          <g transform={`translate(0 ${yCraft})`}>
            <rect x="-11" y="-2.2" width="22" height="4.4" rx="2.2" className="dg-hull" />
            <rect x="-3" y="-5" width="5" height="3" className="dg-hull" />
            <path d="M11 0 L14.5 -1.6 L14.5 1.6 Z" className="dg-hull" />
            <path d="M-11 -2.8 L-13.5 -4.4 L-13.5 4.4 L-11 2.8 Z" className="dg-hull" />
          </g>
        </g>
        <circle r="48" fill="none" stroke="#20292e" strokeWidth="4" />
        <circle r="50" fill="none" stroke="#4a5d69" strokeWidth="1" />
      </svg>
      <b>
        D {depth.toFixed(1)} m · ALT {clearance.toFixed(1)} m ·{' '}
        {Math.abs(verticalSpeed) < 0.05 ? '→' : verticalSpeed > 0 ? '↑' : '↓'}
        {Math.abs(verticalSpeed).toFixed(1)} m/s
      </b>
    </div>
  )
}

/**
 * Nav rose (north up): the vessel's compass, with its course over ground and the current that
 * separates course from heading. Under way the bow points into the stream; on station the
 * vessel sits inside the loiter ring and only drives when the current pushes it out.
 */
export function NavRose({
  heading,
  course,
  set,
  drift,
  stationKeeping = false,
}: {
  heading: number
  course: number
  /** Direction the current flows toward, degrees. */
  set: number
  /** Current speed, m/s. */
  drift: number
  stationKeeping?: boolean
}) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5)
  const numbers = Array.from({ length: 12 }, (_, i) => i * 30)
  const cardinals: Array<[number, string]> = [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ]
  const crab = ((heading - course + 540) % 360) - 180
  const len = 14 + clamp(drift, 0, 1.5) * 14
  return (
    <div
      className={`current-rose${stationKeeping ? ' station' : ''}`}
      role="img"
      aria-label={`Heading ${pad3(heading)}, course ${pad3(course)}, current ${drift.toFixed(1)} metres per second toward ${pad3(set)}`}
    >
      <svg viewBox="-60 -60 120 120">
        <circle r="48" className="cr-dial" />
        {ticks.map(t => (
          <line
            key={t}
            x1="0"
            y1="-48"
            x2="0"
            y2={t % 30 === 0 ? -42 : t % 10 === 0 ? -44 : -45.5}
            transform={`rotate(${t})`}
            className="cr-tick"
          />
        ))}
        {numbers.map(n => (
          <text
            key={n}
            transform={`rotate(${n}) translate(0 -35) rotate(${-n})`}
            className="cr-deg"
          >
            {n}
          </text>
        ))}
        {cardinals.map(([a, l]) => (
          <text
            key={l}
            transform={`rotate(${a}) translate(0 -55) rotate(${-a})`}
            className={`cr-card${l === 'N' ? ' n' : ''}`}
          >
            {l}
          </text>
        ))}
        {/* Loiter ring: where the hull may drift before it drives back. */}
        <circle r="12" className={`cr-loiter${stationKeeping ? ' on' : ''}`} />
        {/* Current: an amber arrow pointing where the water goes, length by drift. */}
        <g transform={`rotate(${set})`} className="cr-current">
          <line x1="0" y1={len * 0.4} x2="0" y2={-len} />
          <path d={`M0 ${-len - 4} L-3.2 ${-len + 2} L3.2 ${-len + 2} Z`} />
          <line x1="-2.5" y1={len * 0.4} x2="2.5" y2={len * 0.4} />
        </g>
        {/* Course over ground: where the hull is actually going. */}
        <g transform={`rotate(${course})`} className="cr-course">
          <line x1="0" y1="0" x2="0" y2="-38" />
          <circle cy="-38" r="2.2" />
        </g>
        {/* Heading: the hull itself. */}
        <g transform={`rotate(${heading})`} className="cr-heading">
          <path d="M0 -30 L-5 8 L0 4 L5 8 Z" />
        </g>
        <circle r="48" fill="none" stroke="#20292e" strokeWidth="4" />
        <circle r="50" fill="none" stroke="#4a5d69" strokeWidth="1" />
      </svg>
      <b>
        HDG {pad3(heading)}° · COG {pad3(course)}° ·{' '}
        {stationKeeping
          ? `ON STATION · SET ${pad3(set)}°`
          : `SET ${pad3(set)}° ${(drift * 1.944).toFixed(1)} kts`}
      </b>
    </div>
  )
}
