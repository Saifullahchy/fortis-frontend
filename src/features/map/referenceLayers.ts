import { UrlTemplateImageryProvider, type Viewer } from 'cesium'

/**
 * Country borders and place names drawn over the imagery, so an operator can tell at a glance
 * which country, region and city a sector sits in once they zoom out from the mission area.
 */
export function addBoundariesLayer(viewer: Viewer) {
  const layer = viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri Boundaries & Places',
      maximumLevel: 19,
    }),
  )
  layer.alpha = 0.95
  return layer
}
