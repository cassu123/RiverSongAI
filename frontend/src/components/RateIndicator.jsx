import React, { useEffect, useState } from 'react'

export default function RateIndicator({ activeModel, token }) {
  const [rpm, setRpm] = useState(null)

  const isNimOrAuto = activeModel?.provider === 'nvidia_nim' || activeModel?.provider === 'auto'

  useEffect(() => {
    if (!isNimOrAuto) {
      setRpm(null)
      return
    }

    let mounted = true
    const fetchRate = async () => {
      try {
        // Fetch the global rate from our new endpoint
        const API_BASE = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${API_BASE}/api/settings/provider-rate?provider=nvidia_nim`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (res.ok) {
          const data = await res.json()
          if (mounted) setRpm(data.rpm)
        }
      } catch (err) {}
    }

    fetchRate()
    const iv = setInterval(fetchRate, 5000)
    return () => {
      mounted = false
      clearInterval(iv)
    }
  }, [isNimOrAuto, token])

  if (!isNimOrAuto || rpm === null) return null

  return (
    <span className="rs-pill" style={{
      fontSize: '0.65rem',
      marginLeft: 12,
      background: 'rgba(16, 185, 129, 0.15)',
      color: '#10b981',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      fontWeight: 600
    }} title="NVIDIA NIM Requests Per Minute">
      <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 4 }}>speed</span>
      NIM {rpm} RPM
    </span>
  )
}
