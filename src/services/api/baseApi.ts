import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import { missions, vehicles as demoFleet } from './mockData'
import { loadFleet, saveFleet } from './fleetStorage'
import { loadPlans, savePlans } from './missionStorage'
import type { Mission, Vehicle, VehicleCapability, VehicleType } from '../../types/domain'

export interface NewVehicle {
  name: string
  type: VehicleType
  controller: string
  firmware?: string
  board?: string
  protocol: string
  connection: string
}

export type NewMissionPlan = Pick<Mission, 'name' | 'vehicleId' | 'waypoints' | 'plan'>

const capabilitiesByType: Record<VehicleType, VehicleCapability[]> = {
  UAV: ['goto', 'takeoff', 'land', 'returnHome', 'video'],
  UGV: ['goto', 'manualControl', 'hold', 'returnBase', 'video'],
  USV: ['goto', 'hold', 'returnBase', 'video', 'sonar'],
  UUV: ['goto', 'hold', 'dive', 'surface', 'sonar'],
}

function createVehicle(input: NewVehicle, fleet: Vehicle[]): Vehicle {
  const used = fleet.filter(v => v.type === input.type).length
  let n = used + 1
  while (fleet.some(v => v.id === `${input.type}-${String(n).padStart(3, '0')}`)) n += 1
  return {
    id: `${input.type}-${String(n).padStart(3, '0')}`,
    name: input.name.trim() || `${input.type} ${n}`,
    type: input.type,
    status: 'online',
    health: 'healthy',
    battery: 100,
    protocol: input.protocol,
    controller: input.controller,
    firmware: input.firmware,
    board: input.board,
    connection: input.connection,
    mode: 'STANDBY',
    mission: 'None',
    lastSeen: 'Now',
    lat: 30 + Math.round(Math.random() * 40),
    lng: 30 + Math.round(Math.random() * 40),
    heading: 0,
    speed: 0,
    link: 90,
    capabilities: capabilitiesByType[input.type],
  }
}

export const platformApi = createApi({
  reducerPath: 'platformApi',
  baseQuery: fakeBaseQuery(),
  tagTypes: ['Vehicle', 'Mission'],
  endpoints: b => ({
    getVehicles: b.query<Vehicle[], void>({
      queryFn: async () => ({ data: loadFleet() }),
      providesTags: ['Vehicle'],
    }),
    getVehicle: b.query<Vehicle, string>({
      queryFn: async id => {
        const vehicle = loadFleet().find(v => v.id === id)
        return vehicle ? { data: vehicle } : { error: { status: 404, data: 'Vehicle not found' } }
      },
      providesTags: ['Vehicle'],
    }),
    getMissions: b.query<Mission[], void>({
      queryFn: async () => {
        const ids = new Set(loadFleet().map(v => v.id))
        return { data: [...missions, ...loadPlans()].filter(m => ids.has(m.vehicleId)) }
      },
      providesTags: ['Vehicle', 'Mission'],
    }),
    saveMissionPlan: b.mutation<Mission, NewMissionPlan>({
      queryFn: async input => {
        // Autosave keeps the draft; the vehicle only flies what was explicitly uploaded.
        const saved: Mission = {
          ...input,
          id: `PLN-${input.vehicleId}`,
          status: 'idle',
          progress: 0,
          updatedAt: new Date().toISOString(),
        }
        savePlans([...loadPlans().filter(m => m.vehicleId !== input.vehicleId), saved])
        return { data: saved }
      },
      invalidatesTags: ['Mission'],
    }),
    uploadMissionPlan: b.mutation<Mission, string>({
      queryFn: async vehicleId => {
        const plans = loadPlans()
        const plan = plans.find(m => m.vehicleId === vehicleId)
        if (!plan) return { error: { status: 404, data: 'No plan to upload' } }
        const uploaded: Mission = { ...plan, status: 'ready', updatedAt: new Date().toISOString() }
        savePlans(plans.map(m => (m.vehicleId === vehicleId ? uploaded : m)))
        return { data: uploaded }
      },
      invalidatesTags: ['Mission'],
    }),
    addVehicle: b.mutation<Vehicle, NewVehicle>({
      queryFn: async input => {
        const fleet = loadFleet()
        const vehicle = createVehicle(input, fleet)
        saveFleet([...fleet, vehicle])
        return { data: vehicle }
      },
      invalidatesTags: ['Vehicle'],
    }),
    removeVehicle: b.mutation<null, string>({
      queryFn: async id => {
        saveFleet(loadFleet().filter(v => v.id !== id))
        return { data: null }
      },
      invalidatesTags: ['Vehicle'],
    }),
    loadDemoFleet: b.mutation<null, void>({
      queryFn: async () => {
        saveFleet(demoFleet)
        return { data: null }
      },
      invalidatesTags: ['Vehicle'],
    }),
  }),
})
export const {
  useGetVehiclesQuery,
  useGetVehicleQuery,
  useGetMissionsQuery,
  useSaveMissionPlanMutation,
  useUploadMissionPlanMutation,
  useAddVehicleMutation,
  useRemoveVehicleMutation,
  useLoadDemoFleetMutation,
} = platformApi
