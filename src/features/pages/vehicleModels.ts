import { ModelBuilder, type ModelNode } from './modelBuilder'

/**
 * Procedural vehicle models, one per class. Animated parts are exposed as named glTF nodes
 * (rotorN / discN on the quadcopter, wheelN on the rover) that the 3D view drives from telemetry.
 */
export type ModelKind = 'quadcopter' | 'rover' | 'boat' | 'submersible'

export interface VehicleModel {
  uri: string
  /** Names of the nodes that spin, in order; the view turns them at the rate it computes. */
  spinNodes: string[]
  /** Blur-disc nodes (quadcopter only). */
  discNodes: string[]
  /** Direction per spin node (+1 / -1). */
  directions: number[]
  /** Rotation axis for the spin nodes: rotors turn about Y, wheels about Z, propellers about X. */
  spinAxis: 'x' | 'y' | 'z'
  scale: number
  minimumPixelSize: number
}

function quadcopter(): VehicleModel {
  const m = new ModelBuilder()
  const shell = m.part([0.16, 0.19, 0.21, 1])
  const dark = m.part([0.05, 0.06, 0.07, 1])
  const accent = m.part([0.18, 0.88, 0.75, 1], { emissive: [0.1, 0.6, 0.5] })
  const red = m.part([1, 0.2, 0.2, 1], { emissive: [0.9, 0.1, 0.1] })
  const green = m.part([0.2, 1, 0.5, 1], { emissive: [0.1, 0.9, 0.3] })
  const rotor = m.part([0.82, 0.86, 0.88, 0.95])
  const disc = m.part([0.85, 0.9, 0.92, 0.26], { blend: true })
  // Fuselage: a tapered-looking body made of two stacked boxes.
  m.box(shell, 0, 0, 0, 0.62, 0.16, 0.3)
  m.box(shell, 0.1, 0.1, 0, 0.36, 0.08, 0.22)
  m.box(dark, 0.3, -0.02, 0, 0.1, 0.1, 0.16) // nose sensor bay
  m.box(accent, 0.34, 0.06, 0, 0.04, 0.03, 0.1) // nose strobe
  m.cylinder(dark, 0.18, -0.12, 0, 0.06, 0.1, 12) // gimbal camera
  const armLen = 0.78
  const nodes: ModelNode[] = []
  for (const [sx, sz, light] of [
    [1, 1, green],
    [-1, 1, red],
    [1, -1, green],
    [-1, -1, red],
  ] as const) {
    const yaw = Math.atan2(sz, sx)
    const ex = (Math.cos(yaw) * armLen) / 2
    const ez = (Math.sin(yaw) * armLen) / 2
    m.box(dark, ex, 0.02, ez, armLen, 0.05, 0.06, -yaw)
    m.cylinder(shell, ex * 2, 0.06, ez * 2, 0.05, 0.09, 12)
    m.box(light, ex * 2, -0.02, ez * 2, 0.04, 0.03, 0.04)
    const i = nodes.length / 2
    nodes.push({ name: `rotor${i}`, parts: [rotor], translation: [ex * 2, 0.12, ez * 2] })
    nodes.push({
      name: `disc${i}`,
      parts: [disc],
      translation: [ex * 2, 0.12, ez * 2],
      scale: [0.001, 1, 0.001],
    })
  }
  // Blades and blur disc, built at the origin and placed per hub by their nodes.
  m.box(rotor, 0, 0, 0, 0.54, 0.01, 0.04)
  m.box(rotor, 0, 0, 0, 0.04, 0.01, 0.54)
  m.cylinder(disc, 0, 0, 0, 0.26, 0.004, 24)
  for (const z of [-0.14, 0.14]) {
    m.box(dark, 0, -0.17, z, 0.5, 0.025, 0.025)
    m.box(dark, -0.18, -0.1, z, 0.025, 0.14, 0.025)
    m.box(dark, 0.18, -0.1, z, 0.025, 0.14, 0.025)
  }
  return {
    uri: m.build(nodes),
    spinNodes: [0, 1, 2, 3].map(i => `rotor${i}`),
    discNodes: [0, 1, 2, 3].map(i => `disc${i}`),
    // Diagonal pairs match, neighbours oppose, as on a real quad.
    directions: [1, -1, -1, 1],
    spinAxis: 'y',
    scale: 5,
    minimumPixelSize: 44,
  }
}

function rover(): VehicleModel {
  const m = new ModelBuilder()
  const shell = m.part([0.2, 0.23, 0.25, 1])
  const dark = m.part([0.06, 0.07, 0.08, 1])
  const accent = m.part([0.18, 0.88, 0.75, 1], { emissive: [0.1, 0.6, 0.5] })
  const amber = m.part([1, 0.7, 0.2, 1], { emissive: [0.9, 0.5, 0.1] })
  const red = m.part([1, 0.2, 0.2, 1], { emissive: [0.9, 0.1, 0.1] })
  const wheel = m.part([0.08, 0.09, 0.1, 1])
  const rim = m.part([0.55, 0.58, 0.6, 1])
  // Chassis and deck.
  m.box(shell, 0, 0.42, 0, 1.3, 0.3, 0.72)
  m.box(dark, 0, 0.6, 0, 0.9, 0.08, 0.6)
  m.box(shell, -0.2, 0.7, 0, 0.5, 0.14, 0.44) // equipment bay
  // Sensor mast with lidar puck, aft of centre.
  m.cylinder(dark, -0.35, 0.95, 0, 0.03, 0.5, 10)
  m.cylinder(accent, -0.35, 1.24, 0, 0.09, 0.08, 16)
  // Forward camera and headlights.
  m.box(dark, 0.6, 0.6, 0, 0.1, 0.1, 0.16)
  m.box(amber, 0.66, 0.42, 0.24, 0.02, 0.06, 0.1)
  m.box(amber, 0.66, 0.42, -0.24, 0.02, 0.06, 0.1)
  m.box(red, -0.66, 0.42, 0.24, 0.02, 0.05, 0.1)
  m.box(red, -0.66, 0.42, -0.24, 0.02, 0.05, 0.1)
  // Antenna.
  m.cylinder(dark, -0.5, 0.95, -0.25, 0.012, 0.5, 6)
  // Wheels, built at the origin and placed by their nodes so the view can roll them.
  m.cylinder(wheel, 0, 0, 0, 0.23, 0.17, 20, 'z')
  m.cylinder(rim, 0, 0, 0, 0.12, 0.18, 12, 'z')
  m.box(rim, 0, 0, 0, 0.3, 0.04, 0.19)
  const nodes: ModelNode[] = []
  for (const [x, z] of [
    [0.42, 0.44],
    [-0.42, 0.44],
    [0.42, -0.44],
    [-0.42, -0.44],
  ] as const) {
    nodes.push({ name: `wheel${nodes.length}`, parts: [wheel, rim], translation: [x, 0.23, z] })
  }
  return {
    uri: m.build(nodes),
    spinNodes: [0, 1, 2, 3].map(i => `wheel${i}`),
    discNodes: [],
    directions: [1, 1, 1, 1],
    spinAxis: 'z',
    scale: 4,
    minimumPixelSize: 40,
  }
}

function boat(): VehicleModel {
  const m = new ModelBuilder()
  const hull = m.part([0.85, 0.87, 0.88, 1])
  const dark = m.part([0.08, 0.1, 0.12, 1])
  const accent = m.part([0.18, 0.88, 0.75, 1], { emissive: [0.1, 0.6, 0.5] })
  const red = m.part([1, 0.2, 0.2, 1], { emissive: [0.9, 0.1, 0.1] })
  const green = m.part([0.2, 1, 0.5, 1], { emissive: [0.1, 0.9, 0.3] })
  // Hull: a long box with a narrower bow block set at an angle on each side.
  m.box(hull, -0.2, 0.2, 0, 1.9, 0.4, 0.8)
  m.box(hull, 0.95, 0.2, 0.18, 0.7, 0.4, 0.36, 0.5)
  m.box(hull, 0.95, 0.2, -0.18, 0.7, 0.4, 0.36, -0.5)
  m.box(dark, -0.2, 0.42, 0, 1.8, 0.04, 0.7) // deck
  m.box(dark, -0.3, 0.62, 0, 0.7, 0.36, 0.5) // cabin
  m.cylinder(dark, -0.4, 1.05, 0, 0.025, 0.5, 8) // mast
  m.cylinder(accent, -0.4, 1.32, 0, 0.07, 0.06, 14) // radar dome
  m.box(green, 0.4, 0.5, 0.36, 0.06, 0.05, 0.04)
  m.box(red, 0.4, 0.5, -0.36, 0.06, 0.05, 0.04)
  return {
    uri: m.build(),
    spinNodes: [],
    discNodes: [],
    directions: [],
    spinAxis: 'y',
    scale: 4,
    minimumPixelSize: 40,
  }
}

/**
 * Survey-class AUV: a torpedo hull with a sail, tail fins and a single stern propeller, a
 * forward-looking camera/light pod and the side-scan transducers along the flanks.
 */
function submersible(): VehicleModel {
  const m = new ModelBuilder()
  const hull = m.part([0.95, 0.62, 0.12, 1])
  const dark = m.part([0.08, 0.1, 0.12, 1])
  const accent = m.part([0.18, 0.88, 0.75, 1], { emissive: [0.1, 0.6, 0.5] })
  const lamp = m.part([1, 0.97, 0.8, 1], { emissive: [0.9, 0.85, 0.5] })
  const prop = m.part([0.7, 0.72, 0.74, 1])
  // Hull: a long cylinder along X with stepped nose and tail cones.
  m.cylinder(hull, 0, 0.3, 0, 0.22, 1.5, 20, 'x')
  m.cylinder(hull, 0.88, 0.3, 0, 0.17, 0.3, 16, 'x')
  m.cylinder(hull, 1.1, 0.3, 0, 0.1, 0.18, 12, 'x')
  m.cylinder(hull, -0.88, 0.3, 0, 0.16, 0.3, 16, 'x')
  m.cylinder(dark, -1.08, 0.3, 0, 0.08, 0.14, 10, 'x')
  // Nose pod: camera window and lights.
  m.cylinder(dark, 1.2, 0.3, 0, 0.06, 0.04, 10, 'x')
  m.box(lamp, 1.12, 0.38, 0.09, 0.04, 0.04, 0.04)
  m.box(lamp, 1.12, 0.38, -0.09, 0.04, 0.04, 0.04)
  // Sail with the GPS/acoustic mast, and the side-scan transducer strips.
  m.box(dark, 0.1, 0.58, 0, 0.4, 0.16, 0.12)
  m.cylinder(accent, 0.1, 0.78, 0, 0.025, 0.24, 8)
  m.box(accent, -0.1, 0.3, 0.225, 0.7, 0.05, 0.02)
  m.box(accent, -0.1, 0.3, -0.225, 0.7, 0.05, 0.02)
  // Tail fins: cruciform control surfaces.
  m.box(dark, -0.8, 0.3, 0, 0.22, 0.56, 0.03)
  m.box(dark, -0.8, 0.3, 0, 0.22, 0.03, 0.56)
  // Stern propeller, built at the origin and placed by its node so the view can spin it.
  m.cylinder(prop, 0, 0, 0, 0.025, 0.08, 8, 'x')
  m.box(prop, 0, 0, 0, 0.03, 0.3, 0.06, 0)
  m.box(prop, 0, 0, 0, 0.03, 0.06, 0.3, 0)
  const nodes: ModelNode[] = [{ name: 'prop0', parts: [prop], translation: [-1.18, 0.3, 0] }]
  return {
    uri: m.build(nodes),
    spinNodes: ['prop0'],
    discNodes: [],
    directions: [1],
    spinAxis: 'x',
    scale: 4,
    minimumPixelSize: 40,
  }
}

const cache = new Map<ModelKind, VehicleModel>()
export function vehicleModel(kind: ModelKind): VehicleModel {
  let model = cache.get(kind)
  if (!model) {
    model =
      kind === 'quadcopter'
        ? quadcopter()
        : kind === 'rover'
          ? rover()
          : kind === 'submersible'
            ? submersible()
            : boat()
    cache.set(kind, model)
  }
  return model
}
