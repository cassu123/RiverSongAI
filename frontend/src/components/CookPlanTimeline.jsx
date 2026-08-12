/**
 * CookPlanTimeline — the plan as a picture.
 *
 * A list of steps sorted by time is correct and still hard to read: it cannot
 * show that the chicken is in the oven *while* you peel the potatoes, which is
 * the one thing the schedule exists to work out. Overlap is spatial, so it
 * wants a spatial answer.
 *
 * One lane per dish. Solid blocks are your hands; striped ones are the oven's
 * time and yours to spend elsewhere — that distinction is the whole scheduler,
 * so it is what the fill is used for rather than something decorative.
 *
 * Deliberately not scrollable and not zoomable. It is a glance, propped up on
 * a counter, next to the list that carries the detail.
 */
import React from 'react'

export default function CookPlanTimeline({ plan, colorFor, nowMin = null, onPick }) {
  const total = Math.max(plan.total_minutes, 1)
  const pct = (min) => `${Math.max(0, Math.min(100, (min / total) * 100))}%`

  const lanes = (plan.recipes || []).map(r => ({
    ...r,
    steps: plan.steps.filter(s => s.recipe_id === r.id),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <style>{`
        .cpt-lane { position: relative; height: 30px; border-radius: 6px;
                    background: var(--md-surface-container-low); overflow: hidden; }
        .cpt-block { position: absolute; top: 3px; bottom: 3px; border-radius: 4px;
                     border: none; padding: 0; cursor: pointer; min-width: 3px; }
        /* Striped means the appliance is working and you are not. */
        .cpt-block.is-passive { opacity: 0.42;
          background-image: repeating-linear-gradient(
            45deg, transparent, transparent 3px,
            rgba(0,0,0,0.28) 3px, rgba(0,0,0,0.28) 6px); }
        .cpt-now { position: absolute; top: 0; bottom: 0; width: 2px;
                   background: var(--md-error); z-index: 3; pointer-events: none; }
        .cpt-course { position: absolute; top: 0; bottom: 0; width: 1px; z-index: 2;
                      background: var(--md-outline-variant); pointer-events: none; }
      `}</style>

      {lanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            title={lane.title}
            style={{
              width: 74, flexShrink: 0, fontSize: '0.66rem', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: colorFor[lane.id],
            }}
          >{lane.title}</span>

          <div className="cpt-lane" style={{ flex: 1 }}>
            {lane.steps.map(s => (
              <button
                key={s.key}
                className={`cpt-block ${s.passive_min > 0 ? 'is-passive' : ''}`}
                style={{
                  left: pct(s.start_min),
                  width: pct(Math.max(s.end_min - s.start_min, 1)),
                  background: colorFor[lane.id],
                }}
                title={`${s.text} · ${s.end_min - s.start_min}m`}
                aria-label={`${lane.title}: ${s.text}`}
                onClick={() => onPick?.(s)}
              />
            ))}
            {/* Where a later course lands, so a staggered meal reads as one. */}
            {lane.course_offset_min > 0 && (
              <span className="cpt-course" style={{ left: pct(plan.first_course_minutes) }} />
            )}
            {nowMin !== null && nowMin >= 0 && nowMin <= total && (
              <span className="cpt-now" style={{ left: pct(nowMin) }} />
            )}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 14, marginTop: 2, paddingLeft: 82, flexWrap: 'wrap' }}>
        <span className="rs-card-meta" style={{ fontSize: '0.66rem', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 8, borderRadius: 2, background: 'var(--md-on-surface)', opacity: 0.8 }} />
          you
        </span>
        <span className="rs-card-meta" style={{ fontSize: '0.66rem', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 14, height: 8, borderRadius: 2, background: 'var(--md-on-surface)', opacity: 0.42,
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.28) 3px, rgba(0,0,0,0.28) 6px)',
          }} />
          unattended
        </span>
      </div>
    </div>
  )
}
