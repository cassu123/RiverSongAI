// =============================================================================
// src/components/AudioVisualizer.jsx
//
// Circular audio bar visualizer layered behind the RiverSong figure.
//
// Renders 32 radial bars arranged in a circle. Bar heights respond to the
// audioLevel prop (0-1) with a small noise oscillation added so it never
// looks completely static. Mounted as an absolutely positioned canvas
// on top of the same 300x300 cell as RiverSong.
//
// Props:
//   audioLevel {number} Current mic amplitude 0-1
//   state      {string} Conversation state (unused currently, kept for future)
// =============================================================================

import React, { useEffect, useRef } from 'react'

const BAR_COUNT    = 32
const INNER_RADIUS = 116   // px -- bars start just outside the outermost ring
const MAX_BAR_H    = 55    // px -- max bar height at audioLevel = 1
const MIN_BAR_H    = 3     // px -- minimum stub so bars are always visible

export default function AudioVisualizer({ audioLevel }) {
  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const levelRef  = useRef(audioLevel)

  // Keep a ref in sync so the animation loop always reads the latest level
  // without needing to restart the loop on every prop change
  useEffect(() => {
    levelRef.current = audioLevel
  }, [audioLevel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height
    const CX  = W / 2
    const CY  = H / 2

    let t = 0

    const draw = () => {
      t += 0.045
      const level = levelRef.current

      ctx.clearRect(0, 0, W, H)

      for (let i = 0; i < BAR_COUNT; i++) {
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2

        // Add per-bar noise so adjacent bars differ slightly
        const noise     = Math.sin(t * 2.2 + i * 0.55) * 0.18
        const rawHeight = MAX_BAR_H * (level * 0.85 + 0.06 + noise * 0.12)
        const barH      = Math.max(MIN_BAR_H, Math.min(MAX_BAR_H, rawHeight))

        const x1 = CX + Math.cos(angle) * INNER_RADIUS
        const y1 = CY + Math.sin(angle) * INNER_RADIUS
        const x2 = CX + Math.cos(angle) * (INNER_RADIUS + barH)
        const y2 = CY + Math.sin(angle) * (INNER_RADIUS + barH)

        const alpha = Math.max(0.15, Math.min(0.9, 0.35 + level * 0.65))

        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `rgba(0,200,255,${alpha.toFixed(3)})`
        ctx.lineWidth   = 3
        ctx.lineCap     = 'round'
        ctx.stroke()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, []) // Intentionally empty -- loop reads level via ref, never restarts

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={300}
      className="audio-visualizer-canvas"
      aria-hidden="true"
    />
  )
}
