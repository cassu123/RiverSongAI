/**
 * ShoppingListTab — the household's standing shopping list.
 *
 * cul_shopping_list has had writers for a while (voice adds, low stock,
 * depletion) and no reader: nothing in the frontend fetched /grocery, so
 * items went in and were never seen again. The one screen labelled "MASTER
 * SHOPPING LIST" was the per-prep-session aggregate, which is a different
 * list that empties when the session ends.
 *
 * This is the shared one. It is scoped to the household, so in a linked
 * family every member sees the same list and each row says who put it there.
 * The websocket already broadcasts grocery_updated on every write; the page
 * refetches on it, which is what makes a phone in the kitchen and a phone in
 * the store agree.
 */
import React, { useCallback, useEffect, useState } from 'react'

const SOURCE_LABELS = {
  manual: 'ADDED',
  chat: 'VOICE',
  stockroom_auto: 'STOCK LOW',
  prep: 'PREP',
  meal_plan: 'MEAL PLAN',
  parts: 'PARTS',
}

const SOURCE_COLORS = {
  chat: 'var(--primary)',
  stockroom_auto: '#FFB86C',
  prep: '#7dd3fc',
  meal_plan: '#c4b5fd',
}

export default function ShoppingListTab({ api, refreshKey }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)

  const [showWalmart, setShowWalmart] = useState(false)
  const [mappings, setMappings] = useState([])
  const [mapName, setMapName] = useState('')
  const [mapId, setMapId] = useState('')
  const [mapError, setMapError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.get('/grocery'))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api])

  const loadMappings = useCallback(async () => {
    try { setMappings(await api.get('/walmart/mappings')) } catch { /* panel stays empty */ }
  }, [api])

  // refreshKey changes when someone else touches the list, or when the sync
  // pill is pressed.
  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => { if (showWalmart) loadMappings() }, [showWalmart, loadMappings])

  // Every mutation refetches rather than patching local state: the list is
  // shared, so the server's copy may already differ from ours.
  const mutate = async (fn) => {
    setBusy(true)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const add = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    setQty('')
    await mutate(() => api.post('/grocery', { name: trimmed, qty: qty.trim() || null }))
  }

  const unchecked = items.filter(i => !i.checked)
  const checked = items.filter(i => i.checked)

  const runExport = async () => {
    setExporting(true)
    setExportResult(null)
    try {
      setExportResult(await api.post('/walmart/export?source=list', {}))
      setShowWalmart(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const saveMapping = async (e) => {
    e.preventDefault()
    const ingredient = mapName.trim()
    const walmart = mapId.trim()
    if (!ingredient || !walmart) return
    setMapError(null)
    try {
      await api.post('/walmart/mappings', { ingredient_name: ingredient, walmart_item_id: walmart })
      setMapName('')
      setMapId('')
      await loadMappings()
    } catch (err) {
      setMapError(err.message)
    }
  }

  const row = (item) => (
    <div
      key={item.id}
      className="rs-pill"
      style={{
        justifyContent: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        opacity: item.checked ? 0.45 : 1,
        background: 'var(--md-surface-container-low)',
      }}
    >
      <button
        className="rs-pill"
        aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}
        aria-pressed={item.checked}
        style={{ padding: 4, minWidth: 0, background: 'transparent' }}
        disabled={busy}
        onClick={() => mutate(() => api.patch(`/grocery/${item.id}`, { checked: !item.checked }))}
      >
        <span className="material-symbols-rounded" style={{ color: item.checked ? 'var(--primary)' : 'inherit' }}>
          {item.checked ? 'check_circle' : 'radio_button_unchecked'}
        </span>
      </button>

      {(item.qty || item.unit) && (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
          {[item.qty, item.unit].filter(Boolean).join(' ')}
        </span>
      )}

      <span style={{ flex: 1, textDecoration: item.checked ? 'line-through' : 'none' }}>{item.name}</span>

      <span
        className="rs-card-label"
        style={{ fontSize: '0.6rem', whiteSpace: 'nowrap', color: SOURCE_COLORS[item.source] || 'inherit', opacity: 0.85 }}
      >
        {SOURCE_LABELS[item.source] || item.source?.toUpperCase()}
        {item.added_by_name && !item.is_mine ? ` · ${item.added_by_name}` : ''}
      </span>

      <button
        className="rs-pill"
        aria-label={`Remove ${item.name}`}
        style={{ padding: 4, minWidth: 0, background: 'transparent' }}
        disabled={busy}
        onClick={() => mutate(() => api.delete(`/grocery/${item.id}`))}
      >
        <span className="material-symbols-rounded">close</span>
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
        <input
          className="rs-pill"
          style={{ flex: 1, minWidth: 0, background: 'var(--md-surface-container-low)', border: 'none' }}
          placeholder="Add to the list…"
          aria-label="Item to add"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="rs-pill"
          style={{ width: 88, background: 'var(--md-surface-container-low)', border: 'none', textAlign: 'center' }}
          placeholder="Qty"
          aria-label="Quantity"
          value={qty}
          onChange={e => setQty(e.target.value)}
        />
        <button className="rs-btn-primary" type="submit" disabled={busy || !name.trim()}>
          <span className="material-symbols-rounded">add</span>
        </button>
      </form>

      {error && (
        <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{error}</div>
      )}

      {loading ? (
        <div className="rs-card-meta" style={{ padding: 32, textAlign: 'center' }}>LOADING LIST…</div>
      ) : items.length === 0 ? (
        <div className="rs-card-meta" style={{ padding: 32, textAlign: 'center' }}>
          Nothing on the list. Anything you add here — or say out loud, or that runs low in the
          stockroom — shows up for everyone in the household.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unchecked.map(row)}
          </div>

          {checked.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="rs-card-head">
                <span className="rs-card-label">IN THE CART ({checked.length})</span>
                <button
                  className="rs-pill"
                  disabled={busy}
                  onClick={() => mutate(() => api.post('/grocery/clear', {}))}
                >
                  <span className="material-symbols-rounded">delete_sweep</span>
                  CLEAR
                </button>
              </div>
              {checked.map(row)}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="rs-btn-primary"
          style={{ flex: 1, justifyContent: 'center', minWidth: 200 }}
          disabled={exporting || unchecked.length === 0}
          onClick={runExport}
        >
          <span className="material-symbols-rounded">shopping_cart_checkout</span>
          {exporting ? 'BUILDING CART…' : 'SEND TO WALMART CART'}
        </button>
        <button className="rs-pill" onClick={() => setShowWalmart(v => !v)}>
          <span className="material-symbols-rounded">link</span>
          WALMART LINKS
        </button>
      </div>

      {exportResult && (
        <div className="rs-card" style={{ borderColor: exportResult.cart_url ? '#4ade80' : 'var(--md-outline-variant)' }}>
          <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exportResult.cart_url ? (
              <a
                href={exportResult.cart_url}
                target="_blank"
                rel="noreferrer"
                className="rs-btn-primary"
                style={{ justifyContent: 'center', textDecoration: 'none' }}
              >
                OPEN CART ({exportResult.mapped_count} ITEM{exportResult.mapped_count === 1 ? '' : 'S'})
              </a>
            ) : (
              <div className="rs-card-meta">
                Nothing on the list is linked to a Walmart product yet, so there is no cart to open.
                Link one below and export again.
              </div>
            )}
            {exportResult.unmapped?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="rs-card-label">NOT LINKED YET ({exportResult.unmapped.length})</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {exportResult.unmapped.map((n, i) => (
                    <button
                      key={i}
                      className="rs-pill"
                      onClick={() => { setMapName(n); setShowWalmart(true) }}
                    >
                      {n}
                      <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>add_link</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showWalmart && (
        <div className="rs-card">
          <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="rs-card-head">
              <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>WALMART LINKS</span>
              <button className="rs-pill" onClick={() => setShowWalmart(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <div className="rs-card-meta">
              A cart can only be built from items that are linked to a specific Walmart product.
              Paste the product page URL — the item number is pulled out of it.
            </div>

            <form onSubmit={saveMapping} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="rs-pill"
                style={{ flex: '1 1 160px', minWidth: 0, background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder="Ingredient"
                aria-label="Ingredient name"
                value={mapName}
                onChange={e => setMapName(e.target.value)}
              />
              <input
                className="rs-pill"
                style={{ flex: '2 1 220px', minWidth: 0, background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder="Walmart URL or item number"
                aria-label="Walmart URL or item number"
                value={mapId}
                onChange={e => setMapId(e.target.value)}
              />
              <button className="rs-btn-primary" type="submit" disabled={!mapName.trim() || !mapId.trim()}>
                LINK
              </button>
            </form>
            {mapError && <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{mapError}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mappings.length === 0 ? (
                <div className="rs-card-meta">Nothing linked yet.</div>
              ) : mappings.map(m => (
                <div key={m.id} className="rs-pill" style={{ justifyContent: 'flex-start', gap: 12 }}>
                  <span style={{ flex: 1 }}>{m.ingredient_name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.6 }}>{m.walmart_item_id}</span>
                  <button
                    className="rs-pill"
                    aria-label={`Unlink ${m.ingredient_name}`}
                    style={{ padding: 4, minWidth: 0, background: 'transparent' }}
                    onClick={async () => {
                      await api.delete(`/walmart/mappings/${m.id}`)
                      loadMappings()
                    }}
                  >
                    <span className="material-symbols-rounded">link_off</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
