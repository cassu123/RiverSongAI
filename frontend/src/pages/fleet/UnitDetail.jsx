import React from 'react'
import { useParams } from 'react-router-dom'
export default function UnitDetail() {
  const { id } = useParams()
  return <div className="rs-card"><h3>Unit Detail: {id}</h3><p>Live telemetry and SSE status goes here.</p></div>
}
