/**
 * CookPlanTab — cooking the staged recipes as one meal.
 *
 * The staging area says what is going in the pot. This says when, in what
 * order, and on which appliance, for all of the recipes at once.
 *
 * PREP / KIT / COOK are three views of a single timeline rather than three
 * calculations. That matters: built separately they could disagree — the prep
 * list implying one start time and the cook order another — and a cook has no
 * way to tell which one lied. Everything here is a filter over `plan.steps`.
 *
 * Times are shown as T-minus by default. The plan is a set of offsets, so a
 * cook who starts twenty minutes late slides the whole thing with them
 * instead of being told they are behind on every row at once. A serve time,
 * when one is set, turns those offsets into clock times.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'

const STATION_LABELS = {
  counter: 'Counter', stove: 'Stove', oven: 'Oven', microwave: 'Microwave',
  air_fryer: 'Air fryer', instant_pot: 'Instant Pot', slow_cooker: 'Slow cooker',
  dutch_oven: 'Dutch oven', sous_vide: 'Sous vide', stand_mixer: 'Stand mixer',
  wok: 'Wok', grill: 'Grill',
}

const STATION_ICONS = {
  counter: 'countertops', stove: 'local_fire_department', oven: 'oven_gen',
  microwave: 'microwave', air_fryer: 'mode_fan', instant_pot: 'soup_kitchen',
  slow_cooker: 'soup_kitchen', dutch_oven: 'skillet', sous_vide: 'water_full',
  stand_mixer: 'blender', wok: 'skillet', grill: 'outdoor_grill',
}

const stationLabel = s => STATION_LABELS[s] || s
const stationIcon = s => STATION_ICONS[s] || 'restaurant'

// A colour per recipe so an interleaved list still reads as several dishes.
const RECIPE_COLORS = ['#7dd3fc', '#fca5a5', '#c4b5fd', '#fcd34d', '#86efac', '#f9a8d4']

export default function CookPlanTab({ api, activePrep }) {
  const [plan, setPlan]       = useState(null)
  const [cook, setCook]       = useState(null)   // the frozen, in-progress one
  const [view, setView]       = useState('prep')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const active = await api.get('/meal-cook').catch(() => ({ cook: null }))
      if (active?.cook) {
        // A started meal shows the plan it was started with, never a fresh
        // one — the whole point of freezing it.
        setCook(active.cook)
        setPlan(active.cook.plan)
      } else {
        setCook(null)
        setPlan(activePrep ? await api.get(`/prep/${activePrep.id}/cook-plan`) : null)
      }
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api, activePrep])

  useEffect(() => { load() }, [load])

  const done = useMemo(() => new Set(cook?.done || []), [cook])

  const colorFor = useMemo(() => {
    const map = {}
    ;(plan?.recipes || []).forEach((r, i) => { map[r.id] = RECIPE_COLORS[i % RECIPE_COLORS.length] })
    return map
  }, [plan])

  // T-minus, or a clock time when the cook has committed to one.
  const timeLabel = useCallback((offsetMin) => {
    const total = plan?.total_minutes || 0
    if (cook?.serve_at) {
      const serve = new Date(cook.serve_at)
      const at = new Date(serve.getTime() - (total - offsetMin) * 60000)
      return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    const left = total - offsetMin
    return left <= 0 ? 'serve' : `T-${left}m`
  }, [plan, cook])

  const toggle = async (key) => {
    if (!cook) return
    setBusy(true)
    try {
      const res = await api.post(`/meal-cook/${cook.id}/step`, { key, done: !done.has(key) })
      setCook({ ...cook, done: res.done })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const start = async () => {
    setBusy(true)
    try {
      const started = await api.post('/meal-cook', { prep_session_id: activePrep?.id })
      setCook(started)
      setPlan(started.plan)
      setView('cook')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const end = async () => {
    setBusy(true)
    try {
      await api.post(`/meal-cook/${cook.id}/end`, {})
      await load()
      setView('prep')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  if (loading) {
    return <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center' }}>BUILDING THE PLAN…</div>
  }

  if (!plan || !plan.steps?.length) {
    return (
      <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
        Nothing to plan yet. Stage some recipes in PREP and this works out when to
        start each one so they finish together.
      </div>
    )
  }

  const step = (s) => {
    const isDone = done.has(s.key)
    return (
      <div
        key={s.key}
        className="rs-pill"
        style={{
          justifyContent: 'flex-start', gap: 12, padding: '12px 14px',
          alignItems: 'flex-start', textAlign: 'left',
          background: 'var(--md-surface-container-low)',
          borderLeft: `3px solid ${colorFor[s.recipe_id] || 'var(--md-outline-variant)'}`,
          opacity: isDone ? 0.45 : 1,
        }}
      >
        {cook && (
          <button
            className="rs-pill"
            aria-label={isDone ? `Undo ${s.text}` : `Mark done: ${s.text}`}
            aria-pressed={isDone}
            style={{ padding: 4, minWidth: 0, background: 'transparent', flexShrink: 0 }}
            disabled={busy}
            onClick={() => toggle(s.key)}
          >
            <span className="material-symbols-rounded" style={{ color: isDone ? 'var(--primary)' : 'inherit' }}>
              {isDone ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </button>
        )}

        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 800, minWidth: 56,
          color: 'var(--primary)', flexShrink: 0, fontSize: '0.8rem', paddingTop: 2,
        }}>{timeLabel(s.start_min)}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ textDecoration: isDone ? 'line-through' : 'none' }}>{s.text}</div>
          <div className="rs-card-label" style={{ fontSize: '0.6rem', marginTop: 4, opacity: 0.75 }}>
            {s.recipe_title}
            {s.station !== 'counter' && ` · ${stationLabel(s.station)}`}
            {s.passive_min > 0 && ` · ${s.passive_min}m unattended`}
          </div>
        </div>
      </div>
    )
  }

  const prepSteps = plan.steps.filter(s => s.phase === 'prep')
  // Prep is the mise en place plus the knife work, so the count has to be
  // both or the tab promises less than the screen holds.
  const prepCount = prepSteps.length +
    (plan.recipes || []).reduce((n, r) => n + (r.ingredients?.length || 0), 0)
  const cookSteps = plan.steps.filter(s => s.phase !== 'prep')

  // What each appliance is doing, and when. Answers "what do I need out"
  // before you start, which is a different question from the step list.
  const byStation = {}
  plan.steps.filter(s => s.station !== 'counter').forEach(s => {
    ;(byStation[s.station] = byStation[s.station] || []).push(s)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 780, margin: '0 auto', width: '100%' }}>
      <div className="rs-card">
        <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="rs-card-head">
            <div>
              <div className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>
                {cook ? 'COOKING NOW' : 'THE PLAN'}
              </div>
              <div className="rs-card-value" style={{ fontSize: '1.4rem' }}>
                {plan.total_minutes} min · {plan.recipes.length} dish{plan.recipes.length === 1 ? '' : 'es'}
              </div>
            </div>
            {cook ? (
              <button className="rs-pill" onClick={end} disabled={busy}>
                <span className="material-symbols-rounded">stop_circle</span> FINISH
              </button>
            ) : (
              <button className="rs-btn-primary" onClick={start} disabled={busy}>
                <span className="material-symbols-rounded">play_arrow</span> START
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {plan.recipes.map(r => (
              <span key={r.id} className="rs-pill" style={{ fontSize: '0.7rem', borderLeft: `3px solid ${colorFor[r.id]}` }}>
                {r.title}
              </span>
            ))}
          </div>

          {/* Conflicts are reported rather than resolved: which dish moves
              depends on what tolerates sitting, and the recipe never says. */}
          {plan.conflicts?.length > 0 && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)',
            }}>
              <div className="rs-card-label" style={{ marginBottom: 6 }}>YOU WILL HAVE TO JUGGLE</div>
              {plan.conflicts.map((c, i) => (
                <div key={i} className="rs-card-meta" style={{ fontSize: '0.78rem' }}>
                  <strong>{timeLabel(c.start_min)}</strong> — {c.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { id: 'prep', icon: 'cut', label: `PREP (${prepCount})` },
          { id: 'kit',  icon: 'kitchen', label: `KIT (${Object.keys(byStation).length})` },
          { id: 'cook', icon: 'skillet', label: `COOK (${cookSteps.length})` },
        ].map(v => (
          <button
            key={v.id}
            className={`rs-pill ${view === v.id ? 'is-active' : ''}`}
            onClick={() => setView(v.id)}
          >
            <span className="material-symbols-rounded">{v.icon}</span>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'prep' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="rs-card-meta">
            Everything before the heat goes on. Get it all out and measured first
            and the cook phase is just heat and timing.
          </p>

          {/* Mise en place. Most of prep is portioning, and none of it appears
              in the steps -- a recipe says "add the paprika", never "get the
              paprika out". One card per dish, because that is how the bowls
              end up on the counter. */}
          {plan.recipes.filter(r => r.ingredients?.length).map(r => (
            <div key={r.id} className="rs-card">
              <div className="rs-card-inner">
                <div className="rs-card-head" style={{ marginBottom: 10 }}>
                  <span className="rs-card-label" style={{ fontWeight: 900, borderLeft: `3px solid ${colorFor[r.id]}`, paddingLeft: 8 }}>
                    MEASURE OUT · {r.title.toUpperCase()}
                  </span>
                  <span className="rs-card-label" style={{ fontSize: '0.65rem' }}>
                    {r.ingredients.filter(i => done.has(i.key)).length}/{r.ingredients.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {r.ingredients.map(ing => {
                    const isDone = done.has(ing.key)
                    return (
                      <div key={ing.key} className="rs-pill" style={{
                        justifyContent: 'flex-start', gap: 10, padding: '8px 12px',
                        background: 'var(--md-surface-container-low)',
                        opacity: isDone ? 0.45 : 1,
                      }}>
                        {cook && (
                          <button
                            className="rs-pill"
                            aria-label={isDone ? `Undo ${ing.name}` : `Measured out ${ing.name}`}
                            aria-pressed={isDone}
                            style={{ padding: 2, minWidth: 0, background: 'transparent' }}
                            disabled={busy}
                            onClick={() => toggle(ing.key)}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: isDone ? 'var(--primary)' : 'inherit' }}>
                              {isDone ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>
                        )}
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, minWidth: 68, color: 'var(--primary)', fontSize: '0.8rem' }}>
                          {[ing.qty, ing.unit].filter(Boolean).join(' ') || '—'}
                        </span>
                        <span style={{ flex: 1, textDecoration: isDone ? 'line-through' : 'none' }}>{ing.name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}

          {prepSteps.length > 0 && (
            <>
              <div className="rs-card-label" style={{ marginTop: 4 }}>THEN, IN THIS ORDER</div>
              {prepSteps.map(step)}
            </>
          )}
        </div>
      )}

      {view === 'kit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="rs-card-meta">What to get out, and what each one is busy with.</p>
          {Object.entries(byStation).map(([st, steps]) => (
            <div key={st} className="rs-card">
              <div className="rs-card-inner">
                <div className="rs-card-head" style={{ marginBottom: 8 }}>
                  <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 6 }}>
                      {stationIcon(st)}
                    </span>
                    {stationLabel(st).toUpperCase()}
                  </span>
                  <span className="rs-card-label" style={{ fontSize: '0.65rem' }}>
                    {steps.length} step{steps.length === 1 ? '' : 's'}
                  </span>
                </div>
                {steps.map(s => (
                  <div key={s.key} className="rs-card-meta" style={{ fontSize: '0.78rem', display: 'flex', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)', minWidth: 56 }}>
                      {timeLabel(s.start_min)}
                    </span>
                    <span style={{ flex: 1 }}>{s.recipe_title}</span>
                    <span style={{ opacity: 0.6 }}>{s.end_min - s.start_min}m</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'cook' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="rs-card-meta">
            All the dishes on one clock, so the gaps while something bakes are
            already filled with the next thing.
          </p>
          {cookSteps.map(step)}
        </div>
      )}
    </div>
  )
}
