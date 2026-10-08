import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Cartesian2,
  Cartesian3,
  BoundingSphere,
  CallbackProperty,
  Cartographic,
  HeadingPitchRange,
  Matrix4,
  Transforms,
  HeadingPitchRoll,
  Quaternion,
  TranslationRotationScale,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Color,
  ConstantProperty,
  HorizontalOrigin,
  Math as CesiumMath,
  ShadowMode,
  ImageryLayer,
  ImageMaterialProperty,
  UrlTemplateImageryProvider,
  Viewer,
  type Entity,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { fromGeo, toGeo } from './MissionHud'
import type { Point } from './missionGeometry'
import type { TelemetryFrame } from './useFlightSimulation'
import { DRONE_MODEL_URI, ROTOR_DIRECTIONS } from './droneModel'
import { drawHud, type HudTarget } from './hudOverlay'
import { MAP_COLORS, routeLine } from './mapStyle'

export interface EditHandle {
  kind: 'area' | 'zone' | 'wp' | 'center' | 'anchor'
  index: number
  zone?: number
  point: Point
}
interface EditTarget {
  kind: EditHandle['kind']
  index: number
  zone?: number
}

interface Props {
  pathRef: RefObject<SVGPathElement | null>
  pathKey: string
  metersPerUnit: number
  altitude: number
  areas: Array<{ points: Point[]; kind: 'area' | 'zone' }>
  home: Point
  frame: TelemetryFrame | null
  trail: Point[]
  handles: EditHandle[]
  onMovePoint: (target: EditTarget, point: Point) => void
  onAddPoint: (point: Point) => void
  onCursor?: (point: Point | null) => void
  view3d: boolean
  /** Gimbal pointing, degrees: pitch -90 = nadir, yaw relative to heading. */
  gimbal?: { pitch: number; yaw: number }
  /** Label shown beside the aircraft. */
  callsign?: string
  /** Tracking HUD: bracket and callout card. */
  hud?: { details: string[] }
  /** Motor state from the flight controller: off on the pad, idle when armed, run when flying. */
  rotors?: 'off' | 'idle' | 'run'
  /** Changes when the home fix moves the planning grid; geometry is rebuilt and re-framed. */
  originKey?: string
}

const SHADOW_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><radialGradient id="s"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".6" stop-color="#000" stop-opacity=".25"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#s)"/></svg>`,
)}`
// Sensor model used for the ground footprint (degrees).
const SENSOR_VFOV = 34
const SENSOR_HFOV = 48
const SENSOR_MAX_TILT = 65
const TEAL = MAP_COLORS.plan
const BLUE = MAP_COLORS.sensor
const AMBER = MAP_COLORS.zone
const GLOW_TEAL = MAP_COLORS.areaGlow
const ZONE_HEIGHT = 60
const sheets = new Map<string, HTMLCanvasElement>()
/** Vertical gradient texture for glossy walls: transparent at the bottom, bright at the top. */
function gradientSheet(color: Color, peak: number) {
  const key = `${color.toCssColorString()}:${peak}`
  let canvas = sheets.get(key)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const rgb = `${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}`
  const g = ctx.createLinearGradient(0, 256, 0, 0)
  g.addColorStop(0, `rgba(${rgb}, 0)`)
  g.addColorStop(0.45, `rgba(${rgb}, ${peak * 0.22})`)
  g.addColorStop(0.85, `rgba(${rgb}, ${peak * 0.6})`)
  g.addColorStop(0.97, `rgba(${rgb}, ${peak})`)
  g.addColorStop(1, `rgba(255, 255, 255, ${peak})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  sheets.set(key, canvas)
  return canvas
}

export function FlightView3D({
  pathRef,
  pathKey,
  metersPerUnit,
  altitude,
  areas,
  home,
  frame,
  trail,
  handles,
  onMovePoint,
  onAddPoint,
  onCursor,
  view3d,
  gimbal,
  callsign = 'UAV',
  hud,
  rotors,
  originKey = '',
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const drone = useRef<Entity | null>(null)
  const stem = useRef<Entity | null>(null)
  const altLabel = useRef<Entity | null>(null)
  const trailEntity = useRef<Entity | null>(null)
  const shadow = useRef<Entity | null>(null)
  const aim = useRef<Cartesian3 | null>(null)
  const pose = useRef<{ orientation: Quaternion | undefined }>({ orientation: undefined })
  const hudSurface = useRef<HTMLCanvasElement>(null)
  const hudCards = useRef<HTMLCanvasElement>(null)
  const hudTarget = useRef<HudTarget | null>(null)
  const spin = useRef(false)
  /** Rotor physics: rpm spools toward a target; blades turn and the blur disc fades in with it. */
  const rotor = useRef({ rpm: 0, target: 0, angle: [0, 0, 0, 0], last: 0 })
  const rotorsRef = useRef(rotors)
  rotorsRef.current = rotors
  const framed = useRef('')
  const [chase, setChase] = useState(false)
  const [tactical, setTactical] = useState(false)
  const view3dRef = useRef(view3d)
  view3dRef.current = view3d
  const imagery = useRef<ImageryLayer | null>(null)
  const follow = useRef<{
    chase: boolean
    range: number
    target: { pos: Cartesian3; heading: number } | null
    cam: { pos: Cartesian3; heading: number } | null
  }>({ chase: false, range: 160, target: null, cam: null })
  const sensor = useRef<{ footprint: Entity; edges: Entity[]; task: Entity; pill: Entity } | null>(
    null,
  )
  const lines = useRef<{
    stem: Cartesian3[]
    edges: Cartesian3[][]
    outline: Cartesian3[]
    route: Cartesian3[]
    vector: Cartesian3[]
    task: Cartesian3[]
    trail: Cartesian3[]
  }>({
    stem: [],
    edges: [[], [], [], []],
    outline: [],
    route: [],
    vector: [],
    task: [],
    trail: [],
  })
  const live2 = (read: () => Cartesian3[]) => new CallbackProperty(read, false) as never
  const handleEntities = useRef<Entity[]>([])
  const live = useRef({ metersPerUnit, onMovePoint, onAddPoint, onCursor, handles })
  live.current = { metersPerUnit, onMovePoint, onAddPoint, onCursor, handles }
  const geo = (p: Point) => toGeo(p, metersPerUnit)

  useEffect(() => {
    if (!host.current) return
    const viewer = new Viewer(host.current, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
    })
    viewer.scene.globe.baseColor = Color.fromCssColorString('#0a1418')
    viewer.scene.backgroundColor = Color.fromCssColorString('#04090d')
    const layer = viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri World Imagery',
        maximumLevel: 18,
      }),
    )
    layer.brightness = 0.8
    layer.saturation = 0.8
    imagery.current = layer
    const scene = viewer.scene
    scene.fog.enabled = true
    scene.fog.density = 0.00045
    scene.fog.minimumBrightness = 0.12
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = -0.02
      scene.skyAtmosphere.brightnessShift = -0.25
    }
    scene.globe.showGroundAtmosphere = true
    scene.globe.atmosphereBrightnessShift = -0.3
    scene.highDynamicRange = false
    viewerRef.current = viewer
    const canvas = viewer.scene.canvas
    let last = performance.now()
    const PITCH = CesiumMath.toRadians(-26)
    const onPreRender = () => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now
      // Rotors: spool toward the commanded rpm (fast up, slower coast down), then advance each
      // blade by its own direction. The visual rate is scaled so blades stay readable at 60 fps.
      const r = rotor.current
      const mode = rotorsRef.current ?? (spin.current ? 'run' : 'off')
      r.target = mode === 'run' ? 4800 : mode === 'idle' ? 1100 : 0
      const rate = r.target > r.rpm ? 2600 : 900
      r.rpm =
        r.target > r.rpm
          ? Math.min(r.target, r.rpm + rate * dt)
          : Math.max(r.target, r.rpm - rate * dt)
      const revPerSec = r.rpm / 600
      for (let i = 0; i < 4; i++)
        r.angle[i] =
          (r.angle[i] + ROTOR_DIRECTIONS[i] * revPerSec * 2 * Math.PI * dt) % (2 * Math.PI)
      const f = follow.current
      if (!f.chase || !f.target) return
      const ease = (rate: number) => 1 - Math.exp(-dt * rate)
      if (!f.cam) f.cam = { pos: f.target.pos.clone(), heading: f.target.heading }
      f.cam.pos = Cartesian3.lerp(f.cam.pos, f.target.pos, ease(7), new Cartesian3())
      let diff = f.target.heading - f.cam.heading
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      f.cam.heading += diff * ease(1.6)
      const hd = f.cam.heading
      const horiz = f.range * Math.cos(PITCH)
      const up = f.range * -Math.sin(PITCH)
      const enu = Transforms.eastNorthUpToFixedFrame(f.cam.pos)
      const dest = Matrix4.multiplyByPoint(
        enu,
        new Cartesian3(-Math.sin(hd) * horiz, -Math.cos(hd) * horiz, up),
        new Cartesian3(),
      )
      viewer.camera.setView({
        destination: dest,
        orientation: { heading: hd, pitch: PITCH, roll: 0 },
      })
    }
    viewer.scene.preRender.addEventListener(onPreRender)
    const onPostRender = () => {
      if (!hudSurface.current || !hudCards.current) return
      drawHud(viewer, hudSurface.current, hudCards.current, hudTarget.current)
    }
    viewer.scene.postRender.addEventListener(onPostRender)
    const onWheel = (event: WheelEvent) => {
      if (!follow.current.chase) return
      event.preventDefault()
      follow.current.range = Math.min(
        900,
        Math.max(40, follow.current.range * (event.deltaY > 0 ? 1.12 : 0.89)),
      )
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.style.cursor = 'crosshair'
    const input = new ScreenSpaceEventHandler(canvas)
    let drag: { target: EditTarget; origin: Point; from: Point } | null = null
    let suppressClick = false
    const toUnits = (position: Cartesian2) => {
      const cart = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
      if (!cart) return null
      const c = Cartographic.fromCartesian(cart)
      return fromGeo(
        CesiumMath.toDegrees(c.latitude),
        CesiumMath.toDegrees(c.longitude),
        live.current.metersPerUnit,
      )
    }
    const parse = (id: unknown): EditTarget | null => {
      if (typeof id !== 'string' || !id.startsWith('handle:')) return null
      const [, kind, index, zone] = id.split(':')
      return {
        kind: kind as EditTarget['kind'],
        index: Number(index),
        zone: zone === '' ? undefined : Number(zone),
      }
    }
    input.setInputAction((event: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position)
      const target = parse(picked?.id?.id)
      if (!target) return
      const handle = live.current.handles.find(
        h => h.kind === target.kind && h.index === target.index && h.zone === target.zone,
      )
      const from = toUnits(event.position)
      if (!handle || !from) return
      drag = { target, origin: handle.point, from }
      viewer.scene.screenSpaceCameraController.enableInputs = false
    }, ScreenSpaceEventType.LEFT_DOWN)
    input.setInputAction((event: { endPosition: Cartesian2 }) => {
      const point = toUnits(event.endPosition)
      live.current.onCursor?.(point)
      if (!drag || !point) return
      // Move by the cursor's ground delta: handles sit at flight altitude, so an absolute
      // ground pick would jump the point away from the cursor in a tilted view.
      live.current.onMovePoint(drag.target, {
        x: drag.origin.x + (point.x - drag.from.x),
        y: drag.origin.y + (point.y - drag.from.y),
      })
    }, ScreenSpaceEventType.MOUSE_MOVE)
    input.setInputAction(() => {
      if (!drag) return
      drag = null
      suppressClick = true
      viewer.scene.screenSpaceCameraController.enableInputs = !follow.current.chase
    }, ScreenSpaceEventType.LEFT_UP)
    input.setInputAction((event: { position: Cartesian2 }) => {
      if (suppressClick) {
        suppressClick = false
        return
      }
      if (parse(viewer.scene.pick(event.position)?.id?.id)) return
      const point = toUnits(event.position)
      if (point) live.current.onAddPoint(point)
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      if (!viewer.isDestroyed()) viewer.scene.preRender.removeEventListener(onPreRender)
      if (!viewer.isDestroyed()) viewer.scene.postRender.removeEventListener(onPostRender)
      input.destroy()
      viewerRef.current = null
      framed.current = ''
      if (!viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  const lastOrigin = useRef(originKey)
  useEffect(() => {
    const viewer = viewerRef.current
    const path = pathRef.current
    if (!viewer || !path) return
    if (lastOrigin.current !== originKey) {
      // The grid moved with the home fix: fly the camera to the new place.
      lastOrigin.current = originKey
      framed.current = ''
    }
    viewer.trackedEntity = undefined
    viewer.entities.removeAll()
    const ground = (list: Point[]) =>
      list.flatMap(p => {
        const g = geo(p)
        return [g.lng, g.lat]
      })

    areas.forEach(({ points, kind }) => {
      const color = kind === 'area' ? TEAL : AMBER
      if (points.length === 2) {
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(ground(points)),
            width: 2,
            material: new PolylineDashMaterialProperty({ color, dashLength: 12 }),
            clampToGround: true,
          },
        })
        return
      }
      if (points.length < 3) return
      const area = kind === 'area'
      const top = kind === 'zone' ? ZONE_HEIGHT : Math.max(altitude, 10)
      const closed = [...points, points[0]]
      const edge = (h: number) =>
        Cartesian3.fromDegreesArrayHeights(
          closed.flatMap(p => {
            const g = geo(p)
            return [g.lng, g.lat, h]
          }),
        )
      // Drop shadow: the footprint nudged south-east on the ground, so the volume reads as lifted.
      const shift = 3 / metersPerUnit
      viewer.entities.add({
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(
            ground(points.map(p => ({ x: p.x + shift, y: p.y + shift }))),
          ) as never,
          material: Color.BLACK.withAlpha(area ? 0.3 : 0.22),
          height: 0,
        },
      })
      // Glossy walls: a wall entity textured with a vertical gradient, bright at the top edge and
      // fading out towards the ground, like an area chart fill. No corner or ground lines.
      const glow = area ? GLOW_TEAL : AMBER
      const ring = closed.flatMap(p => {
        const g = geo(p)
        return [g.lng, g.lat]
      })
      viewer.entities.add({
        wall: {
          positions: Cartesian3.fromDegreesArray(ring),
          maximumHeights: closed.map(() => top),
          minimumHeights: closed.map(() => 0.2),
          material: new ImageMaterialProperty({
            image: gradientSheet(glow, area ? 0.62 : 0.75),
            transparent: true,
          }),
        },
      })
      // Floor and lid: soft translucent planes that give the box its body.
      viewer.entities.add({
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(ground(points)) as never,
          material: glow.withAlpha(area ? 0.12 : 0.2),
          height: 0.2,
        },
      })
      viewer.entities.add({
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(ground(points)) as never,
          material: glow.withAlpha(area ? 0.08 : 0.14),
          height: top,
        },
      })
      // Crisp top edge, like the line on top of a chart area.
      viewer.entities.add({
        polyline: {
          positions: edge(top),
          width: 2,
          material: glow.withAlpha(0.95),
        },
      })
    })

    const total = path.getTotalLength()
    const samples: Point[] = []
    if (total) {
      const step = Math.max(2, total / 1200)
      for (let l = 0; l < total; l += step) {
        const p = path.getPointAtLength(l)
        samples.push({ x: p.x, y: p.y })
      }
      const end = path.getPointAtLength(total)
      samples.push({ x: end.x, y: end.y })
    }
    lines.current.route = []
    if (samples.length > 1) {
      const flat: number[] = samples.flatMap(p => {
        const g = geo(p)
        return [g.lng, g.lat, altitude]
      })
      // Dynamic positions keep the route on screen while the static batch rebuilds after edits.
      lines.current.route = Cartesian3.fromDegreesArrayHeights(flat)
      // The planned route looks identical on both pages.
      viewer.entities.add({ polyline: routeLine(() => lines.current.route, MAP_COLORS.plan) })
    }
    const h = geo(home)
    // Landing pad: concentric rings with an H, the way a helipad reads from the air.
    viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0),
      ellipse: {
        semiMajorAxis: 18,
        semiMinorAxis: 18,
        material: AMBER.withAlpha(0.08),
        outline: true,
        outlineColor: AMBER.withAlpha(0.9),
        outlineWidth: 2,
        height: 0,
      },
    })
    viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0),
      ellipse: {
        semiMajorAxis: 8,
        semiMinorAxis: 8,
        material: AMBER.withAlpha(0.18),
        outline: true,
        outlineColor: AMBER.withAlpha(0.6),
        outlineWidth: 1,
        height: 0,
      },
      label: {
        text: 'H',
        font: '700 15px monospace',
        fillColor: AMBER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0),
      label: {
        text: 'HOME',
        font: '600 10px monospace',
        fillColor: AMBER,
        pixelOffset: new Cartesian2(0, -24),
        showBackground: true,
        backgroundColor: Color.BLACK.withAlpha(0.55),
        backgroundPadding: new Cartesian2(5, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    const gridColor = Color.WHITE.withAlpha(0.14)
    const step = 50 / metersPerUnit
    const line = (a: Point, b: Point) => {
      const ga = geo(a)
      const gb = geo(b)
      viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray([ga.lng, ga.lat, gb.lng, gb.lat]),
          width: 1,
          material: gridColor,
        },
      })
    }
    for (let x = 0; x <= 1000; x += step) line({ x, y: 0 }, { x, y: 700 })
    for (let y = 0; y <= 700; y += step) line({ x: 0, y }, { x: 1000, y })

    // Completed part of the flight: the same line in the flown colour.
    trailEntity.current = viewer.entities.add({
      polyline: routeLine(() => lines.current.trail, MAP_COLORS.flown),
    })
    stem.current = viewer.entities.add({
      polyline: {
        positions: live2(() => lines.current.stem),
        width: 1.2,
        material: new PolylineDashMaterialProperty({
          color: Color.WHITE.withAlpha(0.55),
          dashLength: 10,
        }),
      },
    })
    // Soft ground shadow that spreads with altitude, plus the plumb point.
    shadow.current = viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0.3) as never,
      billboard: {
        image: SHADOW_ICON,
        width: 40,
        height: 40,
        sizeInMeters: true,
      },
      point: {
        pixelSize: 6,
        color: Color.WHITE,
        outlineColor: Color.BLACK.withAlpha(0.8),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    viewer.entities.add({
      polyline: {
        positions: live2(() => lines.current.vector),
        width: 3,
        material: new PolylineGlowMaterialProperty({ color: TEAL, glowPower: 0.3 }),
      },
    })
    viewer.entities.add({
      position: new CallbackProperty(() => aim.current, false) as never,
      point: {
        pixelSize: 7,
        color: BLUE,
        outlineColor: Color.WHITE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    altLabel.current = viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0) as never,
      label: {
        text: '0 m',
        font: '600 10px monospace',
        fillColor: Color.WHITE.withAlpha(0.85),
        pixelOffset: new Cartesian2(12, 0),
        horizontalOrigin: HorizontalOrigin.LEFT,
        showBackground: true,
        backgroundColor: Color.BLACK.withAlpha(0.55),
        backgroundPadding: new Cartesian2(5, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    drone.current = viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0) as never,
      viewFrom: new ConstantProperty(new Cartesian3(0, -320, 200)) as never,
      orientation: new CallbackProperty(() => pose.current.orientation, false) as never,
      model: {
        uri: DRONE_MODEL_URI,
        scale: 5,
        minimumPixelSize: 44,
        maximumScale: 60,
        shadows: ShadowMode.DISABLED,
        runAnimations: false,
        nodeTransformations: Object.fromEntries(
          [0, 1, 2, 3].flatMap(i => [
            [
              `rotor${i}`,
              new CallbackProperty(
                () =>
                  new TranslationRotationScale(
                    Cartesian3.ZERO,
                    Quaternion.fromAxisAngle(Cartesian3.UNIT_Y, rotor.current.angle[i]),
                  ),
                false,
              ),
            ],
            [
              `disc${i}`,
              new CallbackProperty(() => {
                // Blur disc only reads once the blades are too fast to follow.
                const k = Math.min(Math.max((rotor.current.rpm - 1500) / 2500, 0), 1)
                const sc = 1 + k * 999
                return new TranslationRotationScale(
                  Cartesian3.ZERO,
                  Quaternion.IDENTITY,
                  new Cartesian3(sc, 1, sc),
                )
              }, false),
            ],
          ]),
        ) as never,
      },
      label: {
        text: callsign,
        show: !hud,
        font: '700 10px monospace',
        fillColor: Color.WHITE,
        pixelOffset: new Cartesian2(0, -36),
        showBackground: true,
        backgroundColor: Color.BLACK.withAlpha(0.6),
        backgroundPadding: new Cartesian2(6, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    const VIOLET = BLUE
    const edges = [0, 1, 2, 3].map(i =>
      viewer.entities.add({
        polyline: {
          positions: live2(() => lines.current.edges[i]),
          width: 1,
          material: VIOLET.withAlpha(0.4),
        },
      }),
    )
    const footprint = viewer.entities.add({
      polyline: {
        positions: live2(() => lines.current.outline),
        width: 2.5,
        material: new PolylineGlowMaterialProperty({ color: VIOLET, glowPower: 0.3 }),
      },
    })
    const task = viewer.entities.add({
      polyline: {
        positions: live2(() => lines.current.task),
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: Color.fromCssColorString('#ffd479').withAlpha(0.7),
          dashLength: 14,
        }),
      },
    })
    const pill = viewer.entities.add({
      position: Cartesian3.fromDegrees(h.lng, h.lat, 0) as never,
      label: {
        text: '',
        show: !hud,
        pixelOffset: new Cartesian2(0, -16),
        font: '600 11px monospace',
        fillColor: Color.fromCssColorString('#ffd479'),
        showBackground: true,
        backgroundColor: Color.BLACK.withAlpha(0.75),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    sensor.current = { footprint, edges, task, pill }

    if (framed.current !== 'done') {
      // Initial view is always the home position: top-down in 2D, a tilted look from the south
      // in 3D so HOME sits in the lower third with the mission area ahead of it.
      framed.current = 'done'
      const c = geo(home)
      viewer.camera.setView(
        view3dRef.current
          ? {
              destination: Cartesian3.fromDegrees(c.lng, c.lat - 0.0022, 260),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-34), roll: 0 },
            }
          : {
              destination: Cartesian3.fromDegrees(c.lng, c.lat, 520),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
            },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, altitude, areas, metersPerUnit, originKey])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    follow.current.chase = chase
    follow.current.cam = null
    viewer.scene.screenSpaceCameraController.enableInputs = !chase
  }, [chase])

  const phase = frame?.phase
  useEffect(() => {
    if (phase === 'climb' && view3dRef.current) setChase(true)
  }, [phase])

  useEffect(() => {
    const e = drone.current
    if (!e || !frame) return
    const g = geo(frame.position)
    const airborne = frame.altitude > 0 || frame.groundSpeed > 0
    spin.current = airborne || (frame.phase !== 'standby' && frame.phase !== 'landed')
    // Hover bob and a faint airframe vibration keep the aircraft alive even when holding.
    const t = performance.now()
    const bob = airborne ? 0.35 * Math.sin(t / 420) : 0
    const alt = Math.max(frame.altitude, 2) + bob
    const pos = Cartesian3.fromDegrees(g.lng, g.lat, alt)
    e.position = new ConstantProperty(pos) as never
    follow.current.target = { pos, heading: CesiumMath.toRadians(frame.heading) }
    // Model nose is +X, which Cesium points north at heading 0. Attitude is the telemetry's
    // pitch/roll (the same numbers the attitude indicator shows) plus a faint airframe shiver.
    pose.current.orientation = Transforms.headingPitchRollQuaternion(
      pos,
      new HeadingPitchRoll(
        CesiumMath.toRadians(frame.heading + (airborne ? 0.5 * Math.sin(t / 90) : 0)),
        CesiumMath.toRadians(frame.pitch + (airborne ? 0.4 * Math.sin(t / 130) : 0)),
        CesiumMath.toRadians(frame.roll),
      ),
    )
    if (shadow.current) {
      shadow.current.position = new ConstantProperty(
        Cartesian3.fromDegrees(g.lng, g.lat, 0.3),
      ) as never
      if (shadow.current.billboard) {
        const size = 8 + alt * 0.28
        shadow.current.billboard.width = new ConstantProperty(size) as never
        shadow.current.billboard.height = new ConstantProperty(size) as never
      }
    }
    const sn = sensor.current
    if (sn) {
      const mLat = 111320
      const mLng = 111320 * Math.cos(CesiumMath.toRadians(g.lat))
      const hd = CesiumMath.toRadians(frame.heading + (gimbal?.yaw ?? 0))
      const at = (fwd: number, side: number) => {
        const e = Math.sin(hd) * fwd + Math.cos(hd) * side
        const n = Math.cos(hd) * fwd - Math.sin(hd) * side
        return Cartesian3.fromDegrees(g.lng + e / mLng, g.lat + n / mLat, 0)
      }
      // Perspective footprint: a tilted camera sees a trapezoid, nadir sees a square.
      const tilt = Math.min(Math.max(90 + (gimbal?.pitch ?? -90), 0), SENSOR_MAX_TILT)
      const nearA = CesiumMath.toRadians(tilt - SENSOR_VFOV / 2)
      const farA = CesiumMath.toRadians(Math.min(tilt + SENSOR_VFOV / 2, SENSOR_MAX_TILT + 6))
      const halfW = (angle: number) =>
        (alt / Math.cos(angle)) * Math.tan(CesiumMath.toRadians(SENSOR_HFOV / 2))
      const near = alt * Math.tan(nearA)
      const far = alt * Math.tan(farA)
      const corners = [
        at(near, -halfW(nearA)),
        at(near, halfW(nearA)),
        at(far, halfW(farA)),
        at(far, -halfW(farA)),
      ]
      aim.current = at(alt * Math.tan(CesiumMath.toRadians(tilt)), 0)
      // Velocity vector: a short line ahead of the nose at flight level.
      const hv = CesiumMath.toRadians(frame.heading)
      const reach = frame.groundSpeed > 0 ? 18 + frame.groundSpeed * 1.5 : 0
      lines.current.vector = reach
        ? [
            pos,
            Cartesian3.fromDegrees(
              g.lng + (Math.sin(hv) * reach) / mLng,
              g.lat + (Math.cos(hv) * reach) / mLat,
              alt,
            ),
          ]
        : []
      lines.current.outline = [...corners, corners[0]]
      lines.current.edges = corners.map(c => [pos, c])
      const hg = geo(home)
      const dx = frame.position.x - home.x
      const dy = frame.position.y - home.y
      const meters = Math.hypot(dx, dy) * metersPerUnit
      const bearing = Math.round((CesiumMath.toDegrees(Math.atan2(-dx, dy)) + 360) % 360)
      lines.current.task = [pos, Cartesian3.fromDegrees(hg.lng, hg.lat, 0)]
      sn.pill.position = new ConstantProperty(
        Cartesian3.fromDegrees((g.lng + hg.lng) / 2, (g.lat + hg.lat) / 2, alt / 2),
      ) as never
      sn.pill.label!.text = new ConstantProperty(
        `${String(bearing).padStart(3, '0')}\u00b0 \u00b7 ${(meters / 1000).toFixed(2)} km`,
      ) as never
    }
    if (altLabel.current) {
      altLabel.current.position = new ConstantProperty(
        Cartesian3.fromDegrees(g.lng, g.lat, alt / 2),
      ) as never
      if (altLabel.current.label)
        altLabel.current.label.text = new ConstantProperty(`${Math.round(alt)} m`) as never
    }
    lines.current.stem = [Cartesian3.fromDegrees(g.lng, g.lat, 0), pos]
    if (hud) {
      const ft = Math.round(frame.altitude * 3.28084)
      const kts = Math.round(frame.groundSpeed * 1.944)
      hudTarget.current = {
        position: pos,
        title: [callsign, `${ft} ft`, frame.groundSpeed > 0 ? `${kts} kts` : '']
          .filter(Boolean)
          .join(' · '),
        details: hud.details,
      }
    } else hudTarget.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, pathKey, altitude, areas, metersPerUnit, gimbal, hud, callsign, originKey])

  useEffect(() => {
    lines.current.trail = trail.map(p => {
      const g = geo(p)
      return Cartesian3.fromDegrees(g.lng, g.lat, altitude + 1.5)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, pathKey, altitude, areas, metersPerUnit, originKey])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    handleEntities.current.forEach(e => viewer.entities.remove(e))
    const pulse = new CallbackProperty(
      () => 5 + 2.5 * (0.5 + 0.5 * Math.sin(performance.now() / 420)),
      false,
    ) as never
    handleEntities.current = handles.flatMap(h => {
      const g = toGeo(h.point, metersPerUnit)
      const zone = h.kind === 'zone'
      const color = zone ? AMBER : TEAL
      const top = zone ? ZONE_HEIGHT : Math.max(altitude, 10)
      const id = `handle:${h.kind}:${h.index}:${h.zone ?? ''}`
      const label =
        h.kind === 'wp'
          ? `WP ${String(h.index + 1).padStart(2, '0')}`
          : h.kind === 'area'
            ? `A${h.index + 1}`
            : h.kind === 'zone'
              ? `Z${(h.zone ?? 0) + 1}.${h.index + 1}`
              : h.kind === 'center'
                ? 'ORBIT'
                : 'ANCHOR'
      const ground = Cartesian3.fromDegrees(g.lng, g.lat, 0.5)
      const air = Cartesian3.fromDegrees(g.lng, g.lat, top)
      return [
        // Ground ring: where the point sits on the terrain.
        viewer.entities.add({
          id: `${id}:ring`,
          position: ground as never,
          ellipse: {
            semiMajorAxis: 9,
            semiMinorAxis: 9,
            material: color.withAlpha(0.12),
            outline: true,
            outlineColor: color.withAlpha(0.9),
            outlineWidth: 2,
            height: 0,
          },
          point: {
            pixelSize: pulse,
            color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
        // Beacon column: a faint volume so the point reads in 3D, not just as a line.
        viewer.entities.add({
          id: `${id}:beacon`,
          position: Cartesian3.fromDegrees(g.lng, g.lat, top / 2) as never,
          cylinder: {
            length: top,
            topRadius: 1.6,
            bottomRadius: 3,
            material: color.withAlpha(0.1),
            outline: false,
          },
        }),
        // Stem: ties the ground ring to the flight-level handle.
        viewer.entities.add({
          id: `${id}:stem`,
          polyline: {
            positions: new CallbackProperty(() => [ground, air], false) as never,
            width: 1.5,
            material: new PolylineDashMaterialProperty({
              color: color.withAlpha(0.75),
              dashLength: 8,
            }),
          },
        }),
        // Handle: lives at flight altitude so the route passes through it.
        viewer.entities.add({
          id,
          position: air as never,
          point: {
            pixelSize: 13,
            color: Color.fromCssColorString('#0b141c'),
            outlineColor: color,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: label,
            font: '600 10px monospace',
            fillColor: color,
            pixelOffset: new Cartesian2(14, -12),
            horizontalOrigin: HorizontalOrigin.LEFT,
            showBackground: true,
            backgroundColor: Color.BLACK.withAlpha(0.65),
            backgroundPadding: new Cartesian2(5, 3),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      ]
    })
  }, [handles, metersPerUnit, pathKey, altitude, originKey])

  useEffect(() => {
    const layer = imagery.current
    const viewer = viewerRef.current
    if (!layer || !viewer) return
    layer.brightness = tactical ? 0.5 : 0.8
    layer.contrast = tactical ? 1.3 : 1
    layer.saturation = tactical ? 0.08 : 0.8
    layer.hue = tactical ? 3.7 : 0
    viewer.scene.globe.baseColor = Color.fromCssColorString(tactical ? '#081c2c' : '#0a1418')
  }, [tactical])

  const modeReady = useRef(false)
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const ctl = viewer.scene.screenSpaceCameraController
    ctl.enableTilt = view3d
    ctl.enableLook = view3d
    if (!view3d) setChase(false)
    if (!modeReady.current) {
      modeReady.current = true
      return
    }
    orbit(0, CesiumMath.toRadians(view3d ? -38 : -90))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3d])

  const orbit = (heading?: number, pitch?: number, range?: number) => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return
    const cam = viewer.camera
    const rect = viewer.scene.canvas
    const center = cam.pickEllipsoid(
      new Cartesian2(rect.clientWidth / 2, rect.clientHeight / 2),
      viewer.scene.globe.ellipsoid,
    )
    if (!center) return
    const dist = Cartesian3.distance(cam.positionWC, center)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), {
      offset: new HeadingPitchRange(heading ?? cam.heading, pitch ?? cam.pitch, range ?? dist),
      duration: 0.6,
    })
  }

  return (
    <div className="flight-3d">
      <div ref={host} className="cesium-host" aria-label="3D flight view">
        {hud && (
          <>
            <canvas ref={hudSurface} className="hud-surface" />
            <canvas ref={hudCards} className="hud-cards" />
          </>
        )}
      </div>
      <div className="flight-3d-tools">
        {view3d && (
          <button className={chase ? 'on' : ''} onClick={() => setChase(c => !c)}>
            {chase ? 'FREE CAM' : 'CHASE CAM'}
          </button>
        )}
        <button className={tactical ? 'on' : ''} onClick={() => setTactical(t => !t)}>
          {tactical ? 'TACTICAL' : 'SATELLITE'}
        </button>
        <button
          onClick={() =>
            viewerRef.current?.camera.zoomIn(
              (viewerRef.current.camera.positionCartographic.height || 200) * 0.35,
            )
          }
        >
          +
        </button>
        <button
          onClick={() =>
            viewerRef.current?.camera.zoomOut(
              (viewerRef.current.camera.positionCartographic.height || 200) * 0.5,
            )
          }
        >
          -
        </button>
      </div>
    </div>
  )
}
