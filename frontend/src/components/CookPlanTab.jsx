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
import CookPlanTimeline from './CookPlanTimeline.jsx'
import StepTimer from './StepTimer.jsx'

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

// What to set a step's timer to. The unattended stretch when there is one --
// that is the bit you walk away from and need calling back for. Otherwise the
// hands-on minutes, which is the "3-5 minutes per side" case.
const timerSeconds = (s) => (s.passive_min > 0 ? s.passive_min : s.active_min) * 60
const stationIcon = s => STATION_ICONS[s] || 'restaurant'

// A colour per recipe so an interleaved list still reads as several dishes.
const RECIPE_COLORS = ['#7dd3fc', '#fca5a5', '#c4b5fd', '#fcd34d', '#86efac', '#f9a8d4']

export default function CookPlanTab({ api, activePrep, refreshNonce }) {
  const [plan, setPlan]       = useState(null)
  const [cook, setCook]       = useState(null)   // the frozen, in-progress one
  const [view, setView]       = useState('prep')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)
  const [serveTime, setServeTime] = useState('')   // "HH:MM", local
  const [courses, setCourses] = useState({})       // recipe_id -> minutes after
  const [tick, setTick] = useState(0)              // re-render so NOW advances

  // A minute is the resolution the whole plan is in; anything finer would
  // redraw for nothing.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  // Generation counter in a ref, because the guard has to survive the call it
  // is guarding. The merged version declared `let current = true` inside load
  // and returned a cleanup that set it false -- but an async function's return
  // value is a promise nobody awaits, so nothing ever ran it and every check
  // against it was dead. A stale response could still overwrite a fresh one.
  const runRef = React.useRef(0)

  const load = useCallback(async () => {
    const run = ++runRef.current
    const stale = () => run !== runRef.current
    setLoading(true)
    try {
      const active = await api.get('/meal-cook').catch(() => ({ cook: null }))
      if (stale()) return
      if (active?.cook) {
        // A started meal shows the plan it was started with, never a fresh
        // one — the whole point of freezing it.
        setCook(active.cook)
        setPlan(active.cook.plan)
        if (active.cook.serve_at) {
          const d = new Date(active.cook.serve_at)
          setServeTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
        }
      } else {
        setCook(null)
        const q = Object.entries(courses)
          .filter(([, m]) => m > 0).map(([id, m]) => `${id}:${m}`).join(',')
        const plan = activePrep
          ? await api.get(`/prep/${activePrep.id}/cook-plan${q ? `?courses=${encodeURIComponent(q)}` : ''}`)
          : null
        if (stale()) return
        setPlan(plan)

      }
      if (stale()) return
      setError(null)
    } catch (err) {
      if (stale()) return
      setError(err.message)
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [api, activePrep, courses])

  useEffect(() => { load() }, [load, refreshNonce])

  const done = useMemo(() => new Set(cook?.done || []), [cook])

  const timersFor = useMemo(() => {
    const map = {}
    ;(cook?.timers || []).forEach(t => { (map[t.step_key] = map[t.step_key] || []).push(t) })
    return map
  }, [cook])

  // Re-read the cook rather than patching a timer in place: a second phone
  // may have paused it, and the timers are the one thing two people in a
  // kitchen touch at the same moment.
  const reloadTimers = useCallback(async () => {
    try {
      const active = await api.get('/meal-cook')
      if (active?.cook) setCook(active.cook)
    } catch { /* the countdown on screen is still right */ }
  }, [api])

  const startTimer = async (step, seconds) => {
    setBusy(true)
    try {
      await api.post(`/meal-cook/${cook.id}/timers`, {
        step_key: step.key,
        seconds,
        label: step.recipe_title,
      })
      await reloadTimers()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const colorFor = useMemo(() => {
    const map = {}
    ;(plan?.recipes || []).forEach((r, i) => { map[r.id] = RECIPE_COLORS[i % RECIPE_COLORS.length] })
    return map
  }, [plan])

  // The serve instant, from whichever source has one: a started cook carries
  // it, and before that the picker does. Reading only the saved cook left the
  // preview showing T-minus after you had already said when you wanted to eat.
  const serveDate = useMemo(() => {
    if (cook?.serve_at) return new Date(cook.serve_at)
    if (!serveTime) return null
    const [h, m] = serveTime.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    if (at.getTime() < Date.now() - 60_000) at.setDate(at.getDate() + 1)
    return at
  }, [cook, serveTime])

  // EAT AT is when you sit down, which is the *first* course. For a staggered
  // meal the end of the plan is a later thing entirely, so anchoring on the
  // end would quietly move dinner by however long the last course trails.
  // One anchor, and every other time is derived from it.
  const planStart = useMemo(() => {
    if (!serveDate) return null
    const firstCourse = plan?.first_course_minutes ?? plan?.total_minutes ?? 0
    return new Date(serveDate.getTime() - firstCourse * 60000)
  }, [serveDate, plan])

  // T-minus, or a clock time once the cook has said when they want to eat.
  const timeLabel = useCallback((offsetMin) => {
    if (planStart) {
      return new Date(planStart.getTime() + offsetMin * 60000)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    const left = (plan?.first_course_minutes ?? plan?.total_minutes ?? 0) - offsetMin
    return left <= 0 ? 'serve' : `T-${left}m`
  }, [plan, planStart])

  const toggle = async (key) => {
    if (!cook) return
    setBusy(true)
    try {
      const res = await api.post(`/meal-cook/${cook.id}/step`, { key, done: !done.has(key) })
      setCook({ ...cook, done: res.done })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  // "18:30" -> an ISO instant. Tomorrow if that time has already gone today,
  // because someone setting 00:30 at eleven at night means tonight's dinner,
  // not one that was due twenty-two hours ago.
  const isoForTime = (hhmm) => {
    if (!hhmm) return null
    const [h, m] = hhmm.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    if (at.getTime() < Date.now() - 60_000) at.setDate(at.getDate() + 1)
    return at.toISOString()
  }

  const start = async () => {
    setBusy(true)
    try {
      const started = await api.post('/meal-cook', {
        prep_session_id: activePrep?.id,
        serve_at: isoForTime(serveTime),
        courses,
      })
      setCook(started)
      setPlan(started.plan)
      setView('prep')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const reschedule = async (hhmm) => {
    setServeTime(hhmm)
    if (!cook) return
    setBusy(true)
    try {
      setCook(await api.patch(`/meal-cook/${cook.id}`, { serve_at: isoForTime(hhmm) }))
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
            {s.by_eye && ' · judge by eye'}
          </div>
          {(timersFor[s.key] || []).map(t => (
            <StepTimer key={t.id} timer={t} api={api} onChanged={reloadTimers} />
          ))}
        </div>

        {/* An offer, not an alarm that starts itself. Steps judged by eye get
            the same button and a quieter one: the minutes are a nudge to go
            and look, not the moment the food is ready. */}
        {cook && !isDone && timerSeconds(s) > 0 && !(timersFor[s.key] || []).length && (
          <button
            className="rs-pill"
            style={{ padding: 6, minWidth: 0, background: 'transparent', flexShrink: 0,
                     opacity: s.by_eye ? 0.55 : 1 }}
            aria-label={`Start a ${Math.round(timerSeconds(s) / 60)} minute timer for ${s.text.slice(0, 40)}`}
            title={s.by_eye ? 'Timer as a guide — this step is judged by eye'
                            : `Start a ${Math.round(timerSeconds(s) / 60)} minute timer`}
            disabled={busy}
            onClick={() => startTimer(s, timerSeconds(s))}
          >
            <span className="material-symbols-rounded">timer</span>
          </button>
        )}
      </div>
    )
  }

  // How far into the plan the clock is. Only meaningful once a serve time
  // exists to measure against; before that "now" is wherever you decide to
  // start, which is the honest answer rather than a guess.
  const nowMin = planStart
    ? Math.round((Date.now() - planStart.getTime()) / 60000)
    : null

  // The one thing a phone propped against the kettle should answer.
  const nextStep = cook
    ? plan.steps.filter(s => !done.has(s.key))
        .sort((a, b) => a.start_min - b.start_min)[0]
    : null
  const nextDue = nextStep && nowMin !== null ? nextStep.start_min - nowMin : null

  // When you would have to begin, and whether that has already gone past.
  const startByLabel = planStart
    ? planStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'now'
  // Not enough runway: the plan would have had to begin before now.
  const tooLate = nowMin !== null && nowMin > 0 ? nowMin : null

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

          {/* Without a serve time every row reads T-45m, which is only useful
              if you are already cooking. With one they become clock times,
              which is what you can actually act on. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="rs-card-label">EAT AT</span>
            <input
              type="time"
              className="rs-pill"
              aria-label="Serve time"
              style={{ background: 'var(--md-surface-container-low)', border: 'none' }}
              value={serveTime}
              onChange={e => reschedule(e.target.value)}
            />
            {serveTime
              ? <span className="rs-card-meta" style={{ fontSize: '0.75rem' }}>start by {startByLabel}</span>
              : <span className="rs-card-meta" style={{ fontSize: '0.75rem' }}>set one and the steps become clock times</span>}
          </div>

          {tooLate !== null && (
            <div className="rs-card-meta" style={{ color: 'var(--rs-status-warning)', fontSize: '0.8rem' }}>
              You would have needed to start {tooLate} min ago. Push the time back,
              or carry on and expect to serve about {tooLate} min late.
            </div>
          )}

          {/* The picture. A sorted list cannot show that the chicken is in
              the oven while you peel the potatoes, and that overlap is the
              entire output of the scheduler. */}
          <CookPlanTimeline
            plan={plan}
            colorFor={colorFor}
            nowMin={cook ? nowMin : null}
            onPick={(s) => setView(s.phase === 'prep' ? 'prep' : 'cook')}
          />

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

      {/* What to do now. On a phone propped against the kettle this is the
          only thing that matters, so it is the only thing that is big. */}
      {cook && nextStep && (
        <div className="rs-card is-elev" style={{ borderColor: colorFor[nextStep.recipe_id] }}>
          <div className="rs-card-inner" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <button
              className="rs-pill"
              aria-label={`Mark done: ${nextStep.text}`}
              style={{ padding: 6, minWidth: 0, background: 'transparent', flexShrink: 0 }}
              disabled={busy}
              onClick={() => toggle(nextStep.key)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '2rem' }}>radio_button_unchecked</span>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>
                {nextDue === null ? 'NEXT'
                  : nextDue > 1 ? `IN ${nextDue} MIN`
                  : nextDue < -1 ? `${-nextDue} MIN LATE`
                  : 'NOW'}
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.35, marginTop: 4 }}>
                {nextStep.text}
              </div>
              <div className="rs-card-label" style={{ fontSize: '0.65rem', marginTop: 6, opacity: 0.8 }}>
                {nextStep.recipe_title}
                {nextStep.station !== 'counter' && ` · ${stationLabel(nextStep.station)}`}
                {nextStep.passive_min > 0 && ` · then ${nextStep.passive_min}m unattended`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Courses. Before starting only: the plan is frozen once you begin, and
          re-staggering a meal you are halfway through would move steps you
          have already done. */}
      {!cook && plan.recipes.length > 1 && (
        <div className="rs-card">
          <div className="rs-card-inner">
            <div className="rs-card-label" style={{ marginBottom: 4 }}>COURSES</div>
            <p className="rs-card-meta" style={{ marginTop: 0 }}>
              Everything lands together unless you say otherwise. Stagger a dish and
              it still shares the oven and your hands — that is why it stays one plan.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {plan.recipes.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    flex: '1 1 130px', minWidth: 0, fontSize: '0.85rem', fontWeight: 600,
                    borderLeft: `3px solid ${colorFor[r.id]}`, paddingLeft: 8,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.title}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0, 15, 30, 60].map(m => (
                      <button
                        key={m}
                        className={`rs-pill ${(courses[r.id] || 0) === m ? 'is-active' : ''}`}
                        style={{ fontSize: '0.68rem', padding: '4px 10px' }}
                        onClick={() => setCourses(c => ({ ...c, [r.id]: m }))}
                      >{m === 0 ? 'WITH' : `+${m}m`}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
