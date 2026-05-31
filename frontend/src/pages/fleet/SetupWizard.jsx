import React from 'react'
import { useParams } from 'react-router-dom'
export default function SetupWizard() {
  const { id } = useParams()
  return <div className="rs-card"><h3>Setup Wizard: {id}</h3><p>8-step configuration wizard.</p></div>
}
