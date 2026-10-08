import { CallbackProperty, Cartesian3, Color, PolylineGlowMaterialProperty } from 'cesium'

/** Shared palette for everything drawn on the mission map (planning and live flight). */
export const MAP_COLORS = {
  plan: Color.fromCssColorString('#2fe0c0'),
  flown: Color.fromCssColorString('#ff6a00'),
  zone: Color.fromCssColorString('#f0b35a'),
  sensor: Color.fromCssColorString('#4da3ff'),
  areaGlow: Color.fromCssColorString('#5ff5d8'),
} as const

/**
 * The one path style used for every route line. The planned route is always the plan colour
 * on both pages; the completed part of a flight is drawn with the same line in the flown colour.
 */
export const routeLine = (read: () => Cartesian3[], color: Color) => ({
  positions: new CallbackProperty(read, false) as never,
  width: 4.5,
  material: new PolylineGlowMaterialProperty({
    color: color.withAlpha(0.95),
    glowPower: 0.12,
    taperPower: 1,
  }),
})
