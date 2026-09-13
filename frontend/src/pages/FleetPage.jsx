// =============================================================================
// pages/FleetPage.jsx
//
// Top-level dispatcher for the embodiment ecosystem. Mounted for any /fleet*
// URL (the app derives the page key from the first path segment). Routes the
// hub, Vector's rich console, and each program's bespoke console.
// =============================================================================

import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import FleetHub from './fleet/FleetHub.jsx'
import VectorFleetPage from './VectorFleetPage.jsx'
import HorizonFleet from './fleet/programs/Horizon.jsx'
import VexaFleet from './fleet/programs/Vexa.jsx'
import KovaFleet from './fleet/programs/Kova.jsx'
import VortexFleet from './fleet/programs/Vortex.jsx'
import SentinelFleet from './fleet/programs/Sentinel.jsx'

export default function FleetPage({ setAction }) {
  return (
    <Routes>
      <Route path="/fleet" element={<FleetHub />} />
      {/* Vector keeps its rich multi-page console under /fleet/vector/* */}
      <Route path="/fleet/vector/*" element={<VectorFleetPage setAction={setAction} />} />
      <Route path="/fleet/vexa" element={<VexaFleet />} />
      <Route path="/fleet/horizon" element={<HorizonFleet />} />
      <Route path="/fleet/kova" element={<KovaFleet />} />
      <Route path="/fleet/vortex" element={<VortexFleet />} />
      <Route path="/fleet/sentinel" element={<SentinelFleet />} />
      <Route path="*" element={<Navigate to="/fleet" replace />} />
    </Routes>
  )
}
