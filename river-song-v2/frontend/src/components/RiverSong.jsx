// =============================================================================
// src/components/RiverSong.jsx
//
// The holographic River Song figure -- Cortana-inspired, Halo aesthetic.
//
// Renders onto a canvas using the 2D API. No external 3D libraries needed.
// The figure is a glowing line-art humanoid silhouette built from arcs and
// line segments, layered with concentric rings and orbital particles.
//
// Visual states:
//   idle        -- slow, gentle pulse on the rings
//   listening   -- rings expand with mic audioLevel input
//   transcribing-- figure dims slightly, rings slow
//   thinking    -- particles orbit at increased speed
//   speaking    -- scan line pulses, rings flare with audioLevel
//   error       -- accent color shifts to red/orange
//
// Props:
//   state      {string} Current conversation state
//   audioLevel {number} Mic amplitude 0-1 (used in listening + speaking)
// =============================================================================

import React, { useEffect, useRef } from 'react'

// Colors keyed by conversation state
const STATE_COLORS = {
  idle:         '#00aaff',
  connecting:   '#005588',
  listening:    '#00ffee',
  transcribing: '#0088cc',
  thinking:     '#aa44ff',
  speaking:     '#00ffaa',
  error:        '#ff4422',
}

const DEFAULT_COLOR = '#00aaff'

export default function RiverSong({ state, audioLevel }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  const color = STATE_COLORS[state] || DEFAULT_COLOR

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    const CX = W / 2
    const CY = H / 2

    let startTime = null

    const draw = (timestamp) => {
      if (!startTime) startTime = timestamp
      const t = (timestamp - startTime) / 1000  // Seconds elapsed

      ctx.clearRect(0, 0, W, H)

      // ---------------------------------------------------------------
      // Pulse scale -- how much the rings breathe
      // ---------------------------------------------------------------
      const pulseRate = state === 'idle' ? 1.5 : state === 'thinking' ? 4.0 : 2.5
      const pulseAmp  = state === 'idle' ? 0.03 : 0.06 + audioLevel * 0.12
      const pulse     = 1 + pulseAmp * Math.sin(t * pulseRate)

      // ---------------------------------------------------------------
      // Outer glow halo
      // ---------------------------------------------------------------
      const outerR = 112 * pulse
      const grd = ctx.createRadialGradient(CX, CY, outerR * 0.55, CX, CY, outerR)
      grd.addColorStop(0, rgba(color, 0.14))
      grd.addColorStop(1, rgba(color, 0))
      ctx.beginPath()
      ctx.arc(CX, CY, outerR, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()

      // ---------------------------------------------------------------
      // Concentric rings
      // ---------------------------------------------------------------
      const ringCount = state === 'thinking' ? 5 : 3

      for (let i = 0; i < ringCount; i++) {
        const phase = (t * (0.4 + i * 0.25) + i * 0.6) % (Math.PI * 2)
        const baseR  = (38 + i * 22) * pulse
        const alpha  = Math.max(0.05, Math.min(0.9,
          0.28 + 0.35 * Math.sin(phase) + audioLevel * 0.45
        ))
        const lw = state === 'speaking'
          ? 1.5 + audioLevel * 5
          : state === 'listening'
          ? 1.5 + audioLevel * 3
          : 1.5

        ctx.beginPath()
        ctx.arc(CX, CY, baseR, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(color, alpha)
        ctx.lineWidth   = lw
        ctx.stroke()
      }

      // ---------------------------------------------------------------
      // Holographic humanoid figure
      // ---------------------------------------------------------------
      ctx.save()
      ctx.translate(CX, CY)
      ctx.strokeStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur  = 10 + audioLevel * 22
      ctx.lineWidth   = 1.5
      ctx.lineCap     = 'round'

      // Head
      ctx.beginPath()
      ctx.arc(0, -52, 13, 0, Math.PI * 2)
      ctx.stroke()

      // Neck
      ctx.beginPath()
      ctx.moveTo(0, -39)
      ctx.lineTo(0, -30)
      ctx.stroke()

      // Shoulders
      ctx.beginPath()
      ctx.moveTo(-22, -25)
      ctx.lineTo(22, -25)
      ctx.stroke()

      // Left arm
      ctx.beginPath()
      ctx.moveTo(-22, -25)
      ctx.lineTo(-28,  2)
      ctx.lineTo(-22, 26)
      ctx.stroke()

      // Right arm
      ctx.beginPath()
      ctx.moveTo(22, -25)
      ctx.lineTo(28,  2)
      ctx.lineTo(22, 26)
      ctx.stroke()

      // Torso (trapezoid)
      ctx.beginPath()
      ctx.moveTo(-14, -25)
      ctx.lineTo(-11,  10)
      ctx.lineTo( 11,  10)
      ctx.lineTo( 14, -25)
      ctx.stroke()

      // Left leg
      ctx.beginPath()
      ctx.moveTo(-7, 10)
      ctx.lineTo(-9, 50)
      ctx.stroke()

      // Right leg
      ctx.beginPath()
      ctx.moveTo(7, 10)
      ctx.lineTo(9, 50)
      ctx.stroke()

      // Scan line -- moves top to bottom while active, hidden when idle
      if (state !== 'idle' && state !== 'connecting') {
        const scanY = ((t * 38) % 108) - 54
        ctx.beginPath()
        ctx.moveTo(-28, scanY)
        ctx.lineTo( 28, scanY)
        ctx.strokeStyle = rgba(color, 0.45)
        ctx.lineWidth   = 1
        ctx.shadowBlur  = 4
        ctx.stroke()
      }

      ctx.restore()

      // ---------------------------------------------------------------
      // Orbital particles (visible during 'thinking')
      // ---------------------------------------------------------------
      if (state === 'thinking') {
        const count = 6
        for (let i = 0; i < count; i++) {
          const angle = t * 1.4 + (i * Math.PI * 2) / count
          const r     = 78 + 9 * Math.sin(t * 2.5 + i * 1.1)
          const px    = CX + Math.cos(angle) * r
          const py    = CY + Math.sin(angle) * r
          const alpha = 0.5 + 0.4 * Math.sin(t * 3 + i)

          ctx.beginPath()
          ctx.arc(px, py, 3, 0, Math.PI * 2)
          ctx.fillStyle  = rgba(color, alpha)
          ctx.shadowColor = color
          ctx.shadowBlur  = 8
          ctx.fill()
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [state, color, audioLevel])

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={300}
      className="river-song-canvas"
      aria-label={`River Song holographic figure, current state: ${state}`}
    />
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 6-digit hex color and alpha to an rgba() string.
 *
 * @param {string} hex   - Six-digit hex color, e.g. '#00aaff'
 * @param {number} alpha - Opacity 0.0 to 1.0
 * @returns {string}
 */
function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}
