import React, { useRef } from 'react'
import Grade from './Grade.jsx'
import useCanvasEffect from './useCanvasEffect.js'

/**
 * Stage — fixed full-viewport photographic backdrop, swaps by environment.
 *
 * Each scene is a photographic engine: a base landscape image (fallback
 * gradient if the image file is absent) + atmospheric overlays + a small
 * Canvas 2D particle field tuned to that world.
 *
 * Drop base images into frontend/public/ as:
 *   caladan_base.jpg     atreides
 *   giedi_base.jpg       harkonnen
 *   arrakis_base.jpg     arrakis
 *   forerunner_base.jpg  forerunner
 *   unsc_base.jpg        unsc
 *   spires_base.jpg      spires
 *   garden_base.jpg      garden
 *   corpo_base.jpg       corpo
 *   pacifica_base.jpg    pacifica
 *
 * See public/PREVIEW_IMAGE_PROMPTS.md for the generation prompts.
 */
/* Memoized: App re-renders constantly (nav, toasts, header context) and the
   scenes seed their particle fields on mount — only an actual environment
   change may remount a scene. */
export default React.memo(function Stage({ environment }) {
  const Scene = SCENES[environment] || SCENES.atreides
  return (
    <div className="rs-stage" aria-hidden="true">
      <Scene />
      <Grade />
    </div>
  )
})

/* ─────────────────────────────────────────────────────────────────────────
   PhotoStage — common DOM skeleton. Per-env children layer on top.
   ───────────────────────────────────────────────────────────────────────── */
function PhotoStage({ envClass, children }) {
  return (
    <div className={`rs-photo ${envClass}`}>
      <div className="rs-photo-base" />
      {children}
    </div>
  )
}

/* ============================================================
   ATREIDES · CALADAN — ocean home world, storm above black sea
   Heavy rain, distant lightning, Castle Caladan silhouette with
   warm window points against a grey-green storm sky.
   ============================================================ */
function AtreidesScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    /* Rain — vertical streaks falling diagonally with the wind */
    const RAIN = 70
    const SPRAY = 16
    const drops = []
    for (let i = 0; i < RAIN; i++) {
      drops.push({
        kind: 'rain',
        x: Math.random() * w,
        y: Math.random() * h,
        len: 12 + Math.random() * 18,
        vx: 1.2,
        vy: 14 + Math.random() * 6,
        a: 0.18 + Math.random() * 0.28,
      })
    }
    for (let i = 0; i < SPRAY; i++) {
      drops.push({
        kind: 'spray',
        x: Math.random() * w,
        y: h * 0.6 + Math.random() * h * 0.4,
        vx: -0.2 + Math.random() * 0.4,
        vy: -0.3 - Math.random() * 0.3,
        r: 0.6 + Math.random() * 1.4,
        a: 0.18 + Math.random() * 0.22,
        life: 200 + Math.random() * 300,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const d of drops) {
        if (d.kind === 'rain') {
          d.x += d.vx; d.y += d.vy
          if (d.y > h + d.len) { d.y = -d.len; d.x = Math.random() * w }
          ctx.strokeStyle = `rgba(180, 200, 220, ${d.a})`
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - d.vx * 1.5, d.y - d.len)
          ctx.stroke()
        } else {
          d.x += d.vx; d.y += d.vy; d.life -= 1
          if (d.life <= 0 || d.y < 0) {
            d.x = Math.random() * w
            d.y = h * 0.65 + Math.random() * h * 0.35
            d.life = 200 + Math.random() * 300
          }
          ctx.fillStyle = `rgba(200, 215, 225, ${d.a})`
          ctx.beginPath()
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--atreides">
      <div className="rs-cal-mist" />
      <div className="rs-cal-storm-haze" />
      {/* Far cliff range — heavy haze, almost dissolves into storm */}
      <div className="rs-cal-cliff rs-cal-cliff--far">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="cal-cliff-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#4a5868" stopOpacity="0.55" />
              <stop offset="50%" stopColor="#28323e" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#0e141c" stopOpacity="0.85" />
            </linearGradient>
            {/* Mid cliff face — slight cooler shadow side */}
            <linearGradient id="cal-cliff-mid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2a3848" />
              <stop offset="60%" stopColor="#101820" />
              <stop offset="100%" stopColor="#060e18" />
            </linearGradient>
            {/* Foreground basalt — vertical strata gradient */}
            <linearGradient id="cal-cliff-fore" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0%"  stopColor="#1a2330" />
              <stop offset="40%" stopColor="#0a1018" />
              <stop offset="100%" stopColor="#050c16" />
            </linearGradient>
            {/* Vertical erosion strata texture */}
            <pattern id="cal-strata" x="0" y="0" width="6" height="40" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="40" stroke="#000" strokeWidth="0.4" opacity="0.35" />
            </pattern>
            {/* Window glow halo */}
            <radialGradient id="cal-window-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor="#ffc890" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#ffc890" stopOpacity="0" />
            </radialGradient>
            {/* Foam at cliff base */}
            <linearGradient id="cal-foam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#e0e8f0" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#a8b8c8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 0 560 L 80 540 L 160 580 L 260 520 L 380 560 L 500 510
                   L 620 555 L 760 500 L 900 545 L 1040 495 L 1180 540
                   L 1320 500 L 1460 545 L 1600 520 L 1600 1000 L 0 1000 Z"
                fill="url(#cal-cliff-far)" />
        </svg>
      </div>
      {/* Mid cliff — sharper, with some basalt strata texture */}
      <div className="rs-cal-cliff rs-cal-cliff--mid">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <path d="M 0 680 L 60 640 L 140 680 L 220 620 L 320 670 L 420 620
                   L 540 660 L 680 600 L 820 650 L 960 610 L 1080 660
                   L 1220 620 L 1360 670 L 1480 630 L 1600 650
                   L 1600 1000 L 0 1000 Z"
                fill="url(#cal-cliff-mid)" />
          <path d="M 0 680 L 60 640 L 140 680 L 220 620 L 320 670 L 420 620
                   L 540 660 L 680 600 L 820 650 L 960 610 L 1080 660
                   L 1220 620 L 1360 670 L 1480 630 L 1600 650
                   L 1600 1000 L 0 1000 Z"
                fill="url(#cal-strata)" opacity="0.6" />
        </svg>
      </div>
      {/* Foreground cliff — Castle Caladan complex perched on highest point */}
      <div className="rs-cal-cliff rs-cal-cliff--fore">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          {/* Cliff silhouette with sharper jagged edges and a clear castle plateau */}
          <path d="M 0 800
                   L 60 760 L 140 800 L 220 740 L 300 780
                   L 360 740 L 420 700 L 460 660 L 500 620 L 540 600
                   L 560 580 L 580 560 L 600 540
                   L 740 540 L 760 560 L 780 580 L 800 600 L 820 620
                   L 860 660 L 920 700 L 980 740 L 1040 720
                   L 1140 760 L 1240 720 L 1340 760 L 1440 720 L 1540 760 L 1600 740
                   L 1600 1000 L 0 1000 Z"
                fill="url(#cal-cliff-fore)" />
          <path d="M 0 800
                   L 60 760 L 140 800 L 220 740 L 300 780
                   L 360 740 L 420 700 L 460 660 L 500 620 L 540 600
                   L 560 580 L 580 560 L 600 540
                   L 740 540 L 760 560 L 780 580 L 800 600 L 820 620
                   L 860 660 L 920 700 L 980 740 L 1040 720
                   L 1140 760 L 1240 720 L 1340 760 L 1440 720 L 1540 760 L 1600 740
                   L 1600 1000 L 0 1000 Z"
                fill="url(#cal-strata)" opacity="0.5" />

          {/* CASTLE CALADAN — keep, towers, curtain wall on the plateau */}
          <g>
            {/* Curtain wall */}
            <rect x="540" y="500" width="200" height="44" fill="#0e1218" />
            <g fill="#2a3038" opacity="0.9">
              {[542,562,582,602,622,642,662,682,702,722].map((x,i) =>
                <rect key={i} x={x} y="498" width="6" height="6" />
              )}
            </g>
            {/* Main keep */}
            <rect x="600" y="430" width="80" height="74" fill="#0a0e14" />
            <polygon points="600,430 640,400 680,430" fill="#0a0e14" />
            <rect x="636" y="386" width="2" height="20" fill="#0a0e14" />
            <polygon points="634,388 636,386 638,388 638,392 634,392" fill="#5a8a4a" />
            {/* Side tower */}
            <rect x="546" y="464" width="36" height="40" fill="#0a0e14" />
            <polygon points="546,464 564,448 582,464" fill="#0a0e14" />
            {/* Right tower */}
            <rect x="698" y="450" width="32" height="54" fill="#0a0e14" />
            <polygon points="698,450 714,432 730,450" fill="#0a0e14" />
          </g>

          {/* Window glow halos — behind the points so they bloom */}
          <g>
            <circle cx="616" cy="464" r="6" fill="url(#cal-window-glow)" />
            <circle cx="640" cy="464" r="6" fill="url(#cal-window-glow)" />
            <circle cx="664" cy="464" r="6" fill="url(#cal-window-glow)" />
            <circle cx="560" cy="488" r="5" fill="url(#cal-window-glow)" />
            <circle cx="714" cy="488" r="5" fill="url(#cal-window-glow)" />
          </g>
          {/* Castle windows — warm amber points, animated flicker */}
          <g className="rs-cal-windows" fill="#ffc890">
            <rect x="614" y="461" width="3" height="6" />
            <rect x="638" y="461" width="3" height="6" />
            <rect x="662" y="461" width="3" height="6" />
            <rect x="616" y="478" width="3" height="6" />
            <rect x="640" y="478" width="3" height="6" />
            <rect x="664" y="478" width="3" height="6" />
            <rect x="558" y="486" width="3" height="6" />
            <rect x="572" y="486" width="3" height="6" />
            <rect x="712" y="486" width="3" height="6" />
            <rect x="724" y="486" width="3" height="6" />
            <rect x="608" y="446" width="2" height="4" />
            <rect x="668" y="446" width="2" height="4" />
          </g>

          {/* SEA FOAM at cliff base */}
          <g>
            <path d="M 0 800 Q 80 780 160 800 Q 240 790 320 800 Q 400 785 480 800
                     Q 560 790 640 800 Q 720 785 800 800 Q 880 790 960 800
                     Q 1040 785 1120 800 Q 1200 790 1280 800 Q 1360 785 1440 800
                     Q 1520 790 1600 800 L 1600 820 L 0 820 Z"
                  fill="url(#cal-foam)" />
          </g>

          {/* TINY GULL silhouettes in the storm */}
          <g fill="#1a2230">
            <path d="M 380 360 q 5 -4 10 0 q -5 -1 -10 0 z" />
            <path d="M 420 380 q 4 -3 8 0 q -4 -1 -8 0 z" />
            <path d="M 1280 320 q 5 -4 10 0 q -5 -1 -10 0 z" />
            <path d="M 1340 340 q 4 -3 8 0 q -4 -1 -8 0 z" />
          </g>
        </svg>
      </div>
      {/* Lightning flash — full-screen white pulse on long cycle */}
      <div className="rs-cal-lightning" />
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   HARKONNEN · GIEDI PRIME — monochrome industrial under black sun
   No color except violent reds. Brutalist towers, smoke columns,
   hazard pulse lights, ash drifting in oily air.
   ============================================================ */
function HarkonnenScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const ASH = 38
    const ash = []
    for (let i = 0; i < ASH; i++) {
      ash.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -0.15 + Math.random() * 0.3,
        vy: 0.3 + Math.random() * 0.7,
        r: 0.7 + Math.random() * 1.4,
        a: 0.25 + Math.random() * 0.35,
        wob: Math.random() * Math.PI * 2,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of ash) {
        p.wob += 0.02
        p.x += p.vx + Math.sin(p.wob) * 0.3
        p.y += p.vy
        if (p.y > h + 4) { p.y = -4; p.x = Math.random() * w }
        ctx.fillStyle = `rgba(210, 210, 215, ${p.a})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--harkonnen">
      <div className="rs-hark-haze" />
      {/* Smoke columns rising from off-screen stacks */}
      <div className="rs-hark-smoke rs-hark-smoke--a" />
      <div className="rs-hark-smoke rs-hark-smoke--b" />
      <div className="rs-hark-smoke rs-hark-smoke--c" />
      {/* Far industrial horizon — heavy haze, dissolves */}
      <div className="rs-hark-skyline rs-hark-skyline--far">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="hark-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2a2a2e" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0a0a0c" stopOpacity="0.7" />
            </linearGradient>
          </defs>
          <path d="M 0 620 L 40 620 L 40 540 L 90 540 L 90 620
                   L 160 620 L 160 480 L 220 480 L 220 620
                   L 300 620 L 300 520 L 360 520 L 360 620
                   L 460 620 L 460 460 L 530 460 L 530 620
                   L 620 620 L 620 500 L 690 500 L 690 620
                   L 800 620 L 800 480 L 870 480 L 870 620
                   L 980 620 L 980 460 L 1050 460 L 1050 620
                   L 1160 620 L 1160 500 L 1230 500 L 1230 620
                   L 1340 620 L 1340 480 L 1420 480 L 1420 620
                   L 1520 620 L 1520 500 L 1600 500 L 1600 620
                   L 1600 1000 L 0 1000 Z"
                fill="url(#hark-far)" />
        </svg>
      </div>
      {/* Mid skyline — brutalist slabs with organic curves and antennae */}
      <div className="rs-hark-skyline">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            {/* Slab face — directional from the white sun upper-right */}
            <linearGradient id="hark-slab" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#080808" />
              <stop offset="65%" stopColor="#1c1c20" />
              <stop offset="100%" stopColor="#2e2e34" />
            </linearGradient>
            {/* Slab vertical — top-lit faintly */}
            <linearGradient id="hark-slab-v" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#26262a" />
              <stop offset="100%" stopColor="#020204" />
            </linearGradient>
            {/* Septic-tank organic — the signature Harkonnen curved form */}
            <radialGradient id="hark-organic" cx="50%" cy="30%" r="70%">
              <stop offset="0%"  stopColor="#2a2a2e" />
              <stop offset="100%" stopColor="#000" />
            </radialGradient>
          </defs>

          {/* Organic curved mass (left) */}
          <path d="M 0 720 Q 100 540 200 600 Q 280 640 340 580 Q 420 520 480 600
                   Q 540 660 580 620 L 580 720 Z"
                fill="url(#hark-organic)" />

          {/* Brutalist slab cluster — varying heights, all reading vertical */}
          <g>
            {/* tall slab 1 */}
            <rect x="60"   y="480" width="70" height="240" fill="url(#hark-slab)" />
            <rect x="60"   y="478" width="70" height="6"   fill="#000" />
            <rect x="120"  y="480" width="10" height="240" fill="url(#hark-slab-v)" />
            {/* tall slab 2 */}
            <rect x="200"  y="520" width="58" height="200" fill="url(#hark-slab)" />
            <rect x="248"  y="520" width="10" height="200" fill="url(#hark-slab-v)" />
            {/* massive slab 3 */}
            <rect x="340"  y="360" width="92" height="360" fill="url(#hark-slab)" />
            <rect x="420"  y="360" width="12" height="360" fill="url(#hark-slab-v)" />
            {/* tall slab 4 */}
            <rect x="510"  y="500" width="74" height="220" fill="url(#hark-slab)" />
            <rect x="572"  y="500" width="12" height="220" fill="url(#hark-slab-v)" />
            {/* massive slab 5 */}
            <rect x="680"  y="400" width="88" height="320" fill="url(#hark-slab)" />
            <rect x="754"  y="400" width="14" height="320" fill="url(#hark-slab-v)" />
            {/* slab 6 */}
            <rect x="860"  y="480" width="84" height="240" fill="url(#hark-slab)" />
            <rect x="930"  y="480" width="14" height="240" fill="url(#hark-slab-v)" />
            {/* massive slab 7 */}
            <rect x="1040" y="420" width="96" height="300" fill="url(#hark-slab)" />
            <rect x="1124" y="420" width="14" height="300" fill="url(#hark-slab-v)" />
            {/* slab 8 */}
            <rect x="1230" y="520" width="76" height="200" fill="url(#hark-slab)" />
            <rect x="1294" y="520" width="14" height="200" fill="url(#hark-slab-v)" />
            {/* slab 9 */}
            <rect x="1420" y="440" width="90" height="280" fill="url(#hark-slab)" />
            <rect x="1502" y="440" width="14" height="280" fill="url(#hark-slab-v)" />
          </g>

          {/* Antennae + comm spikes on the tallest slabs */}
          <g stroke="#000" strokeWidth="2" fill="none">
            <line x1="386" y1="360" x2="386" y2="280" />
            <line x1="378" y1="296" x2="394" y2="296" />
            <line x1="724" y1="400" x2="724" y2="320" />
            <line x1="718" y1="340" x2="730" y2="340" />
            <line x1="1088" y1="420" x2="1088" y2="340" />
            <line x1="1080" y1="358" x2="1096" y2="358" />
            <line x1="1465" y1="440" x2="1465" y2="380" />
          </g>

          {/* Right-side curving organic mass — "septic tank" */}
          <path d="M 1200 720 Q 1280 600 1380 640 Q 1480 680 1560 600
                   Q 1600 580 1600 600 L 1600 720 Z"
                fill="url(#hark-organic)" opacity="0.85" />

          {/* PARADE-GROUND seam lines on the ground — vanishing perspective */}
          <g stroke="#1a1a1c" strokeWidth="1" opacity="0.7">
            <line x1="0"   y1="760" x2="1600" y2="760" />
            <line x1="0"   y1="800" x2="1600" y2="800" />
            <line x1="0"   y1="850" x2="1600" y2="850" />
            <line x1="0"   y1="900" x2="1600" y2="900" />
          </g>

          {/* Tiny figure silhouettes on the parade ground — scale-defining */}
          <g fill="#000">
            <rect x="480"  y="844" width="2" height="6" />
            <rect x="510"  y="844" width="2" height="6" />
            <rect x="540"  y="844" width="2" height="6" />
            <rect x="900"  y="852" width="2" height="6" />
            <rect x="930"  y="852" width="2" height="6" />
            <rect x="960"  y="852" width="2" height="6" />
            <rect x="1200" y="860" width="2" height="6" />
            <rect x="1230" y="860" width="2" height="6" />
          </g>
        </svg>
      </div>
      {/* Hazard pulse lights — red, staggered, the only color allowed */}
      <div className="rs-hark-hazard" style={{ left: '22%', top: '52%' }} />
      <div className="rs-hark-hazard rs-hark-hazard--d1" style={{ left: '47%', top: '45%' }} />
      <div className="rs-hark-hazard rs-hark-hazard--d2" style={{ left: '71%', top: '50%' }} />
      <div className="rs-hark-hazard rs-hark-hazard--d3" style={{ left: '88%', top: '54%' }} />
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   ARRAKIS · DEEP DESERT · SHAI-HULUD
   Wild dunes, sandworm threat, spice blow. Wormsign rides the
   foreground before any reveal — Kimi's call, kept here.
   ============================================================ */
function ArrakisScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const SAND = 28
    const SPICE = 14
    const ps = []
    for (let i = 0; i < SAND; i++) {
      ps.push({
        kind: 'sand',
        x: Math.random() * w,
        y: h * 0.55 + Math.random() * h * 0.45,
        vx: 0.35 + Math.random() * 0.85,
        vy: -0.04 + Math.random() * 0.08,
        r: 0.6 + Math.random() * 1.2,
        a: 0.35 + Math.random() * 0.4,
      })
    }
    for (let i = 0; i < SPICE; i++) {
      ps.push({
        kind: 'spice',
        x: Math.random() * w,
        y: h * 0.45 + Math.random() * h * 0.4,
        vx: 0.12 + Math.random() * 0.35,
        vy: -0.15 - Math.random() * 0.12,
        r: 0.8 + Math.random() * 1.6,
        a: 0.18 + Math.random() * 0.32,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy
        if (p.x > w + 4 || p.y < -4) {
          p.x = -4
          p.y = p.kind === 'sand'
            ? h * 0.55 + Math.random() * h * 0.45
            : h * 0.45 + Math.random() * h * 0.4
        }
        ctx.fillStyle = p.kind === 'sand'
          ? `rgba(245, 215, 160, ${p.a})`
          : `rgba(220, 130, 60, ${p.a})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--arrakis">
      <div className="rs-ark-shimmer" />
      <div className="rs-ark-spice-haze" />
      {/* SHIELD WALL — distant jagged basalt range across the full horizon */}
      <div className="rs-ark-dune" style={{ opacity: 0.5 }}>
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="ark-shieldwall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#a06850" stopOpacity="0.75" />
              <stop offset="60%" stopColor="#5a3018" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#2a1408" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path d="M 0 600 L 60 560 L 120 590 L 200 530 L 280 580 L 360 510
                   L 460 580 L 540 520 L 640 580 L 740 530 L 840 590 L 940 540
                   L 1040 600 L 1140 540 L 1240 590 L 1340 530 L 1440 580 L 1560 540
                   L 1600 580 L 1600 760 L 0 760 Z"
                fill="url(#ark-shieldwall)" />
        </svg>
      </div>
      {/* ROCK SPIRES — eroded buttes left of center, signature Dune silhouette */}
      <div className="rs-ark-dune" style={{ opacity: 0.85 }}>
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="ark-spire-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#c47438" />
              <stop offset="55%" stopColor="#7a3a18" />
              <stop offset="100%" stopColor="#2a1408" />
            </linearGradient>
            <linearGradient id="ark-spire-shadow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#1a0a04" />
              <stop offset="100%" stopColor="#4a2410" />
            </linearGradient>
            <pattern id="ark-strata" x="0" y="0" width="20" height="6" patternUnits="userSpaceOnUse">
              <line x1="0" y1="3" x2="20" y2="3" stroke="#3a1c08" strokeWidth="0.6" opacity="0.5" />
            </pattern>
          </defs>
          {/* Tall butte (left of center) */}
          <path d="M 280 640 L 300 480 L 340 460 L 380 470 L 410 490 L 420 640 Z"
                fill="url(#ark-spire-front)" />
          <path d="M 410 490 L 420 640 L 440 640 L 432 510 Z"
                fill="url(#ark-spire-shadow)" />
          <path d="M 280 640 L 300 480 L 340 460 L 380 470 L 410 490 L 420 640 Z"
                fill="url(#ark-strata)" opacity="0.5" />
          {/* Mesa cluster */}
          <path d="M 460 660 L 480 580 L 540 560 L 600 570 L 640 580 L 660 660 Z"
                fill="url(#ark-spire-front)" />
          <path d="M 640 580 L 660 660 L 680 660 L 660 590 Z"
                fill="url(#ark-spire-shadow)" />
          <path d="M 460 660 L 480 580 L 540 560 L 600 570 L 640 580 L 660 660 Z"
                fill="url(#ark-strata)" opacity="0.5" />
          {/* Smaller spire */}
          <path d="M 700 680 L 715 620 L 740 610 L 765 615 L 780 625 L 790 680 Z"
                fill="url(#ark-spire-front)" />
          <path d="M 780 625 L 790 680 L 800 680 L 794 632 Z"
                fill="url(#ark-spire-shadow)" />
          {/* Sietch cave openings — black ellipses on the butte faces */}
          <g fill="#000">
            <ellipse cx="332" cy="540" rx="3" ry="6" />
            <ellipse cx="358" cy="560" rx="4" ry="7" />
            <ellipse cx="380" cy="540" rx="3" ry="5" />
            <ellipse cx="520" cy="600" rx="4" ry="6" />
            <ellipse cx="572" cy="610" rx="3" ry="5" />
            <ellipse cx="608" cy="600" rx="3" ry="6" />
          </g>
          {/* Faint warm glow inside the largest sietches */}
          <ellipse cx="358" cy="560" rx="2" ry="3" fill="#ff8038" opacity="0.6" />
          <ellipse cx="520" cy="600" rx="2" ry="3" fill="#ff8038" opacity="0.6" />
        </svg>
      </div>
      {/* FAR DUNE — closer than shield wall, behind mid */}
      <div className="rs-ark-dune" style={{ opacity: 0.7 }}>
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="ark-dune-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#d49558" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#8a4818" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#3a1f10" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d="M 0 750 C 160 720, 320 770, 480 730 C 640 690, 800 760, 960 720
                   C 1120 690, 1280 770, 1440 730 C 1520 710, 1600 750, 1600 750
                   L 1600 1000 L 0 1000 Z" fill="url(#ark-dune-far)" />
          {/* Distant spice harvester silhouette — scale-defining */}
          <g transform="translate(1080 738)" fill="#1a0a04" opacity="0.85">
            <rect x="0" y="0" width="60" height="10" />
            <rect x="6" y="-6" width="48" height="8" />
            <rect x="-4" y="2" width="6" height="10" />
            <rect x="58" y="2" width="6" height="10" />
            <rect x="22" y="-12" width="6" height="6" />
            <rect x="32" y="-12" width="6" height="6" />
          </g>
          {/* Dust plume from harvester */}
          <ellipse cx="1110" cy="744" rx="80" ry="6" fill="#d4a060" opacity="0.45" />
        </svg>
      </div>
      <div className="rs-ark-dune" style={{ opacity: 0.85 }}>
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="ark-dune-mid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#d49558" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#6a3818" stopOpacity="0.97" />
              <stop offset="100%" stopColor="#1a0a04" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d="M 0 840 C 220 800, 460 870, 700 820 C 940 770, 1180 880, 1420 830
                   C 1500 815, 1600 850, 1600 840 L 1600 1000 L 0 1000 Z"
                fill="url(#ark-dune-mid)" />
          <path d="M 0 840 C 220 800, 460 870, 700 820 C 940 770, 1180 880, 1420 830 C 1500 815, 1600 850, 1600 840"
                fill="none" stroke="rgba(255, 220, 160, 0.45)" strokeWidth="1.2" />
        </svg>
      </div>
      <div className="rs-ark-wormsign" />
      <div className="rs-ark-spice-blow" />
      <div className="rs-ark-dune">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="ark-dune-fore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#8a4820" stopOpacity="1" />
              <stop offset="50%" stopColor="#2a140a" stopOpacity="1" />
              <stop offset="100%" stopColor="#0a0402" stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d="M 0 940 C 280 880, 700 970, 1100 920 C 1340 895, 1500 940, 1600 925
                   L 1600 1000 L 0 1000 Z" fill="url(#ark-dune-fore)" />
          <path d="M 0 940 C 280 880, 700 970, 1100 920 C 1340 895, 1500 940, 1600 925"
                fill="none" stroke="rgba(255, 180, 110, 0.5)" strokeWidth="1.6" />
        </svg>
      </div>
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   FORERUNNER · HALO — ceramic-blue ancient alien architecture,
   hard-light beams, distant ring arc in the sky. Mathematical
   geometry, soft glow, motes rising slowly through holy quiet.
   ============================================================ */
function ForerunnerScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const MOTES = 30
    const ms = []
    for (let i = 0; i < MOTES; i++) {
      ms.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -0.04 + Math.random() * 0.08,
        vy: -0.3 - Math.random() * 0.3,
        r: 0.8 + Math.random() * 1.6,
        a: 0.3 + Math.random() * 0.4,
        glow: 6 + Math.random() * 8,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const m of ms) {
        m.x += m.vx; m.y += m.vy
        if (m.y < -m.glow) { m.y = h + m.glow; m.x = Math.random() * w }
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.glow)
        g.addColorStop(0, `rgba(180, 230, 255, ${m.a})`)
        g.addColorStop(1, 'rgba(180, 230, 255, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(m.x, m.y, m.glow, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--forerunner">
      {/* Distant Halo ring arc — thin band curving across upper sky */}
      <div className="rs-fr-ring" />
      <div className="rs-fr-glow" />
      {/* Hard-light vertical beam — slow pulse */}
      <div className="rs-fr-beam" style={{ left: '28%' }} />
      <div className="rs-fr-beam rs-fr-beam--d1" style={{ left: '64%' }} />
      {/* Forerunner architecture — ceramic panels with hex inset patterns */}
      <div className="rs-fr-arch">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="fr-ceramic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#4a7090" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#1a3450" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#050a14" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="fr-ceramic-lit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#8acdf5" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#1a3450" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="fr-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#3a5878" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0a1018" stopOpacity="0.55" />
            </linearGradient>
            {/* Hexagonal panel pattern — Forerunner signature inset */}
            <pattern id="fr-hex" x="0" y="0" width="36" height="32" patternUnits="userSpaceOnUse">
              <polygon points="18,2 32,10 32,24 18,32 4,24 4,10"
                       fill="none" stroke="#7fcaff" strokeWidth="0.4" opacity="0.45" />
            </pattern>
          </defs>

          {/* Distant geometry — faded background tier */}
          <g fill="url(#fr-far)">
            <rect x="100"  y="540" width="80"  height="220" />
            <polygon points="100,540 140,500 180,540" />
            <rect x="1400" y="520" width="90"  height="240" />
            <polygon points="1400,520 1445,476 1490,520" />
          </g>

          {/* LEFT CEREMONIAL ARCHWAY */}
          <g>
            <rect x="200" y="520" width="100" height="200" fill="url(#fr-ceramic)" />
            <rect x="200" y="520" width="100" height="200" fill="url(#fr-hex)" />
            <rect x="280" y="528" width="20"  height="192" fill="#050a14" opacity="0.55" />
            <polygon points="200,520 250,480 300,520" fill="url(#fr-ceramic-lit)" />
            {/* Emissive glyph column */}
            <rect x="244" y="560" width="3" height="120" fill="#9fdcff" opacity="0.85" />
            <rect x="240" y="558" width="11" height="2"   fill="#9fdcff" opacity="0.7" />
            <rect x="240" y="678" width="11" height="2"   fill="#9fdcff" opacity="0.7" />
          </g>

          {/* CENTRAL CRYPTUM — tall layered structure */}
          <g>
            {/* Lower base */}
            <rect x="560" y="600" width="280" height="120" fill="url(#fr-ceramic)" />
            <rect x="560" y="600" width="280" height="120" fill="url(#fr-hex)" />
            <rect x="820" y="608" width="20"  height="112" fill="#050a14" opacity="0.55" />
            {/* Mid section */}
            <rect x="610" y="500" width="180" height="100" fill="url(#fr-ceramic)" />
            <rect x="610" y="500" width="180" height="100" fill="url(#fr-hex)" />
            <rect x="770" y="508" width="20"  height="92"  fill="#050a14" opacity="0.55" />
            {/* Upper geometric peak */}
            <polygon points="610,500 700,400 790,500" fill="url(#fr-ceramic-lit)" />
            <polygon points="700,400 790,500 770,510" fill="#050a14" opacity="0.55" />
            {/* Glyph cross + slits — emissive */}
            <rect x="690" y="540" width="20" height="3" fill="#9fdcff" opacity="0.9" />
            <rect x="698" y="528" width="4"  height="28" fill="#9fdcff" opacity="0.9" />
            <rect x="620" y="640" width="160" height="3" fill="#9fdcff" opacity="0.75" />
            <rect x="640" y="660" width="120" height="2" fill="#9fdcff" opacity="0.5" />
            <rect x="660" y="676" width="80"  height="2" fill="#9fdcff" opacity="0.4" />
          </g>

          {/* RIGHT TIERED STRUCTURE */}
          <g>
            <rect x="1100" y="560" width="200" height="160" fill="url(#fr-ceramic)" />
            <rect x="1100" y="560" width="200" height="160" fill="url(#fr-hex)" />
            <rect x="1280" y="568" width="20"  height="152" fill="#050a14" opacity="0.55" />
            <rect x="1140" y="480" width="120" height="80"  fill="url(#fr-ceramic)" />
            <rect x="1140" y="480" width="120" height="80"  fill="url(#fr-hex)" />
            <rect x="1240" y="486" width="20"  height="74"  fill="#050a14" opacity="0.55" />
            <polygon points="1140,480 1200,440 1260,480" fill="url(#fr-ceramic-lit)" />
            {/* Vertical emissive seam */}
            <rect x="1198" y="490" width="4"  height="220" fill="#9fdcff" opacity="0.7" />
          </g>

          {/* Horizontal hard-light beam crossing mid */}
          <rect x="0" y="640" width="1600" height="1" fill="#9fdcff" opacity="0.35" />

          {/* Tiny holographic figures floating in front of glyph wall */}
          <g fill="#9fdcff" opacity="0.6">
            <circle cx="700" cy="700" r="2" />
            <rect x="699" y="702" width="2" height="6" />
            <circle cx="1200" cy="700" r="2" />
            <rect x="1199" y="702" width="2" height="6" />
          </g>
        </svg>
      </div>
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   UNSC · HALO — combat steel hangar bay or military outpost.
   Cold blue floodlights, warm amber interior glow, atmospheric
   dust caught in light shafts, occasional welding spark.
   ============================================================ */
function UNSCScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const DUST = 32
    const ds = []
    for (let i = 0; i < DUST; i++) {
      ds.push({
        kind: Math.random() < 0.1 ? 'spark' : 'dust',
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 0.1 + Math.random() * 0.3,
        vy: -0.1 + Math.random() * 0.2,
        r: 0.5 + Math.random() * 1.2,
        a: 0.25 + Math.random() * 0.4,
        life: 200 + Math.random() * 400,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const d of ds) {
        d.x += d.vx; d.y += d.vy; d.life -= 1
        if (d.x > w + 4 || d.life <= 0) {
          d.x = -4; d.y = Math.random() * h
          d.life = 200 + Math.random() * 400
        }
        if (d.kind === 'spark') {
          ctx.fillStyle = `rgba(255, 180, 90, ${d.a})`
        } else {
          ctx.fillStyle = `rgba(180, 195, 210, ${d.a * 0.55})`
        }
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--unsc">
      {/* Volumetric floodlight shaft — slow drift */}
      <div className="rs-unsc-shaft" style={{ left: '18%' }} />
      <div className="rs-unsc-shaft rs-unsc-shaft--d1" style={{ left: '62%' }} />
      <div className="rs-unsc-haze" />
      {/* Hangar — gantries, dropship, hazard stripes, control booth */}
      <div className="rs-unsc-frame">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="unsc-floor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2a3540" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#000" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="unsc-frame" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#1a2128" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#000" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="unsc-pillar" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#000" />
              <stop offset="100%" stopColor="#1a2128" />
            </linearGradient>
            {/* Hazard stripe pattern */}
            <pattern id="unsc-hazard" x="0" y="0" width="24" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect x="0" y="0" width="12" height="8" fill="#ffaa20" />
              <rect x="12" y="0" width="12" height="8" fill="#1a1a1a" />
            </pattern>
            <radialGradient id="unsc-floodglow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"  stopColor="#fff8d0" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#fff8d0" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Hangar back wall / deck plating */}
          <rect x="0" y="760" width="1600" height="240" fill="url(#unsc-floor)" />
          {/* Deck panel lines */}
          <g stroke="#0a1015" strokeWidth="1" opacity="0.55">
            {[800, 840, 880, 920, 960].map((y, i) =>
              <line key={i} x1="0" y1={y} x2="1600" y2={y} />
            )}
            {[200, 400, 600, 800, 1000, 1200, 1400].map((x, i) =>
              <line key={`v-${i}`} x1={x} y1="760" x2={x} y2="1000" />
            )}
          </g>

          {/* GANTRY pillars — heavy industrial supports */}
          <g fill="url(#unsc-pillar)">
            <rect x="0"    y="320" width="40"  height="680" />
            <rect x="280"  y="380" width="48"  height="620" />
            <rect x="1272" y="380" width="48"  height="620" />
            <rect x="1560" y="320" width="40"  height="680" />
          </g>
          {/* Horizontal gantry beam */}
          <rect x="0" y="320" width="1600" height="28" fill="url(#unsc-frame)" />
          <rect x="0" y="348" width="1600" height="4"  fill="#000" />
          {/* Cross-bracing diagonals */}
          <g stroke="#0a1015" strokeWidth="3" opacity="0.85">
            <line x1="40"   y1="348" x2="280"  y2="380" />
            <line x1="328"  y1="380" x2="280"  y2="348" />
            <line x1="1320" y1="348" x2="1272" y2="380" />
            <line x1="1272" y1="380" x2="1560" y2="348" />
          </g>
          {/* Hanging chains/cables */}
          <g stroke="#000" strokeWidth="1.5">
            <line x1="180" y1="350" x2="180" y2="540" />
            <line x1="400" y1="350" x2="400" y2="620" />
            <line x1="1200" y1="350" x2="1200" y2="600" />
            <line x1="1400" y1="350" x2="1400" y2="540" />
          </g>
          {/* Light fixtures on gantry */}
          <g>
            <circle cx="180"  cy="540" r="6" fill="#fff8d0" />
            <circle cx="180"  cy="540" r="20" fill="url(#unsc-floodglow)" />
            <circle cx="1400" cy="540" r="6" fill="#fff8d0" />
            <circle cx="1400" cy="540" r="20" fill="url(#unsc-floodglow)" />
          </g>

          {/* PELICAN DROPSHIP silhouette — left of center, scale-defining */}
          <g transform="translate(380 600)">
            {/* Main fuselage */}
            <path d="M 0 60 L 30 30 L 240 30 L 280 60 L 280 90 L 0 90 Z" fill="#0a1015" />
            {/* Cockpit */}
            <path d="M 240 30 L 290 36 L 300 60 L 280 60 Z" fill="#050810" />
            <rect x="252" y="36" width="36" height="14" fill="#3a8aff" opacity="0.6" />
            {/* Engine nacelles */}
            <ellipse cx="60"  cy="20" rx="32" ry="14" fill="#1a2530" />
            <ellipse cx="200" cy="20" rx="32" ry="14" fill="#1a2530" />
            <circle  cx="60"  cy="20" r="6" fill="#88ddff" opacity="0.7" />
            <circle  cx="200" cy="20" r="6" fill="#88ddff" opacity="0.7" />
            {/* Landing gear */}
            <rect x="40"  y="90" width="6" height="20" fill="#0a1015" />
            <rect x="234" y="90" width="6" height="20" fill="#0a1015" />
            {/* Open rear ramp + warm interior glow */}
            <rect x="0" y="60" width="20" height="30" fill="#ffa040" opacity="0.8" />
            <rect x="-2" y="64" width="6"  height="22" fill="#ffd080" />
          </g>

          {/* Hazard stripe band along the deck edge */}
          <rect x="380" y="708" width="280" height="10" fill="url(#unsc-hazard)" opacity="0.85" />

          {/* CONTROL BOOTH — small structure with lit windows */}
          <g>
            <rect x="900" y="640" width="160" height="80" fill="#0a1015" />
            <rect x="900" y="638" width="160" height="6"  fill="#000" />
            <rect x="1050" y="640" width="10" height="80" fill="#000" />
            {/* Lit cockpit windows */}
            <rect x="912" y="652" width="140" height="14" fill="#3a8aff" opacity="0.65" />
            <g stroke="#000" strokeWidth="1">
              <line x1="940" y1="652" x2="940" y2="666" />
              <line x1="980" y1="652" x2="980" y2="666" />
              <line x1="1020" y1="652" x2="1020" y2="666" />
            </g>
            {/* Antenna */}
            <line x1="980" y1="636" x2="980" y2="600" stroke="#000" strokeWidth="2" />
            <circle cx="980" cy="600" r="3" fill="#ff5040" className="rs-unsc-strobe" />
          </g>

          {/* Warm interior emissive slits at the back wall */}
          <g fill="#ffb070" opacity="0.75">
            <rect x="60"  y="820" width="200" height="3" />
            <rect x="700" y="820" width="180" height="3" />
            <rect x="1100" y="820" width="160" height="3" />
            <rect x="1340" y="820" width="180" height="3" />
          </g>

          {/* Crew silhouettes for scale */}
          <g fill="#000">
            <rect x="710" y="690" width="3" height="14" />
            <circle cx="711" cy="687" r="2" />
            <rect x="720" y="690" width="3" height="14" />
            <circle cx="721" cy="687" r="2" />
            <rect x="1080" y="700" width="3" height="14" />
            <circle cx="1081" cy="697" r="2" />
          </g>
        </svg>
      </div>
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   SPIRES · MONUMENT VALLEY 1 — cream sandstone towers with
   terracotta domes, deep plum twilight sky with stars, impossible
   stacked architecture, tiny Princess Ida silhouette, crows.
   ============================================================ */
function SpiresScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const MOTES = 18
    const ms = []
    for (let i = 0; i < MOTES; i++) {
      ms.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: -0.04 + Math.random() * 0.08,
        vy: -0.12 - Math.random() * 0.15,
        r: 1.2 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.2,
        hue: Math.random() < 0.5 ? 'gold' : 'rose',
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const m of ms) {
        m.x += m.vx; m.y += m.vy
        if (m.y < -m.r) { m.y = h + m.r; m.x = Math.random() * w }
        ctx.fillStyle = m.hue === 'gold'
          ? `rgba(245, 215, 150, ${m.a})`
          : `rgba(240, 180, 180, ${m.a})`
        ctx.beginPath()
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  /* Star field — generated once, twinkles via CSS class on the group */
  const stars = []
  for (let i = 0; i < 60; i++) {
    stars.push({
      cx: 40 + Math.random() * 1520,
      cy: 20 + Math.random() * 320,
      r: 0.6 + Math.random() * 1.3,
      o: 0.5 + Math.random() * 0.5,
    })
  }

  return (
    <PhotoStage envClass="rs-photo--spires">
      <div className="rs-mv-glow" />
      <div className="rs-mv-architecture">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            {/* Cream sandstone — front (lit) face */}
            <linearGradient id="mv1-cream-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#f0d4a0" />
              <stop offset="100%" stopColor="#d4b078" />
            </linearGradient>
            {/* Cream — right (shadow) face */}
            <linearGradient id="mv1-cream-shadow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#b08458" />
              <stop offset="100%" stopColor="#7a5a3a" />
            </linearGradient>
            {/* Terracotta dome */}
            <linearGradient id="mv1-terracotta" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#d4684a" />
              <stop offset="100%" stopColor="#8a3818" />
            </linearGradient>
            {/* Distant mesa silhouette */}
            <linearGradient id="mv1-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#8a5878" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#4a3858" stopOpacity="0.65" />
            </linearGradient>
          </defs>

          {/* STARS — upper sky field */}
          <g className="rs-mv-stars" fill="#f8f0d8">
            {stars.map((s, i) => (
              <circle key={i} cx={s.cx} cy={s.cy} r={s.r} opacity={s.o} />
            ))}
          </g>

          {/* DISTANT MESA — silhouettes on right horizon */}
          <g fill="url(#mv1-far)">
            <rect x="1180" y="420" width="100" height="500" />
            <rect x="1160" y="440" width="140" height="14" />
            <path d="M 1180 420 Q 1230 380 1280 420 Z" />
            <rect x="1340" y="460" width="80"  height="460" />
            <rect x="1440" y="440" width="100" height="480" />
            <path d="M 1440 440 Q 1490 400 1540 440 Z" />
          </g>

          {/* LEFT SECONDARY TOWER — cream column with terracotta dome */}
          <g>
            <rect x="220" y="500" width="110" height="420" fill="url(#mv1-cream-front)" />
            <rect x="310" y="510" width="20"  height="410" fill="url(#mv1-cream-shadow)" />
            <path d="M 220 500 Q 275 440 330 500 Z" fill="url(#mv1-terracotta)" />
            <circle cx="275" cy="438" r="4" fill="#d4a838" />
            <rect x="274" y="408" width="2" height="30" fill="#d4a838" />
            {/* Narrow window slits */}
            <g fill="#3a2418" opacity="0.7">
              <rect x="252" y="560" width="5" height="12" />
              <rect x="284" y="560" width="5" height="12" />
              <rect x="252" y="640" width="5" height="12" />
              <rect x="284" y="640" width="5" height="12" />
              <rect x="268" y="730" width="5" height="12" />
              <rect x="268" y="820" width="5" height="12" />
            </g>
          </g>

          {/* MAIN STACKED TOWER COMPLEX — three terraces, domed peak */}
          <g>
            {/* Base terrace */}
            <rect x="480" y="680" width="420" height="240" fill="url(#mv1-cream-front)" />
            <rect x="870" y="690" width="30"  height="230" fill="url(#mv1-cream-shadow)" />
            <rect x="480" y="676" width="420" height="6"   fill="#d4a838" />
            {/* Mid terrace */}
            <rect x="540" y="520" width="300" height="160" fill="url(#mv1-cream-front)" />
            <rect x="810" y="528" width="30"  height="152" fill="url(#mv1-cream-shadow)" />
            <rect x="540" y="516" width="300" height="6"   fill="#d4a838" />
            {/* Upper section */}
            <rect x="600" y="400" width="180" height="120" fill="url(#mv1-cream-front)" />
            <rect x="750" y="408" width="30"  height="112" fill="url(#mv1-cream-shadow)" />
            {/* Dome */}
            <path d="M 600 400 Q 690 300 780 400 Z" fill="url(#mv1-terracotta)" />
            {/* Gold finial on dome */}
            <rect x="688" y="252" width="4" height="48" fill="#d4a838" />
            <circle cx="690" cy="250" r="6" fill="#d4a838" />

            {/* Windows — small dark squares in rhythmic rows */}
            <g fill="#3a2418" opacity="0.7">
              {/* Base terrace — two rows */}
              {[510, 560, 610, 660, 710, 760, 810].map((x, i) => (
                <rect key={`b1-${i}`} x={x} y="730" width="8" height="14" />
              ))}
              {[510, 560, 610, 660, 710, 760, 810].map((x, i) => (
                <rect key={`b2-${i}`} x={x} y="820" width="8" height="14" />
              ))}
              {/* Mid terrace */}
              {[570, 610, 650, 690, 730, 770].map((x, i) => (
                <rect key={`m-${i}`} x={x} y="585" width="6" height="12" />
              ))}
              {/* Upper section */}
              {[620, 660, 700, 740].map((x, i) => (
                <rect key={`u-${i}`} x={x} y="445" width="6" height="12" />
              ))}
            </g>
          </g>

          {/* IMPOSSIBLE STAIRCASE — ascending from base, leading to nothing */}
          <g>
            {Array.from({ length: 9 }).map((_, i) => (
              <g key={i}>
                <rect x={920 + i * 26} y={760 - i * 22} width="42" height="10"
                      fill="url(#mv1-cream-front)" />
                <rect x={920 + i * 26 + 36} y={762 - i * 22} width="8" height="10"
                      fill="url(#mv1-cream-shadow)" />
              </g>
            ))}
            {/* Landing at top */}
            <rect x="1148" y="560" width="80" height="14" fill="url(#mv1-cream-front)" />
            <rect x="1220" y="562" width="10" height="14" fill="url(#mv1-cream-shadow)" />
            <rect x="1170" y="538" width="42" height="6"  fill="#d4a838" />
          </g>

          {/* FLOATING ARCHWAY — disconnected, classic MV impossibility */}
          <g transform="translate(1340 640)">
            <path d="M 0 0 Q 50 -34 100 0 L 100 14 L 0 14 Z" fill="url(#mv1-cream-front)" />
            <rect x="0"  y="14" width="16" height="100" fill="url(#mv1-cream-front)" />
            <rect x="84" y="14" width="16" height="100" fill="url(#mv1-cream-front)" />
            <rect x="92" y="14" width="8"  height="100" fill="url(#mv1-cream-shadow)" />
            <rect x="-2" y="116" width="104" height="6" fill="#d4a838" />
          </g>

          {/* PRINCESS IDA — tiny white figure atop main dome */}
          <g transform="translate(690 238)">
            <circle cx="0" cy="-2" r="3" fill="#f8f0e0" />
            <path d="M -5 1 L 5 1 L 7 14 L -7 14 Z" fill="#f8f0e0" />
          </g>

          {/* CROWS — three silhouettes, one in flight */}
          <g fill="#1a0a18">
            <g transform="translate(305 498)">
              <ellipse cx="0" cy="0" rx="6" ry="3" />
              <path d="M -2 -3 L 1 -9 L 3 -3 Z" />
              <path d="M 5 1 L 9 -1 L 6 1 Z" />
            </g>
            <g transform="translate(870 678)">
              <ellipse cx="0" cy="0" rx="5" ry="2.5" />
              <path d="M -1 -2 L 1 -7 L 3 -2 Z" />
              <path d="M 4 0 L 8 -2 L 5 0 Z" />
            </g>
            {/* Crow in flight */}
            <g transform="translate(960 360)">
              <path d="M -10 0 Q -5 -4 0 0 Q 5 -4 10 0 Q 5 2 0 0 Q -5 2 -10 0 Z" />
            </g>
            <g transform="translate(540 280)">
              <path d="M -8 0 Q -4 -3 0 0 Q 4 -3 8 0 Q 4 1 0 0 Q -4 1 -8 0 Z" />
            </g>
          </g>

          {/* BANNER — long Atreides-style banner hanging off main tower */}
          <g>
            <line x1="930" y1="436" x2="930" y2="436" stroke="#000" strokeWidth="1" />
            <rect x="924" y="432" width="14" height="3"  fill="#3a2418" />
            <rect x="928" y="435" width="6"  height="60" fill="#9a3a2a" />
            <polygon points="928,495 934,495 931,506" fill="#9a3a2a" />
            <rect x="930" y="450" width="2" height="20" fill="#d4a838" opacity="0.8" />
          </g>

          {/* CONNECTING WALKWAY — between left tower and main complex */}
          <g>
            <rect x="330" y="600" width="160" height="10" fill="url(#mv1-cream-front)" />
            <rect x="486" y="604" width="4" height="10" fill="url(#mv1-cream-shadow)" />
            {/* Walkway support pillars */}
            <rect x="360" y="610" width="4" height="60" fill="url(#mv1-cream-shadow)" />
            <rect x="420" y="610" width="4" height="50" fill="url(#mv1-cream-shadow)" />
            {/* Railing dots */}
            <g fill="#d4a838" opacity="0.85">
              <circle cx="350" cy="600" r="1.5" />
              <circle cx="390" cy="600" r="1.5" />
              <circle cx="430" cy="600" r="1.5" />
              <circle cx="470" cy="600" r="1.5" />
            </g>
          </g>

          {/* FLOATING ISLAND with a tiny tree — far back, dreamlike */}
          <g opacity="0.75">
            <ellipse cx="1050" cy="290" rx="36" ry="10" fill="url(#mv1-cream-front)" />
            <rect x="1048" y="272" width="3" height="18" fill="#5a3818" />
            <ellipse cx="1050" cy="270" rx="14" ry="10" fill="#7a4858" />
            <ellipse cx="1045" cy="265" rx="10" ry="8"  fill="#9a5868" />
          </g>
        </svg>
      </div>
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   GARDEN · MONUMENT VALLEY 2 — pink cherry-blossom cloud canopies,
   cream pavilion with peaked terracotta roof above a still
   reflecting pool. Soft mother-daughter moment, hushed dreamlike.
   ============================================================ */
function GardenScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const PETALS = 28
    const ps = []
    for (let i = 0; i < PETALS; i++) {
      ps.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.6,
        vx: 0.15 + Math.random() * 0.35,
        vy: 0.25 + Math.random() * 0.45,
        rot: Math.random() * Math.PI * 2,
        spin: -0.02 + Math.random() * 0.04,
        size: 3 + Math.random() * 4,
        a: 0.45 + Math.random() * 0.4,
        hue: Math.random() < 0.7 ? 'pink' : 'cream',
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.rot += p.spin
        if (p.y > h * 0.7) {
          p.x = -8 + Math.random() * w * 0.5
          p.y = -8
        }
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.hue === 'pink'
          ? `rgba(245, 165, 190, ${p.a})`
          : `rgba(255, 230, 210, ${p.a})`
        ctx.beginPath()
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  })

  /* A cluster of overlapping ellipses = one cherry-blossom canopy. */
  const Canopy = ({ cx, cy, scale = 1, alpha = 1 }) => (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} opacity={alpha}>
      <ellipse cx="-60" cy="20" rx="55" ry="40" fill="#c8788a" />
      <ellipse cx="50"  cy="25" rx="60" ry="42" fill="#c8788a" />
      <ellipse cx="-30" cy="-10" rx="65" ry="48" fill="#e8a0b8" />
      <ellipse cx="30"  cy="-15" rx="60" ry="45" fill="#e8a0b8" />
      <ellipse cx="-50" cy="-30" rx="48" ry="36" fill="#f5b8c8" />
      <ellipse cx="20"  cy="-40" rx="55" ry="40" fill="#f5b8c8" />
      <ellipse cx="-10" cy="-55" rx="42" ry="32" fill="#fad0d8" />
    </g>
  )

  return (
    <PhotoStage envClass="rs-photo--garden">
      <div className="rs-mv-sun-rays" />
      <div className="rs-mv2-water" />
      <div className="rs-mv-architecture">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            {/* Pavilion cream walls */}
            <linearGradient id="mv2-cream-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#f8e8d0" />
              <stop offset="100%" stopColor="#e0c8a8" />
            </linearGradient>
            <linearGradient id="mv2-cream-shadow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#c0a888" />
              <stop offset="100%" stopColor="#8a7858" />
            </linearGradient>
            {/* Pavilion terracotta roof */}
            <linearGradient id="mv2-roof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#d4684a" />
              <stop offset="100%" stopColor="#a04830" />
            </linearGradient>
            {/* Water — soft teal */}
            <linearGradient id="mv2-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#a8c0b8" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#586878" stopOpacity="1" />
            </linearGradient>
            {/* Tree trunk */}
            <linearGradient id="mv2-trunk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#6a4838" />
              <stop offset="100%" stopColor="#3a2818" />
            </linearGradient>
          </defs>

          {/* DISTANT BACKGROUND SPIRES — faded mauve silhouettes */}
          <g fill="#a08098" opacity="0.4">
            <rect x="80"   y="380" width="60"  height="320" />
            <rect x="180"  y="420" width="50"  height="280" />
            <rect x="1340" y="400" width="70"  height="300" />
            <rect x="1460" y="440" width="60"  height="260" />
            <path d="M 80 380 Q 110 350 140 380 Z" />
            <path d="M 1340 400 Q 1375 370 1410 400 Z" />
          </g>

          {/* DISTANT CHERRY TREES — faded back layer */}
          <g opacity="0.55">
            <rect x="280" y="540" width="6" height="100" fill="url(#mv2-trunk)" />
            <Canopy cx={283} cy={540} scale={0.7} alpha={0.85} />
            <rect x="1250" y="520" width="6" height="120" fill="url(#mv2-trunk)" />
            <Canopy cx={1253} cy={520} scale={0.8} alpha={0.85} />
          </g>

          {/* LEFT CHERRY TREE CLUSTER */}
          <g>
            <rect x="200" y="500" width="10" height="200" fill="url(#mv2-trunk)" />
            <Canopy cx={205} cy={500} scale={1.1} />
            <rect x="380" y="480" width="10" height="220" fill="url(#mv2-trunk)" />
            <Canopy cx={385} cy={480} scale={1.0} />
          </g>

          {/* PAVILION — cream walls, terracotta peaked roof, columns */}
          <g>
            {/* Base platform */}
            <rect x="560" y="660" width="440" height="40" fill="url(#mv2-cream-front)" />
            <rect x="980" y="666" width="20"  height="34" fill="url(#mv2-cream-shadow)" />
            {/* Columns */}
            {[600, 680, 760, 840, 920].map((x) => (
              <g key={x}>
                <rect x={x} y="520" width="22" height="140" fill="url(#mv2-cream-front)" />
                <rect x={x + 18} y="524" width="4" height="136" fill="url(#mv2-cream-shadow)" />
              </g>
            ))}
            {/* Entablature */}
            <rect x="560" y="500" width="400" height="24" fill="url(#mv2-cream-front)" />
            <rect x="940" y="504" width="20"  height="20" fill="url(#mv2-cream-shadow)" />
            <rect x="560" y="494" width="400" height="6"  fill="#d4a838" />
            {/* Peaked terracotta roof */}
            <polygon points="540,500 760,360 980,500" fill="url(#mv2-roof)" />
            <polygon points="980,500 760,360 760,360 990,510" fill="#7a3018" opacity="0.55" />
            {/* Roof finial */}
            <rect x="758" y="320" width="4" height="44" fill="#d4a838" />
            <circle cx="760" cy="318" r="6" fill="#d4a838" />
            {/* Roof tile lines */}
            <g stroke="#7a3018" strokeWidth="1" opacity="0.5">
              <line x1="580" y1="488" x2="730" y2="388" />
              <line x1="620" y1="488" x2="745" y2="404" />
              <line x1="900" y1="488" x2="775" y2="404" />
              <line x1="940" y1="488" x2="790" y2="388" />
            </g>
          </g>

          {/* RIGHT CHERRY TREE CLUSTER */}
          <g>
            <rect x="1080" y="500" width="10" height="200" fill="url(#mv2-trunk)" />
            <Canopy cx={1085} cy={500} scale={1.0} />
            <rect x="1260" y="490" width="10" height="210" fill="url(#mv2-trunk)" />
            <Canopy cx={1265} cy={490} scale={1.15} />
          </g>

          {/* STONE PATH — leading into the pavilion */}
          <g fill="url(#mv2-cream-front)">
            <rect x="760" y="710" width="40" height="8" />
            <rect x="700" y="720" width="40" height="8" />
            <rect x="820" y="720" width="40" height="8" />
            <rect x="760" y="730" width="40" height="8" />
          </g>

          {/* TWO IDA-LIKE FIGURES on the pavilion platform — MV2 mother/daughter */}
          <g fill="#f8f0e0">
            <g transform="translate(720 638)">
              <circle cx="0" cy="-2" r="3.5" />
              <path d="M -6 1 L 6 1 L 8 22 L -8 22 Z" />
            </g>
            <g transform="translate(740 642)">
              <circle cx="0" cy="-2" r="2.5" />
              <path d="M -4 1 L 4 1 L 5 16 L -5 16 Z" />
            </g>
          </g>

          {/* WATER REFLECTION — pavilion + trees, flipped + softened.
              Sits inside the water region (y > 760). */}
          <g opacity="0.35" transform="translate(0 1520) scale(1 -1)">
            {/* Reflection of pavilion */}
            <rect x="560" y="660" width="440" height="40" fill="url(#mv2-cream-front)" />
            <polygon points="540,500 760,360 980,500" fill="url(#mv2-roof)" />
            {[600, 680, 760, 840, 920].map((x) => (
              <rect key={x} x={x} y="520" width="22" height="140" fill="url(#mv2-cream-front)" />
            ))}
            <rect x="560" y="500" width="400" height="24" fill="url(#mv2-cream-front)" />
            {/* Tree canopies reflection */}
            <Canopy cx={205} cy={500} scale={1.1} alpha={0.6} />
            <Canopy cx={385} cy={480} scale={1.0} alpha={0.6} />
            <Canopy cx={1085} cy={500} scale={1.0} alpha={0.6} />
            <Canopy cx={1265} cy={490} scale={1.15} alpha={0.6} />
          </g>

          {/* WATER RIPPLE LINES — horizontal streaks for stillness */}
          <g stroke="#f0d4d0" strokeWidth="1" opacity="0.25">
            <line x1="100"  y1="800" x2="320"  y2="800" />
            <line x1="420"  y1="830" x2="700"  y2="830" />
            <line x1="800"  y1="810" x2="1080" y2="810" />
            <line x1="1180" y1="840" x2="1480" y2="840" />
            <line x1="200"  y1="880" x2="540"  y2="880" />
            <line x1="700"  y1="900" x2="1100" y2="900" />
            <line x1="1200" y1="880" x2="1500" y2="880" />
          </g>

          {/* LILY PADS — small floating ellipses on water surface */}
          <g fill="#7a9888" opacity="0.7">
            <ellipse cx="260"  cy="820" rx="22" ry="6" />
            <ellipse cx="1340" cy="850" rx="20" ry="5" />
            <ellipse cx="500"  cy="890" rx="18" ry="5" />
            <ellipse cx="1100" cy="910" rx="24" ry="6" />
            <ellipse cx="780"  cy="870" rx="20" ry="5" />
          </g>
          {/* Lily flowers — tiny pink dots on the pads */}
          <g fill="#f8b8c8">
            <circle cx="262"  cy="816" r="3" />
            <circle cx="1342" cy="846" r="3" />
            <circle cx="1102" cy="906" r="3" />
            <circle cx="782"  cy="866" r="3" />
          </g>

          {/* HANGING LANTERNS from pavilion eaves — warm amber */}
          <g>
            <line x1="600"  y1="500" x2="600"  y2="540" stroke="#3a2418" strokeWidth="1" />
            <line x1="760"  y1="500" x2="760"  y2="544" stroke="#3a2418" strokeWidth="1" />
            <line x1="920"  y1="500" x2="920"  y2="540" stroke="#3a2418" strokeWidth="1" />
            <g fill="#ffb46a">
              <rect x="594" y="540" width="12" height="14" />
              <rect x="754" y="544" width="12" height="16" />
              <rect x="914" y="540" width="12" height="14" />
            </g>
            <g fill="#3a2418">
              <rect x="592" y="538" width="16" height="3" />
              <rect x="752" y="542" width="16" height="3" />
              <rect x="912" y="538" width="16" height="3" />
              <rect x="592" y="554" width="16" height="2" />
              <rect x="752" y="560" width="16" height="2" />
              <rect x="912" y="554" width="16" height="2" />
            </g>
            {/* Soft glow halo behind each lantern */}
            <g fill="#ffb46a" opacity="0.35">
              <circle cx="600" cy="547" r="14" />
              <circle cx="760" cy="552" r="14" />
              <circle cx="920" cy="547" r="14" />
            </g>
          </g>

          {/* STEPPING STONES across the pool */}
          <g fill="#7a5848" opacity="0.85">
            <ellipse cx="940"  cy="800" rx="22" ry="7" />
            <ellipse cx="1010" cy="820" rx="22" ry="7" />
            <ellipse cx="1080" cy="800" rx="22" ry="7" />
            <ellipse cx="1150" cy="820" rx="22" ry="7" />
          </g>

          {/* DISTANT SMALLER PAVILION on the right shore — depth */}
          <g opacity="0.6">
            <rect x="1380" y="660" width="80" height="20" fill="url(#mv2-cream-front)" />
            <rect x="1390" y="610" width="6" height="50"  fill="url(#mv2-cream-front)" />
            <rect x="1410" y="610" width="6" height="50"  fill="url(#mv2-cream-front)" />
            <rect x="1430" y="610" width="6" height="50"  fill="url(#mv2-cream-front)" />
            <rect x="1450" y="610" width="6" height="50"  fill="url(#mv2-cream-front)" />
            <polygon points="1370,610 1418,576 1466,610" fill="url(#mv2-roof)" />
          </g>

          {/* WIND CHIME / banner ribbon hanging from corner */}
          <g>
            <line x1="540" y1="500" x2="540" y2="600" stroke="#3a2418" strokeWidth="1" />
            <rect x="538" y="540" width="4" height="20" fill="#f0a8b8" />
            <rect x="538" y="564" width="4" height="20" fill="#e87898" />
            <rect x="538" y="588" width="4" height="14" fill="#d45878" />
            <polygon points="538,602 542,602 540,610" fill="#d45878" />
          </g>

          {/* ADDITIONAL DISTANT TREES — small canopies on far shore */}
          <g opacity="0.55">
            <rect x="600" y="600" width="4" height="40" fill="url(#mv2-trunk)" />
            <Canopy cx={602} cy={610} scale={0.45} alpha={0.85} />
            <rect x="1000" y="600" width="4" height="40" fill="url(#mv2-trunk)" />
            <Canopy cx={1002} cy={610} scale={0.5} alpha={0.85} />
          </g>
        </svg>
      </div>
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   CORPO · NIGHT CITY — chrome megacorp plaza, neon billboards,
   AV traffic in the sky, rain reflecting holographic signage.
   ============================================================ */
function CorpoScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const RAIN = 70
    const drops = []
    for (let i = 0; i < RAIN; i++) {
      drops.push({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 10 + Math.random() * 14,
        vy: 12 + Math.random() * 6,
        a: 0.16 + Math.random() * 0.22,
        hue: Math.random() < 0.5 ? 'magenta' : 'cyan',
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const d of drops) {
        d.y += d.vy
        if (d.y > h + d.len) { d.y = -d.len; d.x = Math.random() * w }
        ctx.strokeStyle = d.hue === 'magenta'
          ? `rgba(255, 80, 200, ${d.a})`
          : `rgba(80, 220, 255, ${d.a})`
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x, d.y - d.len)
        ctx.stroke()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--corpo">
      <div className="rs-cp-neon-haze" />
      {/* Far skyline — distant towers in neon haze */}
      <div className="rs-cp-skyline rs-cp-skyline--far">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="cp-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2a1840" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0a0420" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d="M 0 580 L 40 580 L 40 380 L 100 380 L 100 580
                   L 180 580 L 180 320 L 240 320 L 240 580
                   L 340 580 L 340 360 L 400 360 L 400 580
                   L 500 580 L 500 280 L 580 280 L 580 580
                   L 700 580 L 700 340 L 780 340 L 780 580
                   L 880 580 L 880 300 L 960 300 L 960 580
                   L 1060 580 L 1060 360 L 1140 360 L 1140 580
                   L 1240 580 L 1240 320 L 1320 320 L 1320 580
                   L 1420 580 L 1420 380 L 1500 380 L 1500 580
                   L 1600 580 L 1600 1000 L 0 1000 Z"
                fill="url(#cp-far)" />
        </svg>
      </div>
      {/* Main skyline — megacorp towers with antennas, dishes, billboards */}
      <div className="rs-cp-skyline">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="cp-tower-front" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#0a0418" />
              <stop offset="55%" stopColor="#1a0e26" />
              <stop offset="100%" stopColor="#2a1a3a" />
            </linearGradient>
            <linearGradient id="cp-tower-side" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#1a0e26" />
              <stop offset="100%" stopColor="#000" />
            </linearGradient>
            <linearGradient id="cp-mega" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#2a1a4a" />
              <stop offset="100%" stopColor="#000" />
            </linearGradient>
          </defs>

          {/* Tower row — varied silhouettes with separated shadow strips */}
          <g>
            {/* Megacorp tower — wide left dominator */}
            <rect x="60"   y="240" width="170" height="480" fill="url(#cp-mega)" />
            <rect x="210"  y="248" width="20"  height="472" fill="url(#cp-tower-side)" />
            <rect x="60"   y="232" width="170" height="8"   fill="#000" />
            {/* Holographic billboard wrap */}
            <rect x="70"   y="320" width="60"  height="140" fill="#ff3aa0" opacity="0.4" />
            <rect x="74"   y="324" width="52"  height="132" fill="#3ad4ff" opacity="0.25" />
            {/* Tower 2 */}
            <rect x="290"  y="200" width="100" height="520" fill="url(#cp-tower-front)" />
            <rect x="378"  y="208" width="12"  height="512" fill="url(#cp-tower-side)" />
            {/* Tower 3 */}
            <rect x="440"  y="460" width="60"  height="260" fill="url(#cp-tower-front)" />
            <rect x="490"  y="466" width="10"  height="254" fill="url(#cp-tower-side)" />
            {/* Tower 4 */}
            <rect x="540"  y="280" width="120" height="440" fill="url(#cp-tower-front)" />
            <rect x="648"  y="288" width="12"  height="432" fill="url(#cp-tower-side)" />
            {/* Tower 5 — massive central */}
            <rect x="700"  y="160" width="140" height="560" fill="url(#cp-mega)" />
            <rect x="826"  y="170" width="14"  height="550" fill="url(#cp-tower-side)" />
            <rect x="700"  y="154" width="140" height="6"   fill="#000" />
            {/* Tower 6 */}
            <rect x="880"  y="360" width="90"  height="360" fill="url(#cp-tower-front)" />
            <rect x="958"  y="368" width="12"  height="352" fill="url(#cp-tower-side)" />
            {/* Tower 7 */}
            <rect x="1010" y="220" width="110" height="500" fill="url(#cp-tower-front)" />
            <rect x="1108" y="228" width="12"  height="492" fill="url(#cp-tower-side)" />
            {/* Tower 8 */}
            <rect x="1160" y="400" width="80"  height="320" fill="url(#cp-tower-front)" />
            <rect x="1228" y="406" width="12"  height="314" fill="url(#cp-tower-side)" />
            {/* Tower 9 */}
            <rect x="1280" y="280" width="120" height="440" fill="url(#cp-tower-front)" />
            <rect x="1388" y="288" width="12"  height="432" fill="url(#cp-tower-side)" />
            {/* Tower 10 */}
            <rect x="1440" y="340" width="100" height="380" fill="url(#cp-tower-front)" />
            <rect x="1528" y="346" width="12"  height="374" fill="url(#cp-tower-side)" />
          </g>

          {/* Antennas + comm spires on the tall towers */}
          <g stroke="#000" strokeWidth="2" fill="none">
            <line x1="340"  y1="200" x2="340"  y2="100" />
            <line x1="334"  y1="130" x2="346"  y2="130" />
            <line x1="328"  y1="160" x2="352"  y2="160" />
            <line x1="770"  y1="160" x2="770"  y2="40" />
            <line x1="760"  y1="70"  x2="780"  y2="70" />
            <line x1="754"  y1="100" x2="786"  y2="100" />
            <line x1="1065" y1="220" x2="1065" y2="120" />
            <line x1="1060" y1="160" x2="1070" y2="160" />
            <line x1="1340" y1="280" x2="1340" y2="200" />
          </g>
          {/* Antenna red blink at the very top */}
          <g fill="#ff3030">
            <circle cx="340"  cy="100" r="3" className="rs-cp-blink" />
            <circle cx="770"  cy="40"  r="3" className="rs-cp-blink rs-cp-blink--d1" />
            <circle cx="1065" cy="120" r="3" className="rs-cp-blink rs-cp-blink--d2" />
          </g>

          {/* Satellite dishes on rooftops */}
          <g fill="#1a1024" stroke="#000" strokeWidth="1">
            <ellipse cx="600" cy="276" rx="10" ry="6" />
            <line x1="600" y1="282" x2="600" y2="296" />
            <ellipse cx="1480" cy="336" rx="10" ry="6" />
            <line x1="1480" y1="342" x2="1480" y2="356" />
          </g>

          {/* Tower window grid — magenta + cyan + warm scattered */}
          <g>
            {Array.from({ length: 20 }).map((_, r) => (
              <g key={r}>
                {/* Tower 2 windows */}
                {[300, 312, 324, 336, 348, 360, 372].map((x, i) => (
                  <rect key={`t2-${r}-${i}`} x={x} y={220 + r*22} width="3" height="5"
                        fill={i % 3 === 0 ? '#ff3aa0' : i % 3 === 1 ? '#3ad4ff' : '#ffd06a'}
                        opacity={0.55 + (i % 2) * 0.3} />
                ))}
                {/* Tower 5 — central tall */}
                {[710, 725, 740, 755, 770, 785, 800, 815].map((x, i) => (
                  <rect key={`t5-${r}-${i}`} x={x} y={180 + r*22} width="3" height="5"
                        fill={i % 2 ? '#3ad4ff' : '#ff3aa0'}
                        opacity={0.6 + (i % 2) * 0.3} />
                ))}
                {/* Tower 7 */}
                {[1020, 1034, 1048, 1062, 1076, 1090].map((x, i) => (
                  <rect key={`t7-${r}-${i}`} x={x} y={240 + r*22} width="3" height="5"
                        fill={i % 2 ? '#ff3aa0' : '#ffd06a'}
                        opacity={0.55 + (i % 2) * 0.3} />
                ))}
              </g>
            ))}
          </g>

          {/* Holographic VERTICAL ad — magenta column on Tower 4 */}
          <rect x="552" y="320" width="22" height="180" fill="#ff3aa0" opacity="0.55" />
          <rect x="552" y="320" width="22" height="180" fill="none" stroke="#ff3aa0" strokeWidth="1" opacity="0.85" />
          {/* Holographic ad on Tower 7 */}
          <rect x="1014" y="260" width="80" height="60" fill="#3ad4ff" opacity="0.35" />
          <rect x="1014" y="260" width="80" height="60" fill="none" stroke="#3ad4ff" strokeWidth="1" opacity="0.85" />
        </svg>
      </div>
      {/* AV running lights — drift across sky */}
      <div className="rs-cp-av" style={{ top: '22%' }} />
      <div className="rs-cp-av rs-cp-av--d1" style={{ top: '38%' }} />
      {/* Holographic billboard glow */}
      <div className="rs-cp-billboard" />
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

/* ============================================================
   PACIFICA · NIGHT CITY — street level. Wet asphalt, sign flicker,
   neon under rain, NCPD strobe somewhere in the distance.
   ============================================================ */
function PacificaScene() {
  const canvasRef = useRef(null)
  useCanvasEffect(canvasRef, (ctx, w, h) => {
    const RAIN = 80
    const drops = []
    for (let i = 0; i < RAIN; i++) {
      drops.push({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 14 + Math.random() * 18,
        vx: 1.5,
        vy: 16 + Math.random() * 6,
        a: 0.22 + Math.random() * 0.3,
      })
    }
    return () => {
      ctx.clearRect(0, 0, w, h)
      for (const d of drops) {
        d.x += d.vx; d.y += d.vy
        if (d.y > h + d.len) { d.y = -d.len; d.x = Math.random() * w }
        ctx.strokeStyle = `rgba(190, 200, 220, ${d.a})`
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - d.vx * 2, d.y - d.len)
        ctx.stroke()
      }
    }
  })

  return (
    <PhotoStage envClass="rs-photo--pacifica">
      <div className="rs-pac-fog" />
      {/* Tenement row — fire escapes, signs, debris, NCPD cruiser */}
      <div className="rs-pac-street">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="pac-street" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#1a1a22" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#000" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="pac-building-side" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"  stopColor="#000" />
              <stop offset="100%" stopColor="#1a1a22" />
            </linearGradient>
            <linearGradient id="pac-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#1a1418" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#000" stopOpacity="1" />
            </linearGradient>
            {/* Graffiti scribble pattern */}
            <pattern id="pac-tag" x="0" y="0" width="60" height="40" patternUnits="userSpaceOnUse">
              <path d="M 4 30 Q 14 10 24 30 T 44 30" fill="none" stroke="#ff3aa0" strokeWidth="1.2" opacity="0.45" />
            </pattern>
          </defs>

          {/* Distant building silhouette — faded back layer */}
          <g fill="#0a0a14" opacity="0.65">
            <rect x="0"    y="360" width="240" height="260" />
            <rect x="280"  y="320" width="180" height="300" />
            <rect x="520"  y="380" width="200" height="240" />
            <rect x="760"  y="300" width="220" height="320" />
            <rect x="1020" y="350" width="200" height="270" />
            <rect x="1260" y="320" width="180" height="300" />
          </g>

          {/* MID/FOREGROUND tenement row — varied heights with shadow sides */}
          <g>
            <rect x="0"    y="500" width="180" height="240" fill="url(#pac-street)" />
            <rect x="160"  y="508" width="20"  height="232" fill="url(#pac-building-side)" />
            <rect x="220"  y="460" width="200" height="280" fill="url(#pac-street)" />
            <rect x="400"  y="468" width="20"  height="272" fill="url(#pac-building-side)" />
            <rect x="460"  y="420" width="180" height="320" fill="url(#pac-street)" />
            <rect x="620"  y="428" width="20"  height="312" fill="url(#pac-building-side)" />
            <rect x="680"  y="380" width="220" height="360" fill="url(#pac-street)" />
            <rect x="880"  y="388" width="20"  height="352" fill="url(#pac-building-side)" />
            <rect x="940"  y="440" width="200" height="300" fill="url(#pac-street)" />
            <rect x="1120" y="448" width="20"  height="292" fill="url(#pac-building-side)" />
            <rect x="1180" y="400" width="220" height="340" fill="url(#pac-street)" />
            <rect x="1380" y="408" width="20"  height="332" fill="url(#pac-building-side)" />
            <rect x="1440" y="460" width="160" height="280" fill="url(#pac-street)" />
            <rect x="1580" y="466" width="20"  height="274" fill="url(#pac-building-side)" />
          </g>

          {/* Graffiti wash on lower walls */}
          <g>
            <rect x="20"  y="640" width="140" height="80" fill="url(#pac-tag)" opacity="0.7" />
            <rect x="480" y="620" width="140" height="100" fill="url(#pac-tag)" opacity="0.55" />
            <rect x="960" y="640" width="160" height="80" fill="url(#pac-tag)" opacity="0.6" />
          </g>

          {/* FIRE ESCAPES — zigzag stairs on two buildings */}
          <g stroke="#000" strokeWidth="2" fill="none">
            {/* Left building fire escape */}
            <line x1="120" y1="520" x2="120" y2="720" />
            <line x1="160" y1="520" x2="160" y2="720" />
            <line x1="120" y1="560" x2="160" y2="560" />
            <line x1="120" y1="600" x2="160" y2="600" />
            <line x1="120" y1="640" x2="160" y2="640" />
            <line x1="120" y1="680" x2="160" y2="680" />
            <path d="M 120 560 L 100 580 L 100 600 L 120 600" />
            <path d="M 160 600 L 180 620 L 180 640 L 160 640" />
            {/* Tall central building fire escape */}
            <line x1="740" y1="420" x2="740" y2="720" />
            <line x1="780" y1="420" x2="780" y2="720" />
            <line x1="740" y1="470" x2="780" y2="470" />
            <line x1="740" y1="520" x2="780" y2="520" />
            <line x1="740" y1="570" x2="780" y2="570" />
            <line x1="740" y1="620" x2="780" y2="620" />
            <line x1="740" y1="670" x2="780" y2="670" />
            <path d="M 740 470 L 720 490 L 720 510 L 740 510" />
            <path d="M 780 520 L 800 540 L 800 560 L 780 560" />
            <path d="M 740 570 L 720 590 L 720 610 L 740 610" />
          </g>

          {/* Rooftop satellite dishes + air units */}
          <g fill="#0a0a0c" stroke="#000" strokeWidth="1">
            <ellipse cx="100" cy="496" rx="10" ry="4" />
            <line x1="100" y1="500" x2="100" y2="510" />
            <rect x="320" y="450" width="30" height="14" />
            <rect x="540" y="412" width="24" height="12" />
            <ellipse cx="1050" cy="436" rx="12" ry="5" />
            <line x1="1050" y1="441" x2="1050" y2="450" />
            <rect x="1280" y="392" width="36" height="14" />
          </g>

          {/* Window glow — warm, scattered, suggests inhabitants */}
          <g>
            {[
              [40,540],[60,560],[80,538],[100,580],[140,544],
              [240,490],[260,510],[290,488],[340,512],[380,488],
              [490,450],[510,470],[540,448],[580,472],
              [710,410],[730,440],[760,400],[800,438],[840,408],
              [970,470],[990,490],[1020,468],[1060,494],[1100,468],
              [1200,430],[1230,460],[1260,428],[1300,458],[1340,430],[1370,460],
              [1460,490],[1490,510],[1520,488],[1560,510]
            ].map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="5" height="7"
                    fill={i % 5 === 0 ? '#ff8a40' : i % 5 === 1 ? '#ffc070' : '#ffd890'}
                    opacity={0.55 + (i % 3) * 0.15} />
            ))}
          </g>

          {/* Neon signs */}
          <g className="rs-pac-sign-flicker">
            <rect x="240" y="500" width="100" height="22" fill="none" stroke="#ff3aa0" strokeWidth="2" opacity="0.9" />
            <text x="250" y="518" fill="#ff3aa0" fontSize="14" fontFamily="monospace" fontWeight="bold">RIPPERDOC</text>
          </g>
          <g className="rs-pac-sign-flicker">
            <rect x="700" y="430" width="120" height="22" fill="none" stroke="#3ad4ff" strokeWidth="2" opacity="0.9" />
            <text x="710" y="448" fill="#3ad4ff" fontSize="14" fontFamily="monospace" fontWeight="bold">PACIFICA</text>
          </g>
          <g className="rs-pac-sign-flicker">
            <rect x="1200" y="460" width="80" height="20" fill="none" stroke="#ffd06a" strokeWidth="2" opacity="0.9" />
            <text x="1208" y="476" fill="#ffd06a" fontSize="12" fontFamily="monospace" fontWeight="bold">JOY TOY</text>
          </g>
          {/* Vertical kanji-style sign on a building */}
          <g fill="#ff3aa0" opacity="0.85">
            <rect x="935" y="450" width="3" height="160" />
            <rect x="930" y="460" width="13" height="12" fill="none" stroke="#ff3aa0" strokeWidth="1.5" />
            <rect x="930" y="490" width="13" height="12" fill="none" stroke="#ff3aa0" strokeWidth="1.5" />
            <rect x="930" y="520" width="13" height="12" fill="none" stroke="#ff3aa0" strokeWidth="1.5" />
            <rect x="930" y="550" width="13" height="12" fill="none" stroke="#ff3aa0" strokeWidth="1.5" />
          </g>

          {/* WET STREET / GROUND in the foreground */}
          <rect x="0" y="730" width="1600" height="270" fill="url(#pac-ground)" />
          {/* Curb edge */}
          <rect x="0" y="730" width="1600" height="3" fill="#000" />
          <rect x="0" y="746" width="1600" height="1" fill="#1a1a22" opacity="0.6" />

          {/* TRASH / debris on the curb */}
          <g fill="#000">
            <ellipse cx="180" cy="752" rx="14" ry="4" />
            <rect x="174" y="748" width="12" height="6" />
            <ellipse cx="540" cy="754" rx="10" ry="3" />
            <rect x="534" y="750" width="6" height="4" />
            <ellipse cx="1380" cy="752" rx="12" ry="4" />
          </g>
          {/* Steam from sewer grate */}
          <g fill="#88809a" opacity="0.35">
            <ellipse cx="420" cy="734" rx="60" ry="6" />
            <ellipse cx="420" cy="722" rx="40" ry="5" />
            <ellipse cx="420" cy="710" rx="24" ry="4" />
          </g>

          {/* NCPD CRUISER silhouette — far down the street */}
          <g transform="translate(1240 720)" fill="#0a0a14">
            <path d="M 0 18 L 12 0 L 56 0 L 70 -6 L 110 -6 L 122 0 L 134 18 Z" />
            <rect x="20" y="-6" width="44" height="14" fill="#1a2a4a" />
            <rect x="74" y="-10" width="38" height="14" fill="#1a2a4a" />
            <ellipse cx="22" cy="22" rx="10" ry="6" fill="#000" />
            <ellipse cx="112" cy="22" rx="10" ry="6" fill="#000" />
            {/* Strobe rack on roof */}
            <rect x="56" y="-14" width="22" height="6" fill="#000" />
            <circle cx="60" cy="-12" r="3" fill="#3a80ff" className="rs-pac-strobe" />
            <circle cx="74" cy="-12" r="3" fill="#ff3030" className="rs-pac-strobe rs-pac-strobe--d1" />
          </g>

          {/* Strobe halo glow — soft red + blue wash on the wet street */}
          <ellipse cx="1300" cy="760" rx="120" ry="20" fill="#3a80ff" opacity="0.18">
            <animate attributeName="opacity" values="0.18;0;0.18" dur="1.4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="1300" cy="760" rx="120" ry="20" fill="#ff3030" opacity="0">
            <animate attributeName="opacity" values="0;0.18;0" dur="1.4s" repeatCount="indefinite" />
          </ellipse>

          {/* Pedestrian silhouette under a sign */}
          <g fill="#000">
            <circle cx="290" cy="710" r="5" />
            <path d="M 285 716 L 295 716 L 297 738 L 283 738 Z" />
            <rect x="287" y="738" width="3" height="14" />
            <rect x="291" y="738" width="3" height="14" />
          </g>
        </svg>
      </div>
      <div className="rs-pac-puddle" />
      <canvas ref={canvasRef} className="rs-photo-particles" />
    </PhotoStage>
  )
}

const SCENES = {
  atreides:   AtreidesScene,
  harkonnen:  HarkonnenScene,
  arrakis:    ArrakisScene,
  forerunner: ForerunnerScene,
  unsc:       UNSCScene,
  spires:     SpiresScene,
  garden:     GardenScene,
  corpo:      CorpoScene,
  pacifica:   PacificaScene,
}
