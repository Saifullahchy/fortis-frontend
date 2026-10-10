import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { FleetPage } from '../features/pages/FleetPage'
import { VehicleDashboard } from '../features/pages/VehicleDashboard'
import { MissionsPage } from '../features/pages/MissionsPage'
import { DemoLanding } from '../features/walkthrough/DemoLanding'
import { WalkthroughOverlay } from '../features/walkthrough/WalkthroughOverlay'
import { WalkthroughProvider, useWalkthrough } from '../features/walkthrough/WalkthroughContext'

function Console() {
  const { session } = useWalkthrough()
  return (
    // Keyed by the demo session so every workspace remounts when a chapter starts.
    <AppShell key={session}>
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

export default function App() {
  return (
    <WalkthroughProvider>
      <Routes>
        <Route path="/demo" element={<DemoLanding />} />
        <Route path="/*" element={<Console />} />
      </Routes>
      <WalkthroughOverlay />
    </WalkthroughProvider>
  )
}
