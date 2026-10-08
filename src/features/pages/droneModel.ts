/**
 * Procedurally built glTF quadcopter, embedded as a data URI so the map never depends on an
 * external asset. Units are metres; the nose points along the model's +X axis.
 */

type Rgba = [number, number, number, number]
interface Part {
  color: Rgba
  emissive?: [number, number, number]
  blend?: boolean
  positions: number[]
  normals: number[]
  indices: number[]
}

const parts: Part[] = []

function part(color: Rgba, opts: { emissive?: [number, number, number]; blend?: boolean } = {}) {
  const p: Part = { color, ...opts, positions: [], normals: [], indices: [] }
  parts.push(p)
  return p
}

/** Axis-aligned box centred at (cx, cy, cz), optionally rotated about Y by `yaw` radians. */
function box(
  p: Part,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  yaw = 0,
) {
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const faces: Array<[number[], number[]]> = [
    [
      [1, 0, 0],
      [hx, -hy, -hz, hx, hy, -hz, hx, hy, hz, hx, -hy, hz],
    ],
    [
      [-1, 0, 0],
      [-hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz, -hx, -hy, -hz],
    ],
    [
      [0, 1, 0],
      [-hx, hy, -hz, -hx, hy, hz, hx, hy, hz, hx, hy, -hz],
    ],
    [
      [0, -1, 0],
      [-hx, -hy, hz, -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz],
    ],
    [
      [0, 0, 1],
      [-hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz],
    ],
    [
      [0, 0, -1],
      [hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz],
    ],
  ]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const [n, v] of faces) {
    const base = p.positions.length / 3
    for (let i = 0; i < 4; i++) {
      const x = v[i * 3]
      const y = v[i * 3 + 1]
      const z = v[i * 3 + 2]
      p.positions.push(cx + x * c + z * s, cy + y, cz - x * s + z * c)
      p.normals.push(n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c)
    }
    p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

/** Vertical cylinder (axis Y) centred at (cx, cy, cz). */
function cylinder(
  p: Part,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  h: number,
  segments = 18,
) {
  const top = cy + h / 2
  const bot = cy - h / 2
  const ring = (y: number, ny: number) => {
    const centre = p.positions.length / 3
    p.positions.push(cx, y, cz)
    p.normals.push(0, ny, 0)
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      p.positions.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)
      p.normals.push(0, ny, 0)
    }
    for (let i = 0; i < segments; i++) {
      const a = centre + 1 + i
      const b = centre + 1 + ((i + 1) % segments)
      if (ny > 0) p.indices.push(centre, b, a)
      else p.indices.push(centre, a, b)
    }
  }
  ring(top, 1)
  ring(bot, -1)
  const side = p.positions.length / 3
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    p.positions.push(cx + nx * r, top, cz + nz * r, cx + nx * r, bot, cz + nz * r)
    p.normals.push(nx, 0, nz, nx, 0, nz)
  }
  for (let i = 0; i < segments; i++) {
    const a = side + i * 2
    p.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
}

// ---- build the airframe ---------------------------------------------------------------------
const shell = part([0.16, 0.19, 0.21, 1])
const dark = part([0.05, 0.06, 0.07, 1])
const accent = part([0.18, 0.88, 0.75, 1], { emissive: [0.1, 0.6, 0.5] })
const red = part([1, 0.2, 0.2, 1], { emissive: [0.9, 0.1, 0.1] })
const green = part([0.2, 1, 0.5, 1], { emissive: [0.1, 0.9, 0.3] })
const rotor = part([0.82, 0.86, 0.88, 0.95])
const disc = part([0.85, 0.9, 0.92, 0.26], { blend: true })

// Fuselage: a tapered-looking body made of two stacked boxes.
box(shell, 0, 0, 0, 0.62, 0.16, 0.3)
box(shell, 0.1, 0.1, 0, 0.36, 0.08, 0.22)
box(dark, 0.3, -0.02, 0, 0.1, 0.1, 0.16) // nose sensor bay
box(accent, 0.34, 0.06, 0, 0.04, 0.03, 0.1) // nose strobe
// Gimbal camera under the nose.
cylinder(dark, 0.18, -0.12, 0, 0.06, 0.1, 12)
// Arms at 45°, motors and rotor discs on their ends.
const armLen = 0.78
const rotorHubs: Array<[number, number, number]> = []
for (const [sx, sz, light] of [
  [1, 1, green],
  [-1, 1, red],
  [1, -1, green],
  [-1, -1, red],
] as const) {
  const yaw = Math.atan2(sz, sx)
  const ex = (Math.cos(yaw) * armLen) / 2
  const ez = (Math.sin(yaw) * armLen) / 2
  box(dark, ex, 0.02, ez, armLen, 0.05, 0.06, -yaw)
  cylinder(shell, ex * 2, 0.06, ez * 2, 0.05, 0.09, 12)
  rotorHubs.push([ex * 2, 0.12, ez * 2])
  box(light, ex * 2, -0.02, ez * 2, 0.04, 0.03, 0.04)
}
// Rotor blades and the motion-blur disc, built at the origin and placed per hub by their own
// nodes ("rotorN", "discN") so the app can drive their spin and blur from the flight physics.
box(rotor, 0, 0, 0, 0.54, 0.01, 0.04)
box(rotor, 0, 0, 0, 0.04, 0.01, 0.54)
cylinder(disc, 0, 0, 0, 0.26, 0.004, 24)
// Landing skids.
for (const z of [-0.14, 0.14]) {
  box(dark, 0, -0.17, z, 0.5, 0.025, 0.025)
  box(dark, -0.18, -0.1, z, 0.025, 0.14, 0.025)
  box(dark, 0.18, -0.1, z, 0.025, 0.14, 0.025)
}

// ---- pack to glTF 2.0 ------------------------------------------------------------------------
function buildGltf() {
  const bufferViews: unknown[] = []
  const accessors: unknown[] = []
  const materials: unknown[] = []
  const primitives: unknown[] = []
  const chunks: ArrayBuffer[] = []
  let offset = 0
  const push = (data: ArrayBuffer, target?: number) => {
    const pad = (4 - (data.byteLength % 4)) % 4
    const padded = pad ? new Uint8Array(data.byteLength + pad) : new Uint8Array(data)
    if (pad) padded.set(new Uint8Array(data))
    chunks.push(padded.buffer)
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: data.byteLength,
      ...(target ? { target } : {}),
    })
    offset += padded.byteLength
    return bufferViews.length - 1
  }
  const rotorParts = new Set<Part>([rotor])
  const discParts = new Set<Part>([disc])
  const meshFor = (list: Part[]) => list.map(p => parts.indexOf(p))
  parts.forEach((p, i) => {
    const pos = new Float32Array(p.positions)
    const nor = new Float32Array(p.normals)
    const idx = new Uint16Array(p.indices)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < pos.length; k += 3)
      for (let d = 0; d < 3; d++) {
        min[d] = Math.min(min[d], pos[k + d])
        max[d] = Math.max(max[d], pos[k + d])
      }
    const pv = push(pos.buffer, 34962)
    const nv = push(nor.buffer, 34962)
    const iv = push(idx.buffer, 34963)
    const a0 = accessors.length
    accessors.push(
      { bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: iv, componentType: 5123, count: idx.length, type: 'SCALAR' },
    )
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: p.color,
        metallicFactor: 0.35,
        roughnessFactor: 0.55,
      },
      emissiveFactor: p.emissive ?? [0, 0, 0],
      alphaMode: p.blend ? 'BLEND' : 'OPAQUE',
      doubleSided: !!p.blend,
    })
    primitives.push({ attributes: { POSITION: a0, NORMAL: a0 + 1 }, indices: a0 + 2, material: i })
  })
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const bin = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bin.set(new Uint8Array(c), at)
    at += c.byteLength
  }
  let b64 = ''
  for (let i = 0; i < bin.length; i += 0x8000)
    b64 += String.fromCharCode(...bin.subarray(i, i + 0x8000))
  const bodyIdx = meshFor(parts.filter(p => !rotorParts.has(p) && !discParts.has(p)))
  const rotorIdx = meshFor(parts.filter(p => rotorParts.has(p)))
  const discIdx = meshFor(parts.filter(p => discParts.has(p)))
  const nodes: unknown[] = [
    { mesh: 0, children: rotorHubs.flatMap((_, i) => [1 + i * 2, 2 + i * 2]) },
  ]
  rotorHubs.forEach((t, i) => {
    nodes.push({ name: `rotor${i}`, mesh: 1, translation: t })
    nodes.push({ name: `disc${i}`, mesh: 2, translation: t, scale: [0.001, 1, 0.001] })
  })
  const gltf = {
    asset: { version: '2.0', generator: 'fortis-procedural' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [
      { primitives: bodyIdx.map(i => primitives[i]) },
      { primitives: rotorIdx.map(i => primitives[i]) },
      { primitives: discIdx.map(i => primitives[i]) },
    ],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: total, uri: `data:application/octet-stream;base64,${btoa(b64)}` }],
  }
  return `data:model/gltf+json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(gltf))))}`
}

export const DRONE_MODEL_URI = buildGltf()
/** Spin direction per rotor: diagonal pairs match, neighbours oppose, as on a real quad. */
export const ROTOR_DIRECTIONS = [1, -1, -1, 1] as const
