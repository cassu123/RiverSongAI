/**
 * ShoppingListTab — Multi-store household shopping list.
 *
 * Scoped to the household with realtime multi-device sync.
 * Supports linking items to multiple store destinations (Walmart, Target,
 * Costco, Amazon, Trader Joe's, Kroger, Aldi, Home Depot, or custom stores),
 * filtering by store, quick store assignment, multi-store product mappings,
 * and direct cart/search export links.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'

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

const STORE_CONFIG = {
  walmart: { label: 'Walmart', icon: 'storefront', color: '#0071dc' },
  costco: { label: 'Costco', icon: 'warehouse', color: '#e31837' },
  target: { label: 'Target', icon: 'adjust', color: '#cc0000' },
  amazon: { label: 'Amazon', icon: 'shopping_bag', color: '#ff9900' },
  trader_joes: { label: "Trader Joe's", icon: 'local_florist', color: '#b91c1c' },
  kroger: { label: 'Kroger', icon: 'local_grocery_store', color: '#0055a5' },
  aldi: { label: 'Aldi', icon: 'shopping_basket', color: '#1b365d' },
  homedepot: { label: 'Home Depot', icon: 'home_repair_service', color: '#f96302' },
}

const POPULAR_STORES = [
  'Walmart',
  'Costco',
  'Target',
  'Amazon',
  "Trader Joe's",
  'Kroger',
  'Aldi',
  'Home Depot',
]

function getStoreMeta(storeName) {
  if (!storeName) return null
  const key = storeName.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [k, meta] of Object.entries(STORE_CONFIG)) {
    if (key.includes(k.replace(/[^a-z0-9]/g, '')) || k.replace(/[^a-z0-9]/g, '').includes(key)) {
      return meta
    }
  }
  return { label: storeName, icon: 'store', color: 'var(--primary)' }
}

export default function ShoppingListTab({ api, refreshKey }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [selectedStore, setSelectedStore] = useState('')
  const [customStore, setCustomStore] = useState('')
  const [activeStoreFilter, setActiveStoreFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  // Store mappings & export
  const [showStoreLinks, setShowStoreLinks] = useState(false)
  const [activeLinkStore, setActiveLinkStore] = useState('walmart')
  const [mappings, setMappings] = useState([])
  const [mapName, setMapName] = useState('')
  const [mapId, setMapId] = useState('')
  const [mapNotes, setMapNotes] = useState('')
  const [mapError, setMapError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState(null)

  // Row inline store selector
  const [editingStoreItemId, setEditingStoreItemId] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get('/grocery')
      setItems(data || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api])

  const loadMappings = useCallback(async (store = 'all') => {
    try {
      const q = store && store !== 'all' ? `?store=${encodeURIComponent(store)}` : ''
      const res = await api.get(`/store/mappings${q}`)
      setMappings(res || [])
    } catch {
      /* ignore */
    }
  }, [api])

  useEffect(() => { load() }, [load, refreshKey])
  useEffect(() => {
    if (showStoreLinks) loadMappings(activeLinkStore)
  }, [showStoreLinks, activeLinkStore, loadMappings])

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

  // "Unassigned" is a display bucket, not a store -- adding while it is the
  // active tab must not tag the new item with the literal word.
  const effectiveStore = selectedStore === 'custom' ? customStore.trim() : (selectedStore || (activeStoreFilter !== 'all' && activeStoreFilter !== 'Unassigned' ? activeStoreFilter : ''))

  const add = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    setQty('')
    setUnit('')
    setCustomStore('')
    await mutate(() => api.post('/grocery', {
      name: trimmed,
      qty: qty.trim() || null,
      unit: unit.trim() || null,
      store: effectiveStore || null,
    }))
  }

  const handleQuickStoreChange = async (itemId, newStore) => {
    setEditingStoreItemId(null)
    // Clearing sends "", not null: the PATCH handler skips any field that
    // arrives as None, so `store: null` left the old store in place and the
    // "no store" option silently did nothing.
    await mutate(() => api.patch(`/grocery/${itemId}`, { store: newStore || '' }))
  }

  // Filter items based on active store filter
  const filteredItems = useMemo(() => {
    if (activeStoreFilter === 'all') return items
    // storeCounts buckets untagged items under "Unassigned", so the tab
    // exists; without this branch it matched items whose store is literally
    // "unassigned" and always came back empty.
    if (activeStoreFilter === 'Unassigned') return items.filter(i => !i.store)
    return items.filter(i => (i.store || '').toLowerCase() === activeStoreFilter.toLowerCase())
  }, [items, activeStoreFilter])

  const unchecked = filteredItems.filter(i => !i.checked)
  const checked = filteredItems.filter(i => i.checked)

  // Calculate item counts per store
  const storeCounts = useMemo(() => {
    const counts = { all: items.length }
    for (const it of items) {
      if (it.store) {
        counts[it.store] = (counts[it.store] || 0) + 1
      } else {
        counts['Unassigned'] = (counts['Unassigned'] || 0) + 1
      }
    }
    return counts
  }, [items])

  const availableStores = useMemo(() => {
    const fromItems = items.map(i => i.store).filter(Boolean)
    return Array.from(new Set([...fromItems, ...POPULAR_STORES]))
  }, [items])

  const runExport = async () => {
    setExporting(true)
    setExportResult(null)
    try {
      const targetStore = activeStoreFilter !== 'all' ? activeStoreFilter : (activeLinkStore || 'walmart')
      const result = await api.post(`/store/export?source=list&store=${encodeURIComponent(targetStore)}`, {})
      setExportResult(result)
      setShowStoreLinks(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const saveMapping = async (e) => {
    e.preventDefault()
    const ingredient = mapName.trim()
    const storeId = mapId.trim()
    if (!ingredient || !storeId) return
    setMapError(null)
    try {
      await api.post('/store/mappings', {
        ingredient_name: ingredient,
        store: activeLinkStore || 'walmart',
        store_item_id: storeId,
        notes: mapNotes.trim() || null,
      })
      setMapName('')
      setMapId('')
      setMapNotes('')
      await loadMappings(activeLinkStore)
    } catch (err) {
      setMapError(err.message)
    }
  }

  const row = (item) => {
    const storeMeta = getStoreMeta(item.store)
    const isEditingStore = editingStoreItemId === item.id

    return (
      <div
        key={item.id}
        className="rs-pill"
        style={{
          justifyContent: 'flex-start',
          gap: 10,
          padding: '10px 14px',
          opacity: item.checked ? 0.45 : 1,
          background: 'var(--md-surface-container-low)',
          position: 'relative',
          flexWrap: 'wrap',
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

        <span style={{ flex: '1 1 140px', textDecoration: item.checked ? 'line-through' : 'none' }}>
          {item.name}
        </span>

        {/* Store Tag / Quick Store Selector */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="rs-pill"
            style={{
              padding: '2px 8px',
              fontSize: '0.72rem',
              fontWeight: 700,
              gap: 4,
              border: `1px solid ${storeMeta ? storeMeta.color : 'rgba(255,255,255,0.18)'}`,
              color: storeMeta ? storeMeta.color : 'inherit',
              background: storeMeta ? `color-mix(in srgb, ${storeMeta.color} 15%, transparent)` : 'rgba(255,255,255,0.05)',
            }}
            title={item.store ? `Assigned to ${item.store} (click to change)` : 'Assign to a store'}
            onClick={() => setEditingStoreItemId(isEditingStore ? null : item.id)}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>
              {storeMeta ? storeMeta.icon : 'add_location'}
            </span>
            {item.store || '+ Store'}
          </button>

          {isEditingStore && (
            <div
              className="rs-mpop"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                zIndex: 9995,
                width: 200,
                maxHeight: 240,
                overflowY: 'auto',
                padding: 4,
              }}
            >
              <button
                className="rs-mpop-row"
                style={{ padding: '6px 8px', fontSize: '0.78rem' }}
                onClick={() => handleQuickStoreChange(item.id, null)}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>remove_circle_outline</span>
                <span>Unassigned</span>
              </button>
              {POPULAR_STORES.map(st => {
                const meta = getStoreMeta(st)
                return (
                  <button
                    key={st}
                    className="rs-mpop-row"
                    style={{ padding: '6px 8px', fontSize: '0.78rem' }}
                    onClick={() => handleQuickStoreChange(item.id, st)}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', color: meta.color }}>
                      {meta.icon}
                    </span>
                    <span>{st}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

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
  }

  const exportStoreLabel = activeStoreFilter !== 'all' ? activeStoreFilter : (activeLinkStore ? (STORE_CONFIG[activeLinkStore]?.label || activeLinkStore.toUpperCase()) : 'WALMART')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 740, margin: '0 auto', width: '100%' }}>
      {/* Store Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
        <button
          className="rs-pill"
          style={{
            fontSize: '0.75rem',
            padding: '6px 12px',
            background: activeStoreFilter === 'all' ? 'var(--primary)' : 'var(--md-surface-container-low)',
            color: activeStoreFilter === 'all' ? '#000' : 'inherit',
            fontWeight: activeStoreFilter === 'all' ? 800 : 500,
          }}
          onClick={() => setActiveStoreFilter('all')}
        >
          All Stores ({items.length})
        </button>

        {Object.entries(storeCounts).filter(([st]) => st !== 'all').map(([st, count]) => {
          const meta = getStoreMeta(st)
          const isActive = activeStoreFilter.toLowerCase() === st.toLowerCase()
          return (
            <button
              key={st}
              className="rs-pill"
              style={{
                fontSize: '0.75rem',
                padding: '6px 12px',
                gap: 5,
                background: isActive ? (meta ? meta.color : 'var(--primary)') : 'var(--md-surface-container-low)',
                color: isActive ? '#fff' : 'inherit',
                fontWeight: isActive ? 800 : 500,
              }}
              onClick={() => setActiveStoreFilter(isActive ? 'all' : st)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>
                {meta ? meta.icon : 'store'}
              </span>
              {st} ({count})
            </button>
          )
        })}
      </div>

      {/* Add Item Form with Store Selector */}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="rs-pill"
          style={{ flex: '2 1 180px', minWidth: 140, background: 'var(--md-surface-container-low)', border: 'none' }}
          placeholder={activeStoreFilter !== 'all' ? `Add to ${activeStoreFilter} list…` : 'Add to shopping list…'}
          aria-label="Item to add"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="rs-pill"
          style={{ width: 64, background: 'var(--md-surface-container-low)', border: 'none', textAlign: 'center' }}
          placeholder="Qty"
          aria-label="Quantity"
          value={qty}
          onChange={e => setQty(e.target.value)}
        />
        <input
          className="rs-pill"
          style={{ width: 68, background: 'var(--md-surface-container-low)', border: 'none', textAlign: 'center' }}
          placeholder="Unit"
          aria-label="Unit"
          value={unit}
          onChange={e => setUnit(e.target.value)}
        />
        <select
          className="rs-pill"
          style={{
            minWidth: 110,
            background: 'var(--md-surface-container-low)',
            border: 'none',
            color: 'inherit',
            fontWeight: 600,
          }}
          aria-label="Store destination"
          value={selectedStore}
          onChange={e => setSelectedStore(e.target.value)}
        >
          <option value="">{activeStoreFilter !== 'all' ? `Store: ${activeStoreFilter}` : 'Store (Auto)'}</option>
          {POPULAR_STORES.map(st => (
            <option key={st} value={st}>{st}</option>
          ))}
          <option value="custom">+ Custom Store</option>
        </select>
        {selectedStore === 'custom' && (
          <input
            className="rs-pill"
            style={{ width: 110, background: 'var(--md-surface-container-low)', border: 'none' }}
            placeholder="Store name"
            aria-label="Custom store name"
            value={customStore}
            onChange={e => setCustomStore(e.target.value)}
          />
        )}
        <button className="rs-btn-primary" type="submit" disabled={busy || !name.trim()}>
          <span className="material-symbols-rounded">add</span>
        </button>
      </form>

      {error && (
        <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{error}</div>
      )}

      {loading ? (
        <div className="rs-card-meta" style={{ padding: 32, textAlign: 'center' }}>LOADING LIST…</div>
      ) : filteredItems.length === 0 ? (
        <div className="rs-card-meta" style={{ padding: 32, textAlign: 'center' }}>
          {activeStoreFilter !== 'all'
            ? `Nothing on your ${activeStoreFilter} list. Add items above or tag existing items with this store.`
            : 'Nothing on the list. Anything you add here, say out loud, or that runs low in the stockroom shows up for everyone in the household.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unchecked.map(row)}
          </div>

          {checked.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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

      {/* Cart Actions Bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button
          className="rs-btn-primary"
          style={{ flex: 1, justifyContent: 'center', minWidth: 200 }}
          disabled={exporting || unchecked.length === 0}
          onClick={runExport}
        >
          <span className="material-symbols-rounded">shopping_cart_checkout</span>
          {exporting ? 'BUILDING CART…' : `SEND TO ${exportStoreLabel.toUpperCase()} CART`}
        </button>
        <button className="rs-pill" onClick={() => setShowStoreLinks(v => !v)}>
          <span className="material-symbols-rounded">link</span>
          STORE LINKS & MAPPINGS
        </button>
      </div>

      {/* Store Cart Export Results */}
      {exportResult && (
        <div className="rs-card" style={{ borderColor: exportResult.cart_url ? '#4ade80' : 'var(--md-outline-variant)' }}>
          <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="rs-card-head">
              <span className="rs-card-label" style={{ fontWeight: 800, color: 'var(--primary)' }}>
                {exportResult.store.toUpperCase()} CART EXPORT
              </span>
              <button className="rs-pill" onClick={() => setExportResult(null)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            {exportResult.cart_url ? (
              <a
                href={exportResult.cart_url}
                target="_blank"
                rel="noreferrer"
                className="rs-btn-primary"
                style={{ justifyContent: 'center', textDecoration: 'none' }}
              >
                OPEN {exportResult.store.toUpperCase()} CART ({exportResult.mapped_count} ITEM{exportResult.mapped_count === 1 ? '' : 'S'})
              </a>
            ) : (
              <div className="rs-card-meta">
                Direct cart links require mapped product IDs/SKUs. You can link items below or browse search links directly.
              </div>
            )}

            {exportResult.search_links?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="rs-card-label">STORE ITEMS & SEARCH LINKS ({exportResult.search_links.length})</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {exportResult.search_links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rs-pill"
                      style={{ textDecoration: 'none', gap: 6 }}
                    >
                      <span>{link.name}</span>
                      <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>
                        open_in_new
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {exportResult.unmapped?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="rs-card-label">NOT LINKED TO SKU YET ({exportResult.unmapped.length})</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {exportResult.unmapped.map((n, i) => (
                    <button
                      key={i}
                      className="rs-pill"
                      onClick={() => {
                        setMapName(n)
                        setActiveLinkStore(exportResult.store)
                        setShowStoreLinks(true)
                      }}
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

      {/* Multi-Store Links & SKU Mapping Modal/Card */}
      {showStoreLinks && (
        <div className="rs-card">
          <div className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="rs-card-head">
              <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>STORE PRODUCT LINKS & MAPPINGS</span>
              <button className="rs-pill" onClick={() => setShowStoreLinks(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <div className="rs-card-meta">
              Link ingredients and items to specific store product numbers or URLs (Walmart Item IDs, Amazon ASINs, Target TCINs, etc.) for automated cart building.
            </div>

            {/* Store Selection Tabs for Mapping */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {POPULAR_STORES.map(st => {
                const key = st.toLowerCase().replace(/[^a-z0-9]/g, '')
                const isSelected = activeLinkStore.replace(/[^a-z0-9]/g, '') === key
                const meta = getStoreMeta(st)
                return (
                  <button
                    key={st}
                    className="rs-pill"
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 10px',
                      background: isSelected ? meta.color : 'var(--md-surface-container-low)',
                      color: isSelected ? '#fff' : 'inherit',
                      fontWeight: isSelected ? 800 : 500,
                    }}
                    onClick={() => setActiveLinkStore(st.toLowerCase().replace(/[^a-z0-9]/g, '_'))}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>{meta.icon}</span>
                    {st}
                  </button>
                )
              })}
            </div>

            <form onSubmit={saveMapping} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="rs-pill"
                style={{ flex: '1 1 160px', minWidth: 0, background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder="Ingredient / Item name"
                aria-label="Ingredient name"
                value={mapName}
                onChange={e => setMapName(e.target.value)}
              />
              <input
                className="rs-pill"
                style={{ flex: '2 1 220px', minWidth: 0, background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder={`${activeLinkStore.toUpperCase()} URL, SKU, or Product ID`}
                aria-label="Store URL or Product ID"
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
                <div className="rs-card-meta">No mappings configured for {activeLinkStore}.</div>
              ) : mappings.map(m => {
                const meta = getStoreMeta(m.store)
                return (
                  <div key={m.id} className="rs-pill" style={{ justifyContent: 'flex-start', gap: 12 }}>
                    <span className="material-symbols-rounded" style={{ color: meta?.color || 'inherit', fontSize: '1.1rem' }}>
                      {meta?.icon || 'store'}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.ingredient_name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.6, fontSize: '0.8rem' }}>{m.store_item_id}</span>
                    <button
                      className="rs-pill"
                      aria-label={`Unlink ${m.ingredient_name}`}
                      style={{ padding: 4, minWidth: 0, background: 'transparent' }}
                      onClick={async () => {
                        await api.delete(`/store/mappings/${m.id}`)
                        loadMappings(activeLinkStore)
                      }}
                    >
                      <span className="material-symbols-rounded">link_off</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
