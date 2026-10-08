/**
 * Tiny procedural glTF builder: boxes and cylinders packed into a data URI, so the map never
 * depends on an external asset. Units are metres; the nose points along +X, up is +Y.
 */

type Rgba = [number, number, number, number]
export interface Part {
  color: Rgba
  emissive?: [number, number, number]
  blend?: boolean
  positions: number[]
  normals: number[]
  indices: number[]
}
export interface ModelNode {
  /** glTF node name, addressed by Cesium `nodeTransformations` to animate it. */
  name: string
  /** One or more parts, rendered together under the node. */
  parts: Part[]
  translation: [number, number, number]
  scale?: [number, number, number]
}

export class ModelBuilder {
  private parts: Part[] = []

  part(color: Rgba, opts: { emissive?: [number, number, number]; blend?: boolean } = {}) {
    const p: Part = { color, ...opts, positions: [], normals: [], indices: [] }
    this.parts.push(p)
    return p
  }

  /** Axis-aligned box centred at (cx, cy, cz), optionally rotated about Y by `yaw` radians. */
  box(p: Part, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0) {
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

  /** Cylinder centred at (cx, cy, cz) with its axis along `axis` (default vertical, Y). */
  cylinder(
    p: Part,
    cx: number,
    cy: number,
    cz: number,
    r: number,
    h: number,
    segments = 18,
    axis: 'x' | 'y' | 'z' = 'y',
  ) {
    // Build along Y, then swap axes so the same code serves masts, wheels and propellers.
    const map = (x: number, y: number, z: number): [number, number, number] =>
      axis === 'y' ? [x, y, z] : axis === 'z' ? [x, z, -y] : [y, x, z]
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      const [px, py, pz] = map(x, y, z)
      const [qx, qy, qz] = map(nx, ny, nz)
      p.positions.push(cx + px, cy + py, cz + pz)
      p.normals.push(qx, qy, qz)
    }
    const top = h / 2
    const bot = -h / 2
    const ring = (y: number, ny: number) => {
      const centre = p.positions.length / 3
      push(0, y, 0, 0, ny, 0)
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2
        push(Math.cos(a) * r, y, Math.sin(a) * r, 0, ny, 0)
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
      push(nx * r, top, nz * r, nx, 0, nz)
      push(nx * r, bot, nz * r, nx, 0, nz)
    }
    for (let i = 0; i < segments; i++) {
      const a = side + i * 2
      p.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  /**
   * Pack to glTF 2.0. Parts referenced by `nodes` become their own meshes placed under named
   * nodes (one node per entry, meshes shared between nodes that use the same part); everything
   * else is the static body.
   */
  build(nodes: ModelNode[] = []) {
    const parts = this.parts
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
      primitives.push({
        attributes: { POSITION: a0, NORMAL: a0 + 1 },
        indices: a0 + 2,
        material: i,
      })
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
    const animated = new Set(nodes.flatMap(n => n.parts))
    const meshes: unknown[] = [
      { primitives: parts.filter(p => !animated.has(p)).map(p => primitives[parts.indexOf(p)]) },
    ]
    // Nodes that use the same set of parts share one mesh.
    const meshOf = new Map<string, number>()
    const meshFor = (list: Part[]) => {
      const key = list.map(p => parts.indexOf(p)).join(',')
      let index = meshOf.get(key)
      if (index === undefined) {
        index = meshes.length
        meshOf.set(key, index)
        meshes.push({ primitives: list.map(p => primitives[parts.indexOf(p)]) })
      }
      return index
    }
    const gltfNodes: unknown[] = [{ mesh: 0, children: nodes.map((_, i) => i + 1) }]
    nodes.forEach(n =>
      gltfNodes.push({
        name: n.name,
        mesh: meshFor(n.parts),
        translation: n.translation,
        ...(n.scale ? { scale: n.scale } : {}),
      }),
    )
    const gltf = {
      asset: { version: '2.0', generator: 'fortis-procedural' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: gltfNodes,
      meshes,
      materials,
      accessors,
      bufferViews,
      buffers: [{ byteLength: total, uri: `data:application/octet-stream;base64,${btoa(b64)}` }],
    }
    return `data:model/gltf+json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(gltf))))}`
  }
}
