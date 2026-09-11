/**
 * CookPlanTab — Autonomous Cooking Guide & Execution Engine.
 *
 * A complete start-to-finish kitchen companion:
 * 1. Idle launcher: pick tonight's planned dinner or any cookbook recipe with one tap.
 * 2. Phase 1 (Mise en Place): gather provisions, check off measured ingredients, set up stations & appliances.
 * 3. Phase 2 (Guided Cook): high-contrast, large-type step guide with active timers, big tablet buttons, and timeline sync.
 * 4. Phase 3 (Plating & Finish): resting guidelines, one-tap meal plan marking, and stockroom depletion.
 */
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import CookPlanTimeline from './CookPlanTimeline.jsx'
import StepTimer from './StepTimer.jsx'
import AppliancePanel from './AppliancePanel.jsx'

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
const timerSeconds = (s) => (s.passive_min > 0 ? s.passive_min : s.active_min) * 60
const RECIPE_COLORS = ['#38bdf8', '#f87171', '#a78bfa', '#fbbf24', '#4ade80', '#f472b6']

export default function CookPlanTab({
  api,
  activePrep,
  refreshNonce,
  recipes = [],
  mealPlan = [],
  equipment = [],
  onRefreshPrep,
  setActiveTab,
}) {
  const [plan, setPlan]             = useState(null)
  const [cook, setCook]             = useState(null)
  const [guidePhase, setGuidePhase] = useState('prep') // 'prep' | 'cook' | 'done'
  const [viewMode, setViewMode]     = useState('focus') // 'focus' | 'timeline'
  const [activeStepIdx, setActiveStepIdx] = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [busy, setBusy]             = useState(false)
  const [serveTime, setServeTime]   = useState('')
  const [courses, setCourses]       = useState({})
  const [swapping, setSwapping]     = useState(null)
  const [swapError, setSwapError]   = useState(null)
  const [tick, setTick]             = useState(0)
  const [showAppliances, setShowAppliances] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [completionNotice, setCompletionNotice] = useState(null)
  const [internalEquipment, setInternalEquipment] = useState([])
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(null)

  useEffect(() => {
    if (equipment && equipment.length > 0) return
    let active = true
    api.get('/household/equipment')
      .then(data => { if (active && Array.isArray(data)) setInternalEquipment(data) })
      .catch(() => {})
    return () => { active = false }
  }, [api, equipment])

  const allEquipment = equipment?.length > 0 ? equipment : internalEquipment
  const availableEquipment = (plan?.appliances?.length ? plan.appliances : allEquipment) || []
  const activeEquipmentId = selectedEquipmentId || availableEquipment[0]?.id

  // Minute clock tick
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const runRef = useRef(0)

  const load = useCallback(async () => {
    const run = ++runRef.current
    const stale = () => run !== runRef.current
    setLoading(true)
    try {
      const active = await api.get('/meal-cook').catch(() => ({ cook: null }))
      if (stale()) return

      if (active?.cook) {
        setCook(active.cook)
        setPlan(active.cook.plan)
        if (active.cook.serve_at) {
          const d = new Date(active.cook.serve_at)
          setServeTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
        }
        setGuidePhase('cook')
      } else {
        setCook(null)
        const q = Object.entries(courses)
          .filter(([, m]) => m > 0).map(([id, m]) => `${id}:${m}`).join(',')
        const planRes = activePrep
          ? await api.get(`/prep/${activePrep.id}/cook-plan${q ? `?courses=${encodeURIComponent(q)}` : ''}`).catch(() => null)
          : null
        if (stale()) return
        setPlan(planRes)
        setGuidePhase('prep')
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

  const reloadTimers = useCallback(async () => {
    try {
      const active = await api.get('/meal-cook')
      if (active?.cook) setCook(active.cook)
    } catch {}
  }, [api])

  const startTimer = async (step, seconds) => {
    if (!cook) return
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

  const serveDate = useMemo(() => {
    if (cook?.serve_at) return new Date(cook.serve_at)
    if (!serveTime) return null
    const [h, m] = serveTime.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    if (at.getTime() < Date.now() - 60_000) at.setDate(at.getDate() + 1)
    return at
  }, [cook, serveTime])

  const planStart = useMemo(() => {
    if (!serveDate) return null
    const firstCourse = plan?.first_course_minutes ?? plan?.total_minutes ?? 0
    return new Date(serveDate.getTime() - firstCourse * 60000)
  }, [serveDate, plan])

  const timeLabel = useCallback((offsetMin) => {
    if (planStart) {
      return new Date(planStart.getTime() + offsetMin * 60000)
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    const left = (plan?.first_course_minutes ?? plan?.total_minutes ?? 0) - offsetMin
    return left <= 0 ? 'Ready' : `T-${left}m`
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

  const isoForTime = (hhmm) => {
    if (!hhmm) return null
    const [h, m] = hhmm.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    if (at.getTime() < Date.now() - 60_000) at.setDate(at.getDate() + 1)
    return at.toISOString()
  }

  const swapAppliance = async (recipeId, choice) => {
    if (!activePrep) return
    setSwapping(recipeId)
    setSwapError(null)
    const [head, tail] = String(choice || '').split(':')
    const station = tail || head || null
    const equipment_id = tail ? head : null
    try {
      await api.post(`/prep/${activePrep.id}/appliance-swap`, { recipe_id: recipeId, station, equipment_id })
      await load()
    } catch (err) {
      setSwapError({ recipeId, message: err.message })
    } finally { setSwapping(null) }
  }

  const startMealCook = async () => {
    setBusy(true)
    try {
      const started = await api.post('/meal-cook', {
        prep_session_id: activePrep?.id,
        serve_at: isoForTime(serveTime),
        courses,
      })
      setCook(started)
      setPlan(started.plan)
      setGuidePhase('cook')
      setActiveStepIdx(0)
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

  const endMealCook = async () => {
    if (!cook) return
    setBusy(true)
    try {
      await api.post(`/meal-cook/${cook.id}/end`, {})
      await load()
      setGuidePhase('prep')
      onRefreshPrep?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  // Quick Start Handlers from Launcher
  const handleCookSingleRecipe = async (recipe) => {
    setBusy(true)
    setError(null)
    try {
      let session = activePrep
      if (!session) {
        session = await api.post('/prep', { label: `Cook: ${recipe.title}` })
      }
      await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipe.id, servings: recipe.servings || 4 })
      onRefreshPrep?.()
      const planRes = await api.get(`/prep/${session.id}/cook-plan`)
      setPlan(planRes)
      setGuidePhase('prep')
    } catch (err) {
      setError('Could not start recipe cook: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleCookDinnerPlan = async (entry) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post('/meal-plan/create-prep-session', { entry_ids: [entry.id] })
      if (res.status === 'ok') {
        const session = await api.get('/prep')
        onRefreshPrep?.()
        const planRes = await api.get(`/prep/${session.id}/cook-plan`)
        setPlan(planRes)
        setGuidePhase('prep')
      }
    } catch (err) {
      setError('Could not start dinner cook: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  // Post-Cook Plating Actions
  const handleMarkDinnerCooked = async () => {
    const todayStr = new Date().toISOString().split('T')[0]
    const todayEntry = (mealPlan || []).find(m => m.plan_date.startsWith(todayStr))
    if (!todayEntry) {
      setCompletionNotice('No scheduled dinner found for today to mark cooked.')
      return
    }
    try {
      await api.patch(`/meal-plan/${todayEntry.id}`, { status: 'cooked' })
      setCompletionNotice(`Marked "${todayEntry.recipe_title || 'Dinner'}" as cooked!`)
    } catch (err) {
      setError('Failed to mark meal as cooked: ' + err.message)
    }
  }

  // Cooking Steps Filtering
  const prepSteps = useMemo(() => (plan?.steps || []).filter(s => s.phase === 'prep'), [plan])
  const cookSteps = useMemo(() => (plan?.steps || []).filter(s => s.phase !== 'prep'), [plan])
  const allSteps = useMemo(() => plan?.steps || [], [plan])

  // Active step in focus mode
  const currentStep = cookSteps.length > 0 ? (cookSteps[activeStepIdx] || cookSteps[0]) : null
  const isCurrentDone = currentStep ? done.has(currentStep.key) : false
  const nextStep = cookSteps.length > 0 ? (cookSteps[activeStepIdx + 1] || null) : null

  const handleNextStep = async () => {
    if (currentStep && !isCurrentDone) {
      await toggle(currentStep.key)
    }
    if (cookSteps.length > 0 && activeStepIdx < cookSteps.length - 1) {
      setActiveStepIdx(idx => idx + 1)
    } else {
      setGuidePhase('done')
    }
  }

  const handlePrevStep = () => {
    if (activeStepIdx > 0) {
      setActiveStepIdx(idx => idx - 1)
    }
  }

  // ---------------------------------------------------------------------------
  // 1. LOADING STATE
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--rs-fs-h3)', fontWeight: 600, color: 'var(--primary)', marginBottom: 8 }}>
          PREPARING YOUR COOK GUIDE…
        </div>
        <div style={{ opacity: 0.7 }}>Synchronizing appliance stations and step timelines</div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // 2. IDLE LAUNCHER (When no meal is active or staged)
  // ---------------------------------------------------------------------------
  if (!plan || !plan.steps?.length) {
    const todayStr = new Date().toISOString().split('T')[0]
    const todayDinner = (mealPlan || []).find(m => m.plan_date.startsWith(todayStr) && m.recipe_id)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 840, margin: '0 auto', width: '100%' }}>
        {/* Launcher Banner */}
        <div className="gh-card gh-glance-bar" style={{ padding: '24px 28px', flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="rs-flex rs-items-center rs-justify-between rs-gap-4">
            <div className="rs-flex rs-items-center rs-gap-4">
              <div className="gh-glance-orb-wrap" style={{ width: 48, height: 48 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 26, color: 'var(--md-primary)' }}>skillet</span>
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--fg)' }}>Start Cooking Guide</h2>
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', marginTop: 2 }}>
                  From prep checklist to synchronized hot plating
                </div>
              </div>
            </div>
            <button
              className="gh-glance-action"
              onClick={() => setShowAppliances(!showAppliances)}
            >
              <span className="material-symbols-rounded">kitchen</span>
              <span>{showAppliances ? 'Hide Appliances' : 'Kitchen Gear'}</span>
            </button>
          </div>

          {showAppliances && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              {availableEquipment.length === 0 ? (
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', padding: 12 }}>
                  No kitchen equipment registered. Add your appliances in settings.
                </div>
              ) : (
                <div className="rs-flex rs-flex-col rs-gap-3">
                  {availableEquipment.length > 1 && (
                    <div className="rs-flex rs-gap-2 rs-flex-wrap">
                      {availableEquipment.map(eq => (
                        <button
                          key={eq.id}
                          type="button"
                          className={`gh-kitchen-nav-btn ${activeEquipmentId === eq.id ? 'is-active' : ''}`}
                          style={{ padding: '6px 14px', fontSize: 'var(--rs-fs-tiny)' }}
                          onClick={() => setSelectedEquipmentId(eq.id)}
                        >
                          <span>{eq.label || eq.make || 'Appliance'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <AppliancePanel
                    api={api}
                    equipmentId={activeEquipmentId}
                    onClose={() => setShowAppliances(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="rs-card" style={{ borderColor: 'var(--md-error)', background: 'rgba(239, 68, 68, 0.08)' }}>
            <div className="rs-card-inner" style={{ color: 'var(--md-error)' }}>{error}</div>
          </div>
        )}

        {/* Option 1: Tonight's Dinner */}
        {todayDinner && (
          <div className="gh-card" style={{ border: '1px solid rgba(0, 229, 255, 0.35)', background: 'rgba(0, 229, 255, 0.06)' }}>
            <div className="rs-flex rs-items-center rs-justify-between rs-gap-4 rs-flex-wrap">
              <div>
                <div className="gh-sensor-pill" style={{ color: 'var(--md-primary)', background: 'rgba(0, 229, 255, 0.15)', borderColor: 'rgba(0, 229, 255, 0.3)', marginBottom: 8 }}>
                  TONIGHT'S PLANNED DINNER
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fg)' }}>
                  {todayDinner.recipe_title || todayDinner.label || 'Dinner'}
                </div>
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', marginTop: 4 }}>
                  Scheduled for today in your weekly meal plan
                </div>
              </div>
              <button
                className="gh-cook-btn-next"
                style={{ flex: 'none', height: 48, padding: '0 24px' }}
                disabled={busy}
                onClick={() => handleCookDinnerPlan(todayDinner)}
              >
                <span className="material-symbols-rounded">play_arrow</span>
                <span>Cook Tonight's Dinner</span>
              </button>
            </div>
          </div>
        )}

        {/* Option 2: Choose from Cookbook */}
        <div className="gh-card">
          <div className="rs-flex rs-items-center rs-justify-between rs-gap-4 rs-mb-4 rs-flex-wrap">
            <div>
              <h3 style={{ margin: 0, fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>Choose from Cookbook</h3>
              <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)' }}>Select any recipe to start guided cooking immediately</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255, 255, 255, 0.06)', padding: '6px 14px', borderRadius: 999, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--text-muted)' }}>search</span>
              <input
                type="text"
                placeholder="Search recipe..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ all: 'unset', color: 'var(--fg)', fontSize: 'var(--rs-fs-tiny)', width: 140 }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {(recipes || [])
              .filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()))
              .slice(0, 6)
              .map(r => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 16,
                    borderRadius: 18,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 'var(--rs-fs-micro)', fontWeight: 800, color: 'var(--md-primary)', textTransform: 'uppercase' }}>
                      {r.meal_type || 'Recipe'} · {r.primary_protein || 'Provisions'}
                    </div>
                    <div style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)', marginTop: 4 }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--text-muted)', marginTop: 4 }}>
                      {r.servings || 4} servings · {r.steps?.length || 0} steps
                    </div>
                  </div>
                  <button
                    className="gh-glance-action rs-w-full rs-justify-center"
                   
                    disabled={busy}
                    onClick={() => handleCookSingleRecipe(r)}
                  >
                    <span className="material-symbols-rounded">skillet</span>
                    <span>Cook This</span>
                  </button>
                </div>
              ))}
          </div>

          {(recipes || []).length > 6 && (
            <div className="rs-text-center rs-mt-4">
              <button
                className="gh-kitchen-nav-btn"
                style={{ display: 'inline-flex' }}
                onClick={() => setActiveTab?.('cookbook')}
              >
                <span>View Full Recipe Archive ({recipes.length} recipes)</span>
                <span className="material-symbols-rounded">arrow_forward</span>
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // 3. ACTIVE COOK PLAN (The Start-to-Finish Guided Companion)
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 840, margin: '0 auto', width: '100%' }}>

      {/* Top Banner: Meal Metadata & Controls */}
      <div className="gh-card" style={{ padding: '20px 24px' }}>
        <div className="rs-flex rs-items-center rs-justify-between rs-flex-wrap rs-gap-4">
          <div>
            <div className="rs-flex rs-items-center rs-gap-3">
              <span className="gh-live-dot" />
              <span style={{ fontSize: 'var(--rs-fs-tiny)', fontWeight: 800, color: 'var(--md-primary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {cook ? 'ACTIVE COOKING SESSION' : 'COOK PLAN READY'}
              </span>
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--fg)', marginTop: 4 }}>
              {plan.recipes.map(r => r.title).join(' + ')}
            </div>
            <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', marginTop: 4 }}>
              {plan.total_minutes} minutes total · {plan.recipes.length} dish{plan.recipes.length === 1 ? '' : 'es'} · {cookSteps.length} cooking steps
            </div>
          </div>

          <div className="rs-flex rs-items-center rs-gap-3">
            {cook ? (
              <button
                className="gh-kitchen-nav-btn"
                style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#fca5a5' }}
                onClick={endMealCook}
                disabled={busy}
              >
                <span className="material-symbols-rounded">stop_circle</span>
                <span>End Cook</span>
              </button>
            ) : (
              <button
                className="gh-cook-btn-next"
                style={{ flex: 'none', height: 46, padding: '0 24px' }}
                onClick={startMealCook}
                disabled={busy}
              >
                <span className="material-symbols-rounded">play_arrow</span>
                <span>Start Live Cook</span>
              </button>
            )}
          </div>
        </div>

        {/* Eat At Time Picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255, 255, 255, 0.08)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--rs-fs-tiny)', fontWeight: 700, color: 'var(--text-muted)' }}>TARGET SERVE TIME:</span>
          <input
            type="time"
            className="rs-pill"
            style={{ background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#fff', padding: '4px 12px' }}
            value={serveTime}
            onChange={e => reschedule(e.target.value)}
          />
          {serveTime ? (
            <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--md-primary)' }}>
              Start by {planStart ? planStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'} to eat on time
            </span>
          ) : (
            <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)' }}>
              Set a serve time to convert countdowns into real clock times
            </span>
          )}
        </div>
      </div>

      {/* 3-Phase Stepper */}
      <div className="gh-cook-flow-stepper">
        <button
          className={`gh-cook-flow-step ${guidePhase === 'prep' ? 'is-active' : ''}`}
          onClick={() => setGuidePhase('prep')}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>cut</span>
          <span>1. Mise en Place ({prepSteps.length + (plan.recipes || []).reduce((n, r) => n + (r.ingredients?.length || 0), 0)})</span>
        </button>
        <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>──</span>
        <button
          className={`gh-cook-flow-step ${guidePhase === 'cook' ? 'is-active' : ''}`}
          onClick={() => setGuidePhase('cook')}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>skillet</span>
          <span>2. Guided Cook ({cookSteps.length})</span>
        </button>
        <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>──</span>
        <button
          className={`gh-cook-flow-step ${guidePhase === 'done' ? 'is-active' : ''}`}
          onClick={() => setGuidePhase('done')}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>dinner_dining</span>
          <span>3. Plating & Done</span>
        </button>
      </div>

      {error && (
        <div className="rs-card" style={{ borderColor: 'var(--md-error)', background: 'rgba(239, 68, 68, 0.08)' }}>
          <div className="rs-card-inner" style={{ color: 'var(--md-error)' }}>{error}</div>
        </div>
      )}

      {/* PHASE 1: MISE EN PLACE */}
      {guidePhase === 'prep' && (
        <div className="rs-flex rs-flex-col rs-gap-5">
          <div style={{ padding: '0 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)' }}>
              Gather provisions and prepare equipment before heat goes on:
            </span>
            <button
              className="gh-cook-btn-next"
              style={{ flex: 'none', height: 42, padding: '0 20px', fontSize: 'var(--rs-fs-small)' }}
              onClick={() => {
                if (!cook) startMealCook()
                else setGuidePhase('cook')
              }}
            >
              <span>Ready to Cook →</span>
            </button>
          </div>

          {/* Measured Ingredients per recipe */}
          {plan.recipes.map(r => (
            <div key={r.id} className="gh-card">
              <div className="rs-flex rs-items-center rs-justify-between rs-mb-4">
                <div className="rs-flex rs-items-center rs-gap-3">
                  <div style={{ width: 4, height: 18, borderRadius: 2, background: colorFor[r.id] || '#00e5ff' }} />
                  <h3 style={{ margin: 0, fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>
                    {r.title} · Measure & Prep
                  </h3>
                </div>
                <span style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--text-muted)' }}>
                  {(r.ingredients || []).filter(i => done.has(i.key)).length} / {(r.ingredients || []).length} prepped
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                {(r.ingredients || []).map(ing => {
                  const isDone = done.has(ing.key)
                  return (
                    <div
                      key={ing.key}
                      onClick={() => toggle(ing.key)}
                      style={{
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 18px',
                        borderRadius: 14,
                        background: isDone ? 'rgba(74, 222, 128, 0.12)' : '#1a2230',
                        border: isDone ? '1px solid rgba(74, 222, 128, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize: 26, color: isDone ? '#4ade80' : 'rgba(220, 230, 245, 0.5)' }}>
                        {isDone ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 800, color: 'var(--md-primary)', fontSize: 'var(--rs-fs-body)', minWidth: 70 }}>
                        {[ing.qty, ing.unit].filter(Boolean).join(' ') || '—'}
                      </span>
                      <span style={{ flex: 1, fontSize: 'var(--rs-fs-body)', fontWeight: 600, color: isDone ? 'rgba(220, 230, 245, 0.5)' : '#fff', textDecoration: isDone ? 'line-through' : 'none' }}>
                        {ing.name}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Knife work & preliminary prep steps */}
          {prepSteps.length > 0 && (
            <div className="gh-card">
              <h3 style={{ margin: '0 0 12px 0', fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>
                Preliminary Prep & Knife Work
              </h3>
              <div className="rs-flex rs-flex-col rs-gap-2">
                {prepSteps.map(s => {
                  const isDone = done.has(s.key)
                  return (
                    <div
                      key={s.key}
                      onClick={() => toggle(s.key)}
                      style={{
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: '12px 16px',
                        borderRadius: 14,
                        background: isDone ? 'rgba(74, 222, 128, 0.12)' : '#1a2230',
                        border: isDone ? '1px solid rgba(74, 222, 128, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: isDone ? '#4ade80' : 'rgba(220, 230, 245, 0.4)', marginTop: 2 }}>
                        {isDone ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <div className="rs-grow">
                        <div style={{ fontSize: 'var(--rs-fs-small)', color: isDone ? 'rgba(220, 230, 245, 0.5)' : '#fff', textDecoration: isDone ? 'line-through' : 'none' }}>
                          {s.text}
                        </div>
                        <div style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--text-muted)', marginTop: 4 }}>
                          {s.recipe_title} · {stationLabel(s.station)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Appliance Adaptation & Machine Check */}
          <div className="gh-card">
            <div className="rs-flex rs-items-center rs-justify-between rs-mb-3 rs-flex-wrap rs-gap-3">
              <div>
                <h3 style={{ margin: 0, fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>Appliance Stations & Adaptation</h3>
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)' }}>Swap appliances to adapt cooking methods for your hardware</div>
              </div>
              <button className="gh-glance-action" onClick={() => setShowAppliances(!showAppliances)}>
                <span className="material-symbols-rounded">settings</span>
                <span>{showAppliances ? 'Hide Equipment' : 'Manage Hardware'}</span>
              </button>
            </div>

            {showAppliances && (
              <div className="rs-mb-4">
                {availableEquipment.length === 0 ? (
                  <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', padding: 12 }}>
                    No kitchen equipment registered.
                  </div>
                ) : (
                  <div className="rs-flex rs-flex-col rs-gap-3">
                    {availableEquipment.length > 1 && (
                      <div className="rs-flex rs-gap-2 rs-flex-wrap">
                        {availableEquipment.map(eq => (
                          <button
                            key={eq.id}
                            type="button"
                            className={`gh-kitchen-nav-btn ${activeEquipmentId === eq.id ? 'is-active' : ''}`}
                            style={{ padding: '6px 14px', fontSize: 'var(--rs-fs-tiny)' }}
                            onClick={() => setSelectedEquipmentId(eq.id)}
                          >
                            <span>{eq.label || eq.make || 'Appliance'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <AppliancePanel
                      api={api}
                      equipmentId={activeEquipmentId}
                      onClose={() => setShowAppliances(false)}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="rs-flex rs-flex-col rs-gap-3">
              {plan.recipes.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 'var(--rs-fs-small)', minWidth: 160 }}>{r.title}</span>
                  <select
                    className="rs-pill"
                    style={{ background: 'rgba(255, 255, 255, 0.08)', border: 'none', color: '#fff', fontSize: 'var(--rs-fs-tiny)', flex: 1 }}
                    disabled={swapping === r.id}
                    value={(plan?.swaps || []).find(w => w.recipe_id === r.id)?.pick || ''}
                    onChange={e => swapAppliance(r.id, e.target.value || null)}
                  >
                    <option value="">Cook as written</option>
                    {(plan.appliances || []).flatMap(a =>
                      a.stations.map(st => (
                        <option key={`${a.id}:${st}`} value={`${a.id}:${st}`}>
                          {a.label} — as {(STATION_LABELS[st] || st).toLowerCase()}
                        </option>
                      ))
                    )}
                    {Object.entries(STATION_LABELS).filter(([k]) => k !== 'counter').map(([k, label]) => (
                      <option key={k} value={k}>Cook in {label.toLowerCase()}</option>
                    ))}
                  </select>
                  {swapping === r.id && <span style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--md-primary)' }}>Adapting recipe…</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PHASE 2: GUIDED COOK (FOCUS STEPPING) */}
      {guidePhase === 'cook' && (
        <div className="rs-flex rs-flex-col rs-gap-4">

          {/* View Mode Toggle */}
          <div className="rs-flex rs-justify-between rs-items-center rs-flex-wrap rs-gap-3">
            <div className="rs-flex rs-gap-2">
              <button
                className={`gh-kitchen-nav-btn ${viewMode === 'focus' ? 'is-active' : ''}`}
                style={{ padding: '6px 14px', fontSize: 'var(--rs-fs-tiny)' }}
                onClick={() => setViewMode('focus')}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>center_focus_strong</span>
                <span>Focus Step Guide</span>
              </button>
              <button
                className={`gh-kitchen-nav-btn ${viewMode === 'timeline' ? 'is-active' : ''}`}
                style={{ padding: '6px 14px', fontSize: 'var(--rs-fs-tiny)' }}
                onClick={() => setViewMode('timeline')}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>view_timeline</span>
                <span>Multi-Dish Timeline</span>
              </button>
            </div>

            <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)' }}>
              {cookSteps.filter(s => done.has(s.key)).length} of {cookSteps.length} steps completed
            </span>
          </div>

          {/* FOCUS STEP CARD */}
          {viewMode === 'focus' && (
            cookSteps.length > 0 && currentStep ? (
              <div className="gh-cook-hero-card">
                {/* Progress Bar */}
                <div className="gh-cook-progress-bar">
                  <div
                    className="gh-cook-progress-fill"
                    style={{ width: `${Math.round(((activeStepIdx + (isCurrentDone ? 1 : 0)) / cookSteps.length) * 100)}%` }}
                  />
                </div>

                {/* Step Header */}
                <div className="gh-cook-step-header">
                  <div className="rs-flex rs-items-center rs-gap-3">
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: colorFor[currentStep.recipe_id] || '#00e5ff',
                      color: '#001a2c',
                      fontWeight: 800,
                      fontSize: 'var(--rs-fs-micro)',
                      textTransform: 'uppercase',
                    }}>
                      {currentStep.recipe_title}
                    </span>
                    <span className="gh-sensor-pill" style={{ padding: '4px 10px', fontSize: 'var(--rs-fs-micro)' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 16 }}>{stationIcon(currentStep.station)}</span>
                      <span>{stationLabel(currentStep.station)}</span>
                    </span>
                  </div>

                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 'var(--rs-fs-body)', fontWeight: 800, color: 'var(--md-primary)' }}>
                    STEP {activeStepIdx + 1} OF {cookSteps.length} · {timeLabel(currentStep.start_min)}
                  </span>
                </div>

                {/* Large High-Contrast Step Text */}
                <div className="gh-cook-step-text">
                  {currentStep.text}
                </div>

                {/* Integrated Timer Widget */}
                {timerSeconds(currentStep) > 0 && (
                  <div className="gh-cook-timer-widget">
                    <div>
                      <div style={{ fontSize: 'var(--rs-fs-micro)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        STEP DURATION {currentStep.by_eye && '· JUDGE BY EYE'}
                      </div>
                      <div className="gh-cook-timer-display">
                        {Math.floor(timerSeconds(currentStep) / 60)}:00
                      </div>
                    </div>

                    <div className="rs-flex rs-gap-2 rs-items-center">
                      {cook && !(timersFor[currentStep.key] || []).length && (
                        <button
                          className="gh-cook-btn-next"
                          style={{ height: 44, padding: '0 20px', fontSize: 'var(--rs-fs-small)' }}
                          disabled={busy}
                          onClick={() => startTimer(currentStep, timerSeconds(currentStep))}
                        >
                          <span className="material-symbols-rounded">timer</span>
                          <span>Start Timer</span>
                        </button>
                      )}
                      {(timersFor[currentStep.key] || []).map(t => (
                        <StepTimer key={t.id} timer={t} api={api} onChanged={reloadTimers} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Big Ergonomic Tablet Touch Buttons */}
                <div className="gh-cook-touch-actions">
                  <button
                    className="gh-cook-btn-prev"
                    disabled={activeStepIdx === 0}
                    onClick={handlePrevStep}
                  >
                    <span className="material-symbols-rounded">arrow_back</span>
                    <span>Previous</span>
                  </button>

                  <button
                    className="gh-cook-btn-next"
                    onClick={handleNextStep}
                  >
                    <span className="material-symbols-rounded">{isCurrentDone ? 'arrow_forward' : 'check'}</span>
                    <span>
                      {isCurrentDone
                        ? (activeStepIdx === cookSteps.length - 1 ? 'Go to Plating' : 'Next Step')
                        : 'Mark Done & Next'}
                    </span>
                  </button>
                </div>

                {/* Up Next Preview */}
                {nextStep && (
                  <div style={{
                    marginTop: 20,
                    padding: '12px 16px',
                    borderRadius: 16,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}>
                    <span style={{ fontSize: 'var(--rs-fs-micro)', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      UP NEXT:
                    </span>
                    <span style={{ fontSize: 'var(--rs-fs-small)', color: 'var(--fg)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {nextStep.text}
                    </span>
                    <span style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--text-muted)' }}>
                      {stationLabel(nextStep.station)}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="gh-card rs-p-7 rs-text-center">
                <div style={{ fontSize: 'var(--rs-fs-h3)', fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>
                  No Active Cooking Steps
                </div>
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', marginBottom: 20 }}>
                  This meal plan only consists of preliminary mise en place. Complete your prep work or advance to plating.
                </div>
                <button
                  type="button"
                  className="gh-cook-btn-next"
                  style={{ height: 46, padding: '0 24px', display: 'inline-flex' }}
                  onClick={() => setGuidePhase('done')}
                >
                  <span className="material-symbols-rounded">dinner_dining</span>
                  <span>Proceed to Plating</span>
                </button>
              </div>
            )
          )}

          {/* VIEW MODE B: TIMELINE */}
          {viewMode === 'timeline' && (
            <div className="rs-flex rs-flex-col rs-gap-4">
              <div className="gh-card rs-p-5">
                <CookPlanTimeline
                  plan={plan}
                  colorFor={colorFor}
                  nowMin={null}
                  onPick={(s) => {
                    const idx = cookSteps.findIndex(cs => cs.key === s.key)
                    if (idx !== -1) {
                      setActiveStepIdx(idx)
                      setViewMode('focus')
                    }
                  }}
                />
              </div>

              <div className="rs-flex rs-flex-col rs-gap-2">
                {cookSteps.map((s, idx) => {
                  const isDone = done.has(s.key)
                  const isCurrent = idx === activeStepIdx
                  return (
                    <div
                      key={s.key}
                      onClick={() => {
                        setActiveStepIdx(idx)
                        setViewMode('focus')
                      }}
                      style={{
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        borderRadius: 16,
                        background: isCurrent
                          ? 'rgba(0, 229, 255, 0.12)'
                          : isDone
                          ? 'rgba(255, 255, 255, 0.02)'
                          : 'rgba(255, 255, 255, 0.04)',
                        border: isCurrent
                          ? '1px solid rgba(0, 229, 255, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        opacity: isDone ? 0.5 : 1,
                      }}
                    >
                      <button
                        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggle(s.key)
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 22, color: isDone ? '#4ade80' : '#00e5ff' }}>
                          {isDone ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                      </button>

                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 'var(--rs-fs-tiny)', fontWeight: 800, color: 'var(--md-primary)', minWidth: 50 }}>
                        {timeLabel(s.start_min)}
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--rs-fs-small)', color: 'var(--fg)', textDecoration: isDone ? 'line-through' : 'none' }}>
                          {s.text}
                        </div>
                        <div style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--text-muted)', marginTop: 2 }}>
                          {s.recipe_title} · {stationLabel(s.station)}
                        </div>
                      </div>

                      {timerSeconds(s) > 0 && (
                        <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--text-muted)' }}>
                          timer
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE 3: PLATING & DONE */}
      {guidePhase === 'done' && (
        <div className="gh-cook-hero-card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0071dc, #00e5ff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 0 30px rgba(0, 229, 255, 0.5)',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 36, color: '#002236' }}>
              dinner_dining
            </span>
          </div>

          <h2 style={{ fontSize: '2.3rem', fontWeight: 800, color: 'var(--fg)', margin: '0 0 10px 0' }}>
            Dinner is Served!
          </h2>
          <p style={{ fontSize: 'var(--rs-fs-body)', color: 'var(--fg)', maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.45 }}>
            All dishes are synchronized and complete. Allow hot roasted proteins to rest 5 minutes before carving to retain moisture.
          </p>

          {completionNotice && (
            <div style={{
              margin: '0 auto 24px',
              maxWidth: 480,
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(74, 222, 128, 0.12)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
              color: 'var(--rs-status-nominal)',
              fontSize: 'var(--rs-fs-small)',
              fontWeight: 600,
            }}>
              {completionNotice}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380, margin: '0 auto' }}>
            <button
              className="gh-cook-btn-next"
              style={{ height: 50, justifyContent: 'center' }}
              onClick={handleMarkDinnerCooked}
            >
              <span className="material-symbols-rounded">check_circle</span>
              <span>Mark Today's Dinner Cooked</span>
            </button>

            <button
              type="button"
              className="gh-cook-btn-prev"
              style={{ height: 50, justifyContent: 'center', opacity: 0.6, cursor: 'not-allowed' }}
              disabled
              title="Stockroom auto-depletion requires inventory barcode mappings"
            >
              <span className="material-symbols-rounded">inventory</span>
              <span>Deplete Pantry Stock (Coming Soon)</span>
            </button>

            <button
              className="gh-kitchen-nav-btn"
              style={{ justifyContent: 'center', background: 'rgba(255, 255, 255, 0.05)', marginTop: 8 }}
              onClick={() => {
                if (cook) endMealCook()
                else {
                  setPlan(null)
                  setGuidePhase('prep')
                }
              }}
            >
              <span className="material-symbols-rounded">restart_alt</span>
              <span>Finish & Clear Kitchen</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
