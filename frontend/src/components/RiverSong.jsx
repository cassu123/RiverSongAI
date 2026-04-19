// =============================================================================
// src/components/RiverSong.jsx
//
// Holographic female AI figure -- Cortana-inspired bust portrait.
//
// Drawn entirely on a 300 × 420 canvas using the 2D API. The figure is a
// glowing line-art female bust: dark-hair bob cut, glowing eyes, subtle facial
// features, neck, collarbone, and circuit-line patterns at the temples.
//
// Visual states:
//   idle         -- gentle blue pulse, slow eye blink, soft aura
//   connecting   -- dim, minimal draw
//   listening    -- bright teal, expanded aura, eye brightness tracks audioLevel
//   transcribing -- medium blue, figure dims slightly
//   thinking     -- purple, faster particle orbits, quicker scan lines
//   speaking     -- green-teal, lips animate, eyes glow with audioLevel
//   error        -- red accent shift
//
// Props:
//   state      {string} Conversation state
//   audioLevel {number} Mic amplitude 0–1
// =============================================================================

import React, { useEffect, useRef } from 'react'

const STATE_COLORS = {
  idle:         '#00aaff',
  connecting:   '#003366',
  listening:    '#00ffee',
  transcribing: '#0099cc',
  thinking:     '#9955ff',
  speaking:     '#00ffaa',
  error:        '#ff4433',
}

const DEFAULT_COLOR = '#00aaff'

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RiverSong({ state, audioLevel = 0 }) {
  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const stateRef  = useRef(state)
  const levelRef  = useRef(audioLevel)

  useEffect(() => { stateRef.current = state },      [state])
  useEffect(() => { levelRef.current = audioLevel }, [audioLevel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const W   = canvas.width   // 300
    const H   = canvas.height  // 420
    const CX  = W / 2          // 150
    let t     = 0

    const draw = () => {
      t += 0.016
      const s   = stateRef.current
      const lvl = levelRef.current
      const col = STATE_COLORS[s] || DEFAULT_COLOR

      ctx.clearRect(0, 0, W, H)

      if (s === 'connecting') {
        drawConnecting(ctx, W, H, CX, t, col)
      } else {
        drawBackground(ctx, W, H, CX, t, col)
        drawAura(ctx, CX, t, s, col, lvl)
        drawHair(ctx, CX, col)
        drawFaceOval(ctx, CX, t, s, col, lvl)
        drawEyes(ctx, CX, t, s, col, lvl)
        drawNose(ctx, CX, col)
        drawLips(ctx, CX, t, s, col, lvl)
        drawCheekLines(ctx, CX, col)
        drawNeckShoulders(ctx, CX, t, col)
        drawCircuits(ctx, CX, t, s, col)
        if (s !== 'idle') drawScanLines(ctx, CX, t, s, col, lvl)
        if (s === 'thinking') drawThinkOrbs(ctx, CX, t, col)
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, []) // loop reads state/level via refs, never restarts

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={420}
      className="river-song-canvas"
      aria-label={`River Song holographic figure, state: ${state}`}
    />
  )
}

// ---------------------------------------------------------------------------
// Connecting dim state
// ---------------------------------------------------------------------------

function drawConnecting(ctx, W, H, CX, t, col) {
  const [r, g, b] = rgb(col)
  const alpha = 0.08 + 0.04 * Math.sin(t * 1.2)
  ctx.beginPath()
  ctx.arc(CX, 190, 80, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
  ctx.lineWidth = 1
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Background particles
// ---------------------------------------------------------------------------

function drawBackground(ctx, W, H, CX, t, col) {
  const [r, g, b] = rgb(col)
  for (let i = 0; i < 22; i++) {
    const seed = i * 137.508
    const px   = ((Math.sin(seed) * 0.5 + 0.5) * W)
    const py   = (((Math.cos(seed * 1.4) * 0.5 + 0.5) * H + t * (5 + (i % 4) * 3)) % H)
    const a    = 0.06 + 0.09 * Math.sin(t * 1.1 + i * 0.6)
    ctx.beginPath()
    ctx.arc(px, py, 1 + (i % 2) * 0.6, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// Outer aura glow
// ---------------------------------------------------------------------------

function drawAura(ctx, CX, t, state, col, lvl) {
  const [r, g, b] = rgb(col)
  const pulse  = 1 + (0.03 + lvl * 0.06) * Math.sin(t * (state === 'thinking' ? 3.5 : 1.8))
  const auraRX = 120 * pulse
  const auraRY = 155 * pulse

  const grd = ctx.createRadialGradient(CX, 185, 40, CX, 185, Math.max(auraRX, auraRY))
  grd.addColorStop(0,   `rgba(${r},${g},${b},0.13)`)
  grd.addColorStop(0.55,`rgba(${r},${g},${b},0.05)`)
  grd.addColorStop(1,   `rgba(${r},${g},${b},0)`)

  ctx.save()
  ctx.scale(auraRX / Math.max(auraRX, auraRY), auraRY / Math.max(auraRX, auraRY))
  ctx.beginPath()
  const scale = Math.max(auraRX, auraRY)
  ctx.arc(CX / (auraRX / scale), 185 / (auraRY / scale), scale, 0, Math.PI * 2)
  ctx.restore()

  ctx.beginPath()
  ctx.ellipse(CX, 185, auraRX, auraRY, 0, 0, Math.PI * 2)
  ctx.fillStyle = grd
  ctx.fill()
}

// ---------------------------------------------------------------------------
// Hair – dark bob cut framing the face
// ---------------------------------------------------------------------------

function drawHair(ctx, CX, col) {
  const [r, g, b] = rgb(col)

  ctx.save()
  // Fill: near-black dark-blue
  ctx.beginPath()
  ctx.moveTo(CX - 82, 228)                        // left jawline
  ctx.bezierCurveTo(CX - 85, 185, CX - 82, 130, CX - 80, 82)  // left side going up
  ctx.bezierCurveTo(CX - 72, 45,  CX - 38, 22,  CX,      18)  // top left arc
  ctx.bezierCurveTo(CX + 30,  18, CX + 62,  38,  CX + 72, 78)  // top right arc
  ctx.bezierCurveTo(CX + 80, 118, CX + 82, 168,  CX + 78, 218) // right side
  ctx.bezierCurveTo(CX + 68, 238, CX + 48, 246,  CX + 32, 246) // right nape
  ctx.bezierCurveTo(CX,       252, CX - 40, 248,  CX - 58, 240) // nape curve
  ctx.bezierCurveTo(CX - 68, 236, CX - 78, 232,  CX - 82, 228) // back to start
  ctx.closePath()

  ctx.fillStyle   = 'rgba(4, 11, 22, 0.94)'
  ctx.fill()
  ctx.shadowColor = col
  ctx.shadowBlur  = 5
  ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`
  ctx.lineWidth   = 1.5
  ctx.stroke()

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Face oval
// ---------------------------------------------------------------------------

function drawFaceOval(ctx, CX, t, state, col, lvl) {
  const [r, g, b] = rgb(col)

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(CX, 162, 60, 78, 0, 0, Math.PI * 2)

  const grd = ctx.createRadialGradient(CX - 8, 135, 8, CX, 162, 80)
  grd.addColorStop(0, `rgba(${r},${g},${b},0.09)`)
  grd.addColorStop(0.6, `rgba(${r},${g},${b},0.04)`)
  grd.addColorStop(1,  `rgba(${r},${g},${b},0.07)`)
  ctx.fillStyle = grd
  ctx.fill()

  ctx.shadowColor = col
  ctx.shadowBlur  = 10 + lvl * 18
  ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`
  ctx.lineWidth   = 1.5
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Eyes
// ---------------------------------------------------------------------------

function drawEyes(ctx, CX, t, state, col, lvl) {
  const [r, g, b] = rgb(col)

  // Slow organic blink
  const blinkRaw = Math.sin(t * 0.38)
  const eyeH     = blinkRaw > 0.96 ? Math.max(0.1, 1 - (blinkRaw - 0.96) * 25) : 1

  const eyeGlow = state === 'thinking' ? 20 + 12 * Math.sin(t * 4.2)
    : state === 'speaking'  ? 14 + lvl * 18
    : state === 'listening' ? 12 + lvl * 12
    : 10

  const EYES = [
    { x: CX - 22, y: 132 },
    { x: CX + 22, y: 132 },
  ]

  EYES.forEach(({ x, y }) => {
    ctx.save()

    // Iris glow fill (clipped to eye shape)
    ctx.beginPath()
    ctx.ellipse(x, y, 17, 8.5 * eyeH, 0, 0, Math.PI * 2)
    ctx.save()
    ctx.clip()
    const eg = ctx.createRadialGradient(x, y, 0, x, y, 14)
    eg.addColorStop(0,   `rgba(${r},${g},${b},0.95)`)
    eg.addColorStop(0.45,`rgba(${r},${g},${b},0.5)`)
    eg.addColorStop(1,   `rgba(${r},${g},${b},0.08)`)
    ctx.fillStyle = eg
    ctx.fill()
    ctx.restore()

    // Eye outline
    ctx.shadowColor = col
    ctx.shadowBlur  = eyeGlow
    ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`
    ctx.lineWidth   = 1.5
    ctx.beginPath()
    ctx.ellipse(x, y, 17, 8.5 * eyeH, 0, 0, Math.PI * 2)
    ctx.stroke()

    // Pupil
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.85)'
    ctx.fill()

    // Iris ring
    ctx.beginPath()
    ctx.arc(x, y, 7.5, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${r},${g},${b},0.65)`
    ctx.lineWidth   = 1
    ctx.stroke()

    // Reflection dot
    ctx.beginPath()
    ctx.arc(x - 5, y - 3, 2, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${r},${g},${b},0.7)`
    ctx.shadowBlur = 4
    ctx.fill()

    ctx.restore()
  })
}

// ---------------------------------------------------------------------------
// Nose (subtle)
// ---------------------------------------------------------------------------

function drawNose(ctx, CX, col) {
  const [r, g, b] = rgb(col)
  ctx.save()
  ctx.strokeStyle = `rgba(${r},${g},${b},0.22)`
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(CX - 6,  165)
  ctx.bezierCurveTo(CX - 10, 175, CX - 8, 183, CX - 5, 185)
  ctx.moveTo(CX + 6,  165)
  ctx.bezierCurveTo(CX + 10, 175, CX + 8, 183, CX + 5, 185)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Lips (animate while speaking)
// ---------------------------------------------------------------------------

function drawLips(ctx, CX, t, state, col, lvl) {
  const [r, g, b] = rgb(col)
  const open = state === 'speaking' ? Math.abs(Math.sin(t * 9)) * lvl * 5 + 1 : 0

  ctx.save()
  ctx.shadowColor = col
  ctx.shadowBlur  = 5
  ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`
  ctx.lineWidth   = 1.5

  // Upper lip
  ctx.beginPath()
  ctx.moveTo(CX - 21, 200)
  ctx.bezierCurveTo(CX - 10, 194, CX - 3, 192, CX,     194)
  ctx.bezierCurveTo(CX + 3,  192, CX + 10, 194, CX + 21, 200)
  ctx.stroke()

  // Lower lip (drops open during speaking)
  ctx.beginPath()
  ctx.moveTo(CX - 21, 200)
  ctx.bezierCurveTo(CX - 10, 208 + open, CX, 210 + open, CX + 21, 200)
  ctx.stroke()

  // Interior mouth fill hint when open
  if (open > 1.5) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(CX - 14, 201)
    ctx.bezierCurveTo(CX, 204 + open * 0.4, CX + 14, 201, CX + 14, 201)
    ctx.lineTo(CX - 14, 201)
    ctx.fillStyle = `rgba(0,0,0,0.6)`
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Cheekbone tech highlight lines
// ---------------------------------------------------------------------------

function drawCheekLines(ctx, CX, col) {
  const [r, g, b] = rgb(col)
  ctx.save()
  ctx.strokeStyle = `rgba(${r},${g},${b},0.18)`
  ctx.lineWidth   = 1

  // Left
  ctx.beginPath()
  ctx.moveTo(CX - 58, 152)
  ctx.lineTo(CX - 38, 158)
  ctx.stroke()

  // Right
  ctx.beginPath()
  ctx.moveTo(CX + 58, 152)
  ctx.lineTo(CX + 38, 158)
  ctx.stroke()

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Neck and collarbone
// ---------------------------------------------------------------------------

function drawNeckShoulders(ctx, CX, t, col) {
  const [r, g, b] = rgb(col)

  ctx.save()
  ctx.shadowColor = col
  ctx.shadowBlur  = 7
  ctx.strokeStyle = `rgba(${r},${g},${b},0.48)`
  ctx.lineWidth   = 1.5

  // Neck left
  ctx.beginPath()
  ctx.moveTo(CX - 16, 238)
  ctx.bezierCurveTo(CX - 18, 262, CX - 24, 278, CX - 28, 292)
  ctx.stroke()

  // Neck right
  ctx.beginPath()
  ctx.moveTo(CX + 16, 238)
  ctx.bezierCurveTo(CX + 18, 262, CX + 24, 278, CX + 28, 292)
  ctx.stroke()

  // Left collarbone curve
  ctx.strokeStyle = `rgba(${r},${g},${b},0.32)`
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(CX - 28, 292)
  ctx.bezierCurveTo(CX - 55, 298, CX - 100, 312, CX - 145, 342)
  ctx.stroke()

  // Right collarbone curve
  ctx.beginPath()
  ctx.moveTo(CX + 28, 292)
  ctx.bezierCurveTo(CX + 55, 298, CX + 100, 312, CX + 145, 342)
  ctx.stroke()

  // Chest center detail
  ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`
  ctx.beginPath()
  ctx.moveTo(CX - 6,  292)
  ctx.lineTo(CX + 6,  292)
  ctx.lineTo(CX,      302)
  ctx.lineTo(CX - 6,  312)
  ctx.lineTo(CX + 6,  312)
  ctx.stroke()

  // Pulsing collar node
  const pulse = 0.4 + 0.4 * Math.sin(t * 2)
  ctx.beginPath()
  ctx.arc(CX, 292, 3, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${r},${g},${b},${pulse})`
  ctx.shadowBlur = 8
  ctx.fill()

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Temple circuit patterns
// ---------------------------------------------------------------------------

function drawCircuits(ctx, CX, t, state, col) {
  const [r, g, b] = rgb(col)
  const a = 0.22 + 0.1 * Math.sin(t * 1.8)

  ctx.save()
  ctx.strokeStyle = `rgba(${r},${g},${b},${a})`
  ctx.lineWidth   = 1

  // Left temple circuits
  ctx.beginPath(); ctx.moveTo(CX - 73, 112); ctx.lineTo(CX - 86, 112)
  ctx.lineTo(CX - 86, 126); ctx.lineTo(CX - 94, 126); ctx.stroke()

  ctx.beginPath(); ctx.moveTo(CX - 72, 136); ctx.lineTo(CX - 83, 136)
  ctx.lineTo(CX - 83, 148); ctx.stroke()

  // Right temple circuits
  ctx.beginPath(); ctx.moveTo(CX + 73, 112); ctx.lineTo(CX + 86, 112)
  ctx.lineTo(CX + 86, 126); ctx.lineTo(CX + 94, 126); ctx.stroke()

  ctx.beginPath(); ctx.moveTo(CX + 72, 136); ctx.lineTo(CX + 83, 136)
  ctx.lineTo(CX + 83, 148); ctx.stroke()

  // Circuit endpoint dots
  const dots = [
    { x: CX - 94, y: 126 }, { x: CX + 94, y: 126 },
    { x: CX - 83, y: 148 }, { x: CX + 83, y: 148 },
  ]
  ctx.fillStyle = `rgba(${r},${g},${b},${a + 0.25})`
  dots.forEach(({ x, y }) => {
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
  })

  // Collar nodes (left pulsing, right pulsing, offset phase)
  for (let i = 0; i < 5; i++) {
    const p = 0.35 + 0.45 * Math.sin(t * 2.2 + i * 0.9)
    ctx.globalAlpha = p
    ctx.beginPath()
    ctx.arc(CX - 24 + i * 12, 296, 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Holographic scan lines across the face
// ---------------------------------------------------------------------------

function drawScanLines(ctx, CX, t, state, col, lvl) {
  const [r, g, b] = rgb(col)

  // Clip to the face oval
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(CX, 162, 62, 80, 0, 0, Math.PI * 2)
  ctx.clip()

  // Primary moving scan bar
  const speed = state === 'thinking' ? 90 : 65
  const scanY = ((t * speed) % 220) + 70  // stays within face range

  const sg = ctx.createLinearGradient(CX - 70, scanY, CX + 70, scanY)
  sg.addColorStop(0,   `rgba(${r},${g},${b},0)`)
  sg.addColorStop(0.25,`rgba(${r},${g},${b},0.55)`)
  sg.addColorStop(0.75,`rgba(${r},${g},${b},0.55)`)
  sg.addColorStop(1,   `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = sg
  ctx.fillRect(CX - 70, scanY - 1.5, 140, 3)

  // Static CRT-style line texture
  for (let y = 80; y < 244; y += 3) {
    const la = 0.025 + 0.015 * Math.sin(y * 0.7 + t * 1.5)
    ctx.fillStyle = `rgba(${r},${g},${b},${la})`
    ctx.fillRect(CX - 65, y, 130, 1)
  }

  // Extra reactive bar when speaking/listening
  if ((state === 'speaking' || state === 'listening') && lvl > 0.05) {
    const scanY2 = ((t * speed * 1.3 + 110) % 220) + 70
    ctx.fillStyle = `rgba(${r},${g},${b},${0.3 * lvl})`
    ctx.fillRect(CX - 65, scanY2 - 1, 130, 2)
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Thinking orbital particles (float around the head)
// ---------------------------------------------------------------------------

function drawThinkOrbs(ctx, CX, t, col) {
  const [r, g, b] = rgb(col)
  const count = 6

  for (let i = 0; i < count; i++) {
    const angle  = t * 1.3 + (i * Math.PI * 2) / count
    const radius = 105 + 10 * Math.sin(t * 2.2 + i * 1.1)
    const px     = CX + Math.cos(angle) * radius
    const py     = 190 + Math.sin(angle) * (radius * 0.55)  // elliptical orbit
    const a      = 0.5 + 0.4 * Math.sin(t * 3.1 + i)

    ctx.save()
    ctx.shadowColor = col
    ctx.shadowBlur  = 10
    ctx.beginPath()
    ctx.arc(px, py, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`
    ctx.fill()
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Utility: hex color to [r, g, b]
// ---------------------------------------------------------------------------

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}
