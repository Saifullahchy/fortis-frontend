import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { FleetPage } from '../features/pages/FleetPage'
import { VehicleDashboard } from '../features/pages/VehicleDashboard'
import { MissionsPage } from '../features/pages/MissionsPage'
export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<FleetPage />} />
        <Route path="/missions" element={<MissionsPage />} />
        <Route path="/missions/:vehicleId" element={<MissionsPage />} />
        <Route path="/vehicles/:id" element={<VehicleDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
