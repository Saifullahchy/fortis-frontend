export type VehicleType = 'UAV' | 'UGV' | 'USV' | 'UUV'
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
export interface PlannerDraft {
  planMode: 'survey' | 'p2p' | 'orbit' | 'maneuver'
  altitude: number
  speed: number
  overlap: number
  spacing: number
  returnAltitude: number
  linkLoss: string
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
  activePreset: Record<'survey' | 'p2p' | 'orbit' | 'maneuver', string>
  customSurvey: {
    points: PlanPoint[]
    zones: PlanPoint[][]
    spacing: number
    overlap: number
  } | null
}
export interface MissionPlan {
  draft?: PlannerDraft
  /** Planner path in screen units; keeps Live Flight on the exact planned geometry. */
  pathData?: string
  mode: string
  altitude: number
  speed: number
  transitMeters: [number, number]
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
