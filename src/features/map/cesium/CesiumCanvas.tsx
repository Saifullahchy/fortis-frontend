import { useEffect, useRef } from 'react'
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeadingPitchRange,
  Math as CesiumMath,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { addBoundariesLayer } from '../referenceLayers'

type MapMode = 'TACTICAL' | 'SATELLITE' | 'TERRAIN' | '3D'
type CameraMode = 'TOP' | '3D' | 'FOLLOW'
const positions: Record<string, [number, number]> = {
  'UAV-001': [90.407, 23.78],
  'UAV-002': [90.36, 23.81],
  'UGV-001': [90.39, 23.76],
  'UGV-002': [90.45, 23.82],
  'USV-001': [90.46, 23.74],
  'UUV-001': [90.44, 23.77],
}

function providerFor(mode: MapMode) {
  if (mode === 'SATELLITE' || mode === '3D')
    return new UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri World Imagery',
    })
  if (mode === 'TERRAIN')
    return new UrlTemplateImageryProvider({
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      subdomains: ['a', 'b', 'c'],
      credit: 'OpenTopoMap',
    })
  return new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
}

export interface ViewBounds {
  west: number
  south: number
  east: number
  north: number
}

export function CesiumCanvas({
  mode,
  camera,
  selectedVehicleId,
  zoomStep,
  focus,
  onView,
}: {
  mode: MapMode
  camera: CameraMode
  selectedVehicleId: string
  zoomStep: number
  focus?: { lng: number; lat: number; height: number }
  onView?: (bounds: ViewBounds | null) => void
}) {
  const host = useRef<HTMLDivElement>(null),
    viewerRef = useRef<Viewer | null>(null),
    lastZoom = useRef(0),
    onViewRef = useRef(onView)
  onViewRef.current = onView
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
    viewerRef.current = viewer
    viewer.scene.globe.baseColor = Color.fromCssColorString('#101c23')
    viewer.scene.backgroundColor = Color.fromCssColorString('#091119')
    viewer.scene.globe.enableLighting = false
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(90.407, 23.78, 33000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
    })
    let signature = ''
    const report = () => {
      const cb = onViewRef.current
      if (!cb) return
      const canvas = viewer.scene.canvas
      const cam = viewer.camera
      const topDown =
        Math.abs(CesiumMath.toDegrees(cam.pitch) + 90) < 1.5 &&
        Math.min(cam.heading, 2 * Math.PI - cam.heading) < CesiumMath.toRadians(1.5)
      const cart = (x: number, y: number) => {
        const hit = cam.pickEllipsoid(new Cartesian2(x, y), viewer.scene.globe.ellipsoid)
        return hit ? Cartographic.fromCartesian(hit) : null
      }
      const tl = topDown ? cart(0, 0) : null
      const br = topDown ? cart(canvas.clientWidth, canvas.clientHeight) : null
      const next =
        tl && br ? `${tl.longitude},${tl.latitude},${br.longitude},${br.latitude}` : 'off'
      if (next === signature) return
      signature = next
      cb(
        tl && br
          ? {
              west: CesiumMath.toDegrees(tl.longitude),
              north: CesiumMath.toDegrees(tl.latitude),
              east: CesiumMath.toDegrees(br.longitude),
              south: CesiumMath.toDegrees(br.latitude),
            }
          : null,
      )
    }
    viewer.scene.postRender.addEventListener(report)
    return () => {
      viewerRef.current = null
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(report)
        viewer.destroy()
      }
    }
  }, [])
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    v.imageryLayers.removeAll()
    const layer = v.imageryLayers.addImageryProvider(providerFor(mode))
    layer.brightness = mode === 'TACTICAL' ? 0.58 : mode === 'TERRAIN' ? 0.82 : 1
    layer.contrast = mode === 'TACTICAL' ? 1.12 : 1
    // Imagery carries no names; overlay borders and places so the sector reads in context.
    if (mode === 'SATELLITE' || mode === '3D') addBoundariesLayer(v)
  }, [mode])
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    if (camera === 'TOP')
      v.camera.flyTo({
        destination: focus
          ? Cartesian3.fromDegrees(focus.lng, focus.lat, focus.height)
          : Cartesian3.fromDegrees(90.407, 23.78, 33000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
        duration: 0.7,
      })
    else if (camera === '3D')
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(90.407, 23.7, 24000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-38), roll: 0 },
        duration: 0.7,
      })
    else {
      const [lng, lat] = positions[selectedVehicleId] ?? positions['UAV-001']
      v.camera.lookAt(
        Cartesian3.fromDegrees(lng, lat, 0),
        new HeadingPitchRange(CesiumMath.toRadians(15), CesiumMath.toRadians(-48), 8500),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, selectedVehicleId, focus?.lng, focus?.lat, focus?.height])
  useEffect(() => {
    const v = viewerRef.current
    if (!v || zoomStep === lastZoom.current) return
    zoomStep > lastZoom.current
      ? v.camera.zoomIn(v.camera.positionCartographic.height * 0.28)
      : v.camera.zoomOut(v.camera.positionCartographic.height * 0.35)
    lastZoom.current = zoomStep
  }, [zoomStep])
  return (
    <div
      ref={host}
      className="cesium-host"
      aria-label={`Interactive Cesium ${mode.toLowerCase()} map`}
    />
  )
}
