// =============================================================================
// src/components/AddRecipeModal.jsx
//
// Adding a recipe. Three ways in, deliberately ordered:
//
//   MANUAL  type it out          — no AI, no network beyond the save
//   PASTE   paste the text       — local model parses it
//   LINK    a URL or a PDF       — scrape/parse, then the model
//
// Manual is first and is the default because it is the only one that cannot
// fail for a reason outside this form. The other two need the local Ollama
// model to be up, and when a site has bot protection or a PDF is a scan, the
// backend's own advice is "copy the text and use manual entry" — so that has
// to be the thing already in front of you.
// =============================================================================

import React, { useState } from 'react'

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Other']

const MODES = [
  { id: 'manual', label: 'MANUAL', icon: 'edit_note', hint: 'Type it in — always works' },
  { id: 'paste', label: 'PASTE', icon: 'content_paste', hint: 'Paste recipe text — needs the local model' },
  { id: 'link', label: 'LINK / PDF', icon: 'link', hint: 'From a website or a PDF' },
]

const inputStyle = {
  all: 'unset',
  boxSizing: 'border-box',
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--md-outline-variant)',
  borderRadius: 8,
  fontSize: '0.85rem',
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>{label}</span>
      {children}
    </label>
  )
}

export default function AddRecipeModal({ token, onClose, onSaved }) {
  const [mode, setMode] = useState('manual')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Manual fields
  const [title, setTitle] = useState('')
  const [mealType, setMealType] = useState('Dinner')
  const [servings, setServings] = useState(4)
  const [imageUrl, setImageUrl] = useState('')
  // Free text, one per line — a table of ingredient rows is a worse
  // experience than a textarea for anyone typing from a cookbook.
  const [ingredientsText, setIngredientsText] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [equipmentText, setEquipmentText] = useState('')

  // Paste / link fields
  const [rawText, setRawText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [file, setFile] = useState(null)

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)

  // "200g plain flour" -> { name: "200g plain flour" }. The backend stores
  // ingredients as free-form dicts and only reads `name` for the blacklist
  // check, so keeping the typed line intact is both simplest and the most
  // faithful to what the cook wrote.
  const parseIngredients = (s) => lines(s).map((l) => ({ name: l }))

  const fail = async (res, fallback) => {
    let detail = fallback
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch { /* non-JSON error body */ }
    setError(detail)
  }

  const saveManual = async () => {
    if (!title.trim()) return setError('Give the recipe a title.')
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/culinary/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          title: title.trim(),
          meal_type: mealType,
          servings: Number(servings) || 4,
          image_url: imageUrl.trim() || null,
          ingredients: parseIngredients(ingredientsText),
          steps: lines(stepsText),
          equipment_needed: lines(equipmentText),
        }),
      })
      if (!res.ok) return await fail(res, 'Could not save the recipe.')
      onSaved(await res.json())
      onClose()
    } catch (e) {
      setError(`Could not reach the server: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const saveIngest = async () => {
    if (mode === 'paste' && !rawText.trim()) return setError('Paste the recipe text first.')
    if (mode === 'link') {
      // Exactly one. The backend processes `file` first and ignores
      // source_url when both arrive, so sending both silently imports a
      // different source than the one the user was looking at.
      if (!sourceUrl.trim() && !file) return setError('Add a link or choose a PDF.')
      if (sourceUrl.trim() && file) {
        return setError('Use a link or a PDF, not both — clear one of them.')
      }
    }

    setBusy(true)
    setError('')
    // multipart, because the same endpoint also accepts a PDF upload.
    const form = new FormData()
    if (mode === 'paste') form.append('raw_text', rawText)
    if (mode === 'link') {
      if (sourceUrl.trim()) form.append('source_url', sourceUrl.trim())
      if (file) form.append('file', file)
    }
    try {
      const res = await fetch('/api/culinary/recipes/ingest', {
        method: 'POST',
        headers: authHeaders,
        body: form,
      })
      if (!res.ok) return await fail(res, 'Could not read a recipe from that.')
      const body = await res.json()
      onSaved(Array.isArray(body) ? body[0] : body)
      onClose()
    } catch (e) {
      setError(`Could not reach the server: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const submit = mode === 'manual' ? saveManual : saveIngest

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="rs-card"
        style={{
          maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--md-surface-container)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="rs-card-value" style={{ fontSize: '1.15rem', fontWeight: 800 }}>
              Add a recipe
            </div>
            <button className="rs-pill" onClick={onClose} aria-label="Close">
              <span className="material-symbols-rounded">close</span>
            </button>
          </div>

          {/* Mode picker */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                className="rs-pill"
                onClick={() => { setMode(m.id); setError('') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  fontSize: '0.7rem',
                  background: mode === m.id
                    ? 'color-mix(in srgb, var(--primary) 22%, transparent)' : 'transparent',
                  color: mode === m.id ? 'var(--primary)' : 'inherit',
                  border: `1px solid ${mode === m.id ? 'var(--primary)' : 'var(--md-outline-variant)'}`,
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
          <div className="rs-card-meta" style={{ fontSize: '0.68rem', marginTop: -10 }}>
            {MODES.find((m) => m.id === mode)?.hint}
          </div>

          {error && (
            <div
              style={{
                display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8,
                background: 'color-mix(in srgb, var(--md-error) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--md-error) 45%, transparent)',
                fontSize: '0.75rem', lineHeight: 1.5,
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>
              <span>{error}</span>
            </div>
          )}

          {mode === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="TITLE">
                <input
                  style={inputStyle} value={title} autoFocus
                  placeholder="Roast chicken with lemon"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <Field label="MEAL">
                    <select
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={mealType} onChange={(e) => setMealType(e.target.value)}
                    >
                      {MEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  <Field label="SERVINGS">
                    <input
                      style={inputStyle} type="number" min="1" value={servings}
                      onChange={(e) => setServings(e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              <Field label="INGREDIENTS — ONE PER LINE">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }}
                  value={ingredientsText}
                  placeholder={'1 whole chicken\n2 lemons\n3 tbsp olive oil'}
                  onChange={(e) => setIngredientsText(e.target.value)}
                />
              </Field>

              <Field label="STEPS — ONE PER LINE">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }}
                  value={stepsText}
                  placeholder={'Heat the oven to 200C.\nSeason the chicken all over.\nRoast for 1 hour 20 minutes.'}
                  onChange={(e) => setStepsText(e.target.value)}
                />
              </Field>

              <Field label="EQUIPMENT — ONE PER LINE (OPTIONAL)">
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                  value={equipmentText}
                  placeholder={'roasting tin\nmeat thermometer'}
                  onChange={(e) => setEquipmentText(e.target.value)}
                />
              </Field>

              <Field label="IMAGE URL (OPTIONAL)">
                <input
                  style={inputStyle} value={imageUrl} placeholder="https://…"
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </Field>
            </div>
          )}

          {mode === 'paste' && (
            <Field label="RECIPE TEXT">
              <textarea
                style={{ ...inputStyle, minHeight: 260, resize: 'vertical', fontFamily: 'inherit' }}
                value={rawText} autoFocus
                placeholder={'Paste the whole thing — title, ingredients and method.\nThe local model pulls it into shape.'}
                onChange={(e) => setRawText(e.target.value)}
              />
            </Field>
          )}

          {mode === 'link' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="RECIPE URL">
                <input
                  style={inputStyle} value={sourceUrl} autoFocus
                  placeholder="https://example.com/roast-chicken"
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </Field>
              <Field label="…OR A PDF">
                <input
                  style={{ ...inputStyle, cursor: 'pointer' }} type="file" accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </Field>
              <p className="rs-card-meta" style={{ fontSize: '0.66rem', marginTop: -4 }}>
                Some sites block automated requests. If one does, copy the text and use
                PASTE instead — or MANUAL, which needs nothing running.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="rs-pill" onClick={onClose} disabled={busy} style={{ cursor: 'pointer' }}>
              CANCEL
            </button>
            <button
              className="rs-btn-primary"
              onClick={submit}
              disabled={busy}
              style={{ cursor: busy ? 'wait' : 'pointer', minWidth: 130, justifyContent: 'center' }}
            >
              <span className="material-symbols-rounded">
                {busy ? 'hourglass_top' : 'add'}
              </span>
              {busy ? (mode === 'manual' ? 'SAVING…' : 'READING…') : 'ADD RECIPE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
