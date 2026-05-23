import React, { useRef, useEffect, useState, useCallback } from 'react'

// ─── Simulation constants ─────────────────────────────────────────────────────
const REPULSION   = 5000
const SPRING_LEN  = 130
const SPRING_K    = 0.055
const DAMPING     = 0.80
const CENTER_K    = 0.007
const MAX_TICKS   = 500
const RENDER_HZ   = 5   // re-render every N sim ticks

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nodeRadius(degree) { return 7 + Math.min(degree, 8) * 2.2 }

function nodeColor(n) {
  if (n.ghost) return 'transparent'
  if (n.virtual_path?.startsWith('household')) return 'var(--md-sys-color-tertiary)'
  return 'var(--primary)'
}

function nodeStroke(n) {
  if (n.ghost) return 'var(--md-outline)'
  if (n.virtual_path?.startsWith('household')) return 'var(--md-sys-color-tertiary)'
  return 'var(--primary)'
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VaultGraph({ nodes, edges, onNodeClick, activeNodePath }) {
  const wrapRef   = useRef(null)
  const simRef    = useRef(null)
  const rafRef    = useRef(null)
  const dragRef   = useRef(null)   // { nodeId, moved }
  const panRef    = useRef(null)   // { sx, sy, otx, oty }

  const [positions, setPositions] = useState({})
  const [tf, setTf]               = useState({ tx: 0, ty: 0, scale: 1 })
  const [hovered, setHovered]     = useState(null)
  const [wh, setWh]               = useState({ w: 800, h: 500 })

  // ── Measure container ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setWh({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Degree map ──────────────────────────────────────────────────────────────
  const degMap = {}
  nodes.forEach(n => { degMap[n.id] = 0 })
  edges.forEach(e => {
    if (degMap[e.source] != null) degMap[e.source]++
    if (degMap[e.target] != null) degMap[e.target]++
  })

  // ── Force simulation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nodes.length) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const pos = {}, vel = {}
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2
      const r     = Math.max(140, nodes.length * 20)
      pos[n.id] = { x: Math.cos(angle) * r + (Math.random() - 0.5) * 25,
                    y: Math.sin(angle) * r + (Math.random() - 0.5) * 25 }
      vel[n.id] = { x: 0, y: 0 }
    })

    simRef.current = { pos, vel, tick: 0, alive: true }
    setPositions({ ...pos })

    const ids = nodes.map(n => n.id)

    const tick = () => {
      const s = simRef.current
      if (!s || !s.alive || s.tick >= MAX_TICKS) return

      const f = {}
      ids.forEach(id => { f[id] = { x: 0, y: 0 } })

      // Node–node repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = s.pos[ids[i]], b = s.pos[ids[j]]
          const dx = b.x - a.x, dy = b.y - a.y
          const d2 = dx*dx + dy*dy || 0.01
          const d  = Math.sqrt(d2)
          const m  = REPULSION / d2
          f[ids[i]].x -= (dx/d)*m;  f[ids[i]].y -= (dy/d)*m
          f[ids[j]].x += (dx/d)*m;  f[ids[j]].y += (dy/d)*m
        }
      }

      // Edge spring
      edges.forEach(e => {
        const a = s.pos[e.source], b = s.pos[e.target]
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        const d  = Math.sqrt(dx*dx + dy*dy) || 0.01
        const m  = (d - SPRING_LEN) * SPRING_K
        f[e.source].x += (dx/d)*m;  f[e.source].y += (dy/d)*m
        f[e.target].x -= (dx/d)*m;  f[e.target].y -= (dy/d)*m
      })

      // Centre gravity
      ids.forEach(id => {
        f[id].x -= s.pos[id].x * CENTER_K
        f[id].y -= s.pos[id].y * CENTER_K
      })

      // Integrate
      ids.forEach(id => {
        if (dragRef.current?.nodeId === id) return
        s.vel[id].x = (s.vel[id].x + f[id].x) * DAMPING
        s.vel[id].y = (s.vel[id].y + f[id].y) * DAMPING
        s.pos[id].x += s.vel[id].x
        s.pos[id].y += s.vel[id].y
      })

      s.tick++
      if (s.tick % RENDER_HZ === 0) setPositions({ ...s.pos })
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (simRef.current) simRef.current.alive = false
    }
  }, [nodes, edges])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Coordinate helper (SVG space from client event) ─────────────────────────
  const svgXY = useCallback((e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - tf.tx - wh.w / 2) / tf.scale,
      y: (e.clientY - rect.top  - tf.ty - wh.h / 2) / tf.scale,
    }
  }, [tf, wh])

  // ── SVG-level mouse handlers (pan) ──────────────────────────────────────────
  const onSvgDown = useCallback((e) => {
    if (e.button !== 0) return
    panRef.current = { sx: e.clientX, sy: e.clientY, otx: tf.tx, oty: tf.ty }
  }, [tf])

  const onSvgMove = useCallback((e) => {
    if (dragRef.current) {
      const { x, y } = svgXY(e)
      if (simRef.current) {
        simRef.current.pos[dragRef.current.nodeId] = { x, y }
        simRef.current.vel[dragRef.current.nodeId] = { x: 0, y: 0 }
        dragRef.current.moved = true
        // wake sim if it stopped
        if (!simRef.current.alive || simRef.current.tick >= MAX_TICKS) {
          simRef.current.alive = true
          simRef.current.tick  = Math.max(0, simRef.current.tick - 120)
          rafRef.current = requestAnimationFrame(() => {})
        }
        setPositions(p => ({ ...p, [dragRef.current.nodeId]: { x, y } }))
      }
    } else if (panRef.current) {
      setTf(t => ({
        ...t,
        tx: panRef.current.otx + (e.clientX - panRef.current.sx),
        ty: panRef.current.oty + (e.clientY - panRef.current.sy),
      }))
    }
  }, [svgXY])

  const onSvgUp = useCallback(() => {
    dragRef.current = null
    panRef.current  = null
  }, [])

  const onWheel = useCallback((e) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.88 : 1.14
    setTf(t => ({ ...t, scale: Math.max(0.15, Math.min(5, t.scale * factor)) }))
  }, [])

  // ── Connected-nodes set for hover highlight ──────────────────────────────────
  const connSet = hovered
    ? new Set(edges.flatMap(e =>
        e.source === hovered ? [e.target] :
        e.target === hovered ? [e.source] : []))
    : null

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!nodes.length) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 14, opacity: 0.3 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 64 }}>hub</span>
        <span className="rs-card-meta">No indexed notes yet.<br />Create notes with [[wikilinks]] to build the graph.</span>
      </div>
    )
  }

  const cx = wh.w / 2, cy = wh.h / 2

  return (
    <div
      ref={wrapRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
               cursor: panRef.current ? 'grabbing' : 'grab' }}
    >
      <svg
        width={wh.w} height={wh.h}
        onMouseDown={onSvgDown}
        onMouseMove={onSvgMove}
        onMouseUp={onSvgUp}
        onMouseLeave={onSvgUp}
        onWheel={onWheel}
        style={{ display: 'block', userSelect: 'none' }}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--md-outline-variant)" />
          </marker>
        </defs>

        <g transform={`translate(${cx + tf.tx},${cy + tf.ty}) scale(${tf.scale})`}>

          {/* ── Edges ── */}
          {edges.map((e, i) => {
            const a = positions[e.source], b = positions[e.target]
            if (!a || !b) return null
            const lit = hovered && (e.source === hovered || e.target === hovered)
            const srcNode = nodes.find(n => n.id === e.source)
            const ghost   = srcNode?.ghost || nodes.find(n => n.id === e.target)?.ghost
            return (
              <line key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={lit ? 'var(--primary)' : 'var(--md-outline-variant)'}
                strokeWidth={lit ? 1.8 : 0.9}
                strokeOpacity={hovered && !lit ? 0.12 : 0.55}
                strokeDasharray={ghost ? '4 4' : undefined}
              />
            )
          })}

          {/* ── Nodes ── */}
          {nodes.map(n => {
            const p = positions[n.id]
            if (!p) return null
            const deg    = degMap[n.id] || 0
            const r      = nodeRadius(deg)
            const active = n.virtual_path === activeNodePath
            const faded  = hovered && hovered !== n.id && !connSet?.has(n.id)
            const label  = n.title?.length > 20 ? n.title.slice(0, 18) + '…' : (n.title || '')

            return (
              <g key={n.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: n.ghost ? 'default' : 'pointer' }}
                opacity={faded ? 0.15 : 1}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={e => {
                  e.stopPropagation()
                  dragRef.current = { nodeId: n.id, moved: false }
                }}
                onClick={e => {
                  e.stopPropagation()
                  if (!dragRef.current?.moved && !n.ghost) {
                    onNodeClick(n.virtual_path, n.title)
                  }
                  dragRef.current = null
                }}
              >
                {/* Outer glow ring for active */}
                {active && (
                  <circle r={r + 5} fill="none"
                    stroke="var(--primary)" strokeWidth={1.5} opacity={0.4} />
                )}

                {/* Node body */}
                <circle r={r}
                  fill={nodeColor(n)}
                  fillOpacity={n.ghost ? 0 : active ? 1 : 0.82}
                  stroke={nodeStroke(n)}
                  strokeWidth={n.ghost ? 1.2 : active ? 2 : 0}
                  strokeDasharray={n.ghost ? '3 3' : undefined}
                />

                {/* Degree badge — only when degree > 2 */}
                {deg > 2 && !n.ghost && (
                  <text textAnchor="middle" dy="0.35em"
                    fontSize={Math.min(r - 2, 9)} fontWeight="700"
                    fill="white" style={{ pointerEvents: 'none' }}>
                    {deg}
                  </text>
                )}

                {/* Label below */}
                <text textAnchor="middle" dy={r + 13}
                  fontSize={10} fontFamily="inherit"
                  fill="var(--md-on-surface)"
                  opacity={n.ghost ? 0.45 : 0.85}
                  style={{ pointerEvents: 'none' }}>
                  {label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* ── Tooltip ── */}
      {hovered && (() => {
        const n = nodes.find(x => x.id === hovered)
        if (!n) return null
        return (
          <div style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            padding: '6px 14px', borderRadius: 8, pointerEvents: 'none', whiteSpace: 'nowrap',
            background: 'var(--md-surface-container-highest)',
            border: '1px solid var(--md-outline-variant)',
            fontSize: '0.72rem', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span style={{ fontWeight: 600 }}>{n.title}</span>
            {n.virtual_path
              ? <span style={{ opacity: 0.45 }}>{n.virtual_path}</span>
              : <span style={{ opacity: 0.45, color: 'var(--md-sys-color-error)' }}>unlinked target</span>
            }
          </div>
        )
      })()}

      {/* ── Legend + hint ── */}
      <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
          <span className="rs-card-meta" style={{ fontSize: '0.65rem' }}>Personal</span>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--md-sys-color-tertiary)', display: 'inline-block', marginLeft: 8 }} />
          <span className="rs-card-meta" style={{ fontSize: '0.65rem' }}>Household</span>
          <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1px dashed var(--md-outline)', display: 'inline-block', marginLeft: 8 }} />
          <span className="rs-card-meta" style={{ fontSize: '0.65rem' }}>Unlinked target</span>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 10, right: 12, pointerEvents: 'none' }}>
        <span className="rs-card-meta" style={{ fontSize: '0.6rem', opacity: 0.35 }}>
          scroll · zoom  ·  drag canvas · pan  ·  drag node · reposition  ·  click node · open
        </span>
      </div>
    </div>
  )
}
