import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { platformApi } from '../services/api/baseApi'
type MapMode = 'TACTICAL' | 'SATELLITE' | 'TERRAIN' | '3D'
type CameraMode = 'TOP' | '3D' | 'FOLLOW'
const map = createSlice({
  name: 'map',
  initialState: {
    mode: 'TACTICAL' as MapMode,
    camera: 'TOP' as CameraMode,
    layers: ['vehicles', 'missions', 'geofences'] as string[],
  },
  reducers: {
    setMapMode: (s, a: PayloadAction<MapMode>) => {
      s.mode = a.payload
    },
    setCamera: (s, a: PayloadAction<CameraMode>) => {
      s.camera = a.payload
    },
    toggleLayer: (s, a: PayloadAction<string>) => {
      s.layers = s.layers.includes(a.payload)
        ? s.layers.filter(x => x !== a.payload)
        : [...s.layers, a.payload]
    },
  },
})
const selection = createSlice({
  name: 'selection',
  initialState: { selectedVehicleId: 'UAV-001', controlledVehicleId: null as string | null },
  reducers: {
    selectVehicle: (s, a: PayloadAction<string>) => {
      s.selectedVehicleId = a.payload
    },
    takeControl: (s, a: PayloadAction<string | null>) => {
      s.controlledVehicleId = a.payload
    },
  },
})
export const actions = { ...map.actions, ...selection.actions }
export const store = configureStore({
  reducer: {
    map: map.reducer,
    selection: selection.reducer,
    [platformApi.reducerPath]: platformApi.reducer,
  },
  middleware: g => g().concat(platformApi.middleware),
})
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
