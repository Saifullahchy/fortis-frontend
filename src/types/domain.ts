export type VehicleType = 'UAV' | 'UGV' | 'USV' | 'UUV'
/** Operating medium. Drives the motion model, instruments and vocabulary; never the protocol. */
export type VehicleDomain = 'air' | 'ground' | 'surface' | 'underwater'
export type VehicleCapability =
  | 'goto'
  | 'manualControl'
  | 'takeoff'
  | 'land'
  | 'returnHome'
  | 'returnBase'
  | 'hold'
  | 'dive'
  | 'surface'
  | 'video'
  | 'thermal'
  | 'lidar'
  | 'radar'
  | 'sonar'
export type VehicleStatus = 'online' | 'warning' | 'offline'
export interface Vehicle {
  id: string
  name: string
  type: VehicleType
  status: VehicleStatus
  health: 'healthy' | 'warning' | 'critical'
  battery: number
  protocol: string
  controller: string
  firmware?: string
  board?: string
  connection: string
  mode: string
  mission: string
  lastSeen: string
  lat: number
  lng: number
  heading: number
  speed: number
  link: number
  capabilities: VehicleCapability[]
}
export type MissionStatus =
  'idle' | 'ready' | 'executing' | 'paused' | 'completed' | 'aborted' | 'failed'
export interface MissionWaypoint {
  id: string
  latitude: number
  longitude: number
  altitude?: number
  depth?: number
}
export interface PlanPoint {
  x: number
  y: number
}
/**
 * Every plan mode the planner knows. Which ones a vehicle offers, and what they are called, comes
 * from its profile: a UAV surveys, a UGV covers; a UAV flies point-to-point, a UGV drives a route.
 */
export type PlanMode =
  'survey' | 'p2p' | 'orbit' | 'maneuver' | 'route' | 'patrol' | 'coverage' | 'street'
/** Road classes a ground vehicle may use when routing along streets. */
export type RoadClass = 'roads' | 'service' | 'paths'
export interface StreetOptions {
  classes: RoadClass[]
  /** Penalise primary and secondary roads so the route prefers quieter streets. */
  avoidMajor: boolean
  /** How far off the nearest street a target may sit and still be driven to, metres. */
  approachMeters: number
}
export type PlanGeometry = 'area' | 'points' | 'orbit' | 'maneuver'
export interface PlannerDraft {
  planMode: PlanMode
  /** Numeric parameters keyed by the profile's parameter ids (speed, altitude, spacing, …). */
  params: Record<string, number>
  linkLoss: string
  street: StreetOptions
  /** Ground coverage: sweep the streets in the area, or the open ground between obstacles. */
  coverageStyle?: 'auto' | 'streets' | 'field'
  surveyPoints: PlanPoint[]
  boundaryComplete: boolean
  zones: PlanPoint[][]
  waypoints: PlanPoint[]
  orbitCenter: PlanPoint | null
  orbitRadius: number
  orbitLaps: number
  clockwise: boolean
  pattern: 'figure8' | 'racetrack' | 'zigzag'
  anchor: PlanPoint | null
  patternSize: number
  heading: number
  repeats: number
  activePreset: Partial<Record<PlanMode, string>>
  customSurvey: {
    points: PlanPoint[]
    zones: PlanPoint[][]
    spacing: number
    overlap: number
  } | null
}
export interface MissionPlan {
  draft?: PlannerDraft
  /** Planner path in screen units; keeps the live view on the exact planned geometry. */
  pathData?: string
  mode: string
  domain: VehicleDomain
  /** Cruise height for air vehicles, depth for underwater ones, 0 otherwise. */
  altitude: number
  speed: number
  transitMeters: [number, number]
  /** Path lengths (screen units) where the vehicle stops and dwells, for ground-style routes. */
  stopUnits?: number[]
  dwellSeconds?: number
  /** Waypoint acceptance radius, metres, for ground-style routes. */
  acceptMeters?: number
  /** Building footprints the route steers around, detected from map data (screen units). */
  autoObstacles?: PlanPoint[][]
}
export interface Mission {
  id: string
  name: string
  vehicleId: string
  status: MissionStatus
  progress: number
  waypoints: MissionWaypoint[]
  plan?: MissionPlan
  updatedAt?: string
}
export type PortDataType =
  | 'position'
  | 'orientation'
  | 'velocity'
  | 'telemetry'
  | 'command'
  | 'video'
  | 'image'
  | 'lidar'
  | 'radar'
  | 'sonar'
  | 'network'
  | 'serial'
  | 'can'
  | 'power'
export interface ComponentPort {
  id: string
  name: string
  direction: 'input' | 'output'
  dataType: PortDataType
}
