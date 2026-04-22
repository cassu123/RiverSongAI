import React from 'react'
import MaintenancePulse from '../components/MaintenancePulse.jsx'

export default function MaintenancePulsePage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>TOOLS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>MAINTENANCE PULSE</span>
      </div>
      <h1 className="page-title">Maintenance Pulse</h1>
      <p className="page-subtitle">
        Track service history, inspection specs, and maintenance logs for your vehicles.
      </p>
      <MaintenancePulse />
    </div>
  )
}
