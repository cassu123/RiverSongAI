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
  walmart: { 
    label: 'Walmart', 
    icon: 'storefront', 
    color: '#0071dc', 
    searchUrl: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` 
  },
  sams_club: { 
    label: "Sam's Club", 
    icon: 'warehouse', 
    color: '#0067a0', 
    searchUrl: (q) => `https://www.samsclub.com/b/search?q=${encodeURIComponent(q)}` 
  },
  costco: { 
    label: 'Costco', 
    icon: 'warehouse', 
    color: '#e31837', 
    searchUrl: (q) => `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(q)}` 
  },
  target: { 
    label: 'Target', 
    icon: 'adjust', 
    color: '#cc0000', 
    searchUrl: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}` 
  },
  amazon: { 
    label: 'Amazon', 
    icon: 'shopping_bag', 
    color: '#ff9900', 
    searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` 
  },
  trader_joes: { 
    label: "Trader Joe's", 
    icon: 'local_florist', 
    color: '#b91c1c', 
    searchUrl: (q) => `https://www.traderjoes.com/home/search?q=${encodeURIComponent(q)}` 
  },
  kroger: { 
    label: 'Kroger', 
    icon: 'local_grocery_store', 
    color: '#0055a5', 
    searchUrl: (q) => `https://www.kroger.com/search?query=${encodeURIComponent(q)}` 
  },
  aldi: { 
    label: 'Aldi', 
    icon: 'shopping_basket', 
    color: '#1b365d', 
    searchUrl: (q) => `https://www.aldi.us/results/?q=${encodeURIComponent(q)}` 
  },
  homedepot: { 
    label: 'Home Depot', 
    icon: 'home_repair_service', 
    color: '#f96302', 
    searchUrl: (q) => `https://www.homedepot.com/s/${encodeURIComponent(q)}` 
  },
}

const ALL_AVAILABLE_STORES = [
  'Walmart',
  "Sam's Club",
  'Costco',
  'Target',
  'Amazon',
  "Trader Joe's",
  'Kroger',
  'Aldi',
  'Home Depot',
]

const DEFAULT_ENABLED_STORES = ['Walmart', "Sam's Club"]
const DEFAULT_PRIMARY_STORE = 'Walmart'

function getStoreMeta(storeName) {
  if (!storeName) return null
  const key = storeName.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [k, meta] of Object.entries(STORE_CONFIG)) {
    const cleanK = k.replace(/[^a-z0-9]/g, '')
    if (key.includes(cleanK) || cleanK.includes(key)) {
      return meta
    }
  }
  return { 
    label: storeName, 
    icon: 'store', 
    color: 'var(--primary)',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q + ' ' + storeName)}`
  }
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

  // Store customization
  const [enabledStores, setEnabledStores] = useState(() => {
    try {
      const saved = localStorage.getItem('rs-enabled-stores')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return DEFAULT_ENABLED_STORES
  })

  const [primaryStore, setPrimaryStore] = useState(() => {
    try {
      const saved = localStorage.getItem('rs-primary-store')
      if (saved) return saved
    } catch {}
    return DEFAULT_PRIMARY_STORE
  })

  const [showStoreSettingsModal, setShowStoreSettingsModal] = useState(false)

  const handleToggleStore = (storeName) => {
    setEnabledStores(prev => {
      let next
      if (prev.includes(storeName)) {
        if (prev.length <= 1) return prev
        next = prev.filter(s => s !== storeName)
      } else {
        next = [...prev, storeName]
      }
      try { localStorage.setItem('rs-enabled-stores', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const handleSetPrimaryStore = (storeName) => {
    setPrimaryStore(storeName)
    try { localStorage.setItem('rs-primary-store', storeName) } catch {}
    if (!enabledStores.includes(storeName)) {
      setEnabledStores(prev => {
        const next = [...prev, storeName]
        try { localStorage.setItem('rs-enabled-stores', JSON.stringify(next)) } catch {}
        return next
      })
    }
  }

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
  const effectiveStore = selectedStore === 'custom' 
    ? customStore.trim() 
    : (selectedStore || (activeStoreFilter !== 'all' && activeStoreFilter !== 'Unassigned' ? activeStoreFilter : primaryStore))

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
    return Array.from(new Set([...fromItems, ...enabledStores]))
  }, [items, enabledStores])

  const runExport = async () => {
    setExporting(true)
    setExportResult(null)
    try {
      const targetStore = activeStoreFilter !== 'all' && activeStoreFilter !== 'Unassigned' 
        ? activeStoreFilter 
        : primaryStore
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
        className="rs-pill rs-gap-3 rs-flex-wrap rs-relative"
        style={{
          justifyContent: 'flex-start',
          padding: 'var(--rs-space-3) var(--rs-space-4)',
          opacity: item.checked ? 0.45 : 1,
          background: 'var(--md-surface-container-low)',
        }}
      >
        <button
          className="rs-pill rs-p-1 rs-min-w-0"
          aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}
          aria-pressed={item.checked}
          style={{ background: 'transparent' }}
          disabled={busy}
          onClick={() => mutate(() => api.patch(`/grocery/${item.id}`, { checked: !item.checked }))}
        >
          <span className="material-symbols-rounded" style={{ color: item.checked ? 'var(--primary)' : 'inherit' }}>
            {item.checked ? 'check_circle' : 'radio_button_unchecked'}
          </span>
        </button>

        {(item.qty || item.unit) && (
          <span className="rs-mono rs-nowrap rs-fw-800 rs-c-accent">
            {[item.qty, item.unit].filter(Boolean).join(' ')}
          </span>
        )}

        <span style={{ flex: '1 1 140px', textDecoration: item.checked ? 'line-through' : 'none' }}>
          {item.name}
        </span>

        {/* Store Tag / Quick Store Selector */}
        <div className="rs-relative">
          <button
            type="button"
            className="rs-pill rs-gap-1 rs-type-small rs-fw-700"
            style={{
              padding: '2px 8px',
              border: `1px solid ${storeMeta ? storeMeta.color : 'rgba(255,255,255,0.18)'}`,
              color: storeMeta ? storeMeta.color : 'inherit',
              background: storeMeta ? `color-mix(in srgb, ${storeMeta.color} 15%, transparent)` : 'var(--rs-veil-1)',
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
              className="rs-mpop rs-mt-1 rs-p-1"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                zIndex: 9995,
                width: 200,
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              <button
                className="rs-mpop-row rs-type-small"
                style={{ padding: 'var(--rs-space-2) var(--rs-space-2)' }}
                onClick={() => handleQuickStoreChange(item.id, null)}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>remove_circle_outline</span>
                <span>Unassigned</span>
              </button>
              {enabledStores.map(st => {
                const meta = getStoreMeta(st)
                return (
                  <button
                    key={st}
                    className="rs-mpop-row rs-type-small"
                    style={{ padding: 'var(--rs-space-2) var(--rs-space-2)' }}
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

        {/* Direct 1-Click Link to Store Search / Product */}
        {storeMeta?.searchUrl && (
          <a
            href={storeMeta.searchUrl(item.name)}
            target="_blank"
            rel="noreferrer"
            className="rs-pill rs-p-1 rs-min-w-0"
            title={`Search ${item.name} on ${storeMeta.label || 'Store'}`}
            style={{ color: storeMeta.color, background: 'transparent' }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>
              open_in_new
            </span>
          </a>
        )}

        <span
          className="rs-card-label rs-type-tiny rs-nowrap"
          style={{ color: SOURCE_COLORS[item.source] || 'inherit', opacity: 0.85 }}
        >
          {SOURCE_LABELS[item.source] || item.source?.toUpperCase()}
          {item.added_by_name && !item.is_mine ? ` · ${item.added_by_name}` : ''}
        </span>

        <button
          className="rs-pill rs-p-1 rs-min-w-0"
          aria-label={`Remove ${item.name}`}
          style={{ background: 'transparent' }}
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
    <div className="rs-flex rs-flex-col rs-gap-4 rs-w-full" style={{ maxWidth: 740, margin: '0 auto' }}>
      {/* Store Filter Tabs */}
      <div className="rs-flex rs-gap-2 rs-items-center" style={{ overflowX: 'auto', paddingBottom: 'var(--rs-space-1)', scrollbarWidth: 'none' }}>
        <button
          type="button"
          className="rs-pill rs-type-small"
          style={{
            padding: 'var(--rs-space-2) var(--rs-space-3)',
            background: activeStoreFilter === 'all' ? 'var(--primary)' : 'var(--md-surface-container-low)',
            color: activeStoreFilter === 'all' ? '#000' : 'inherit',
            fontWeight: activeStoreFilter === 'all' ? 800 : 500,
          }}
          onClick={() => setActiveStoreFilter('all')}
        >
          All Stores ({items.length})
        </button>

        {/* Enabled Stores (Always visible) */}
        {enabledStores.map(st => {
          const meta = getStoreMeta(st)
          const count = storeCounts[st] || 0
          const isActive = activeStoreFilter.toLowerCase() === st.toLowerCase()
          return (
            <button
              key={st}
              type="button"
              className="rs-pill rs-type-small rs-gap-1"
              style={{
                padding: 'var(--rs-space-2) var(--rs-space-3)',
                background: isActive ? (meta ? meta.color : 'var(--primary)') : 'var(--md-surface-container-low)',
                color: isActive ? '#fff' : 'inherit',
                fontWeight: isActive ? 800 : 500,
              }}
              onClick={() => setActiveStoreFilter(isActive ? 'all' : st)}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.95rem' }}>
                {meta ? meta.icon : 'store'}
              </span>
              <span>{st}</span>
              {count > 0 && <span className="rs-mono" style={{ opacity: 0.85 }}>({count})</span>}
            </button>
          )
        })}

        {/* Other stores with existing items */}
        {Object.entries(storeCounts)
          .filter(([st]) => st !== 'all' && st !== 'Unassigned' && !enabledStores.some(es => es.toLowerCase() === st.toLowerCase()))
          .map(([st, count]) => {
            const meta = getStoreMeta(st)
            const isActive = activeStoreFilter.toLowerCase() === st.toLowerCase()
            return (
              <button
                key={st}
                type="button"
                className="rs-pill rs-type-small rs-gap-1"
                style={{
                  padding: 'var(--rs-space-2) var(--rs-space-3)',
                  background: isActive ? (meta ? meta.color : 'var(--primary)') : 'var(--md-surface-container-low)',
                  color: isActive ? '#fff' : 'inherit',
                  fontWeight: isActive ? 800 : 500,
                }}
                onClick={() => setActiveStoreFilter(isActive ? 'all' : st)}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '0.95rem' }}>
                  {meta ? meta.icon : 'store'}
                </span>
                <span>{st}</span>
                <span className="rs-mono">({count})</span>
              </button>
            )
          })}

        {storeCounts['Unassigned'] > 0 && (
          <button
            type="button"
            className="rs-pill rs-type-small rs-gap-1"
            style={{
              padding: 'var(--rs-space-2) var(--rs-space-3)',
              background: activeStoreFilter === 'Unassigned' ? 'var(--primary)' : 'var(--md-surface-container-low)',
              color: activeStoreFilter === 'Unassigned' ? '#000' : 'inherit',
              fontWeight: activeStoreFilter === 'Unassigned' ? 800 : 500,
            }}
            onClick={() => setActiveStoreFilter(activeStoreFilter === 'Unassigned' ? 'all' : 'Unassigned')}
          >
            <span>Unassigned</span>
            <span className="rs-mono">({storeCounts['Unassigned']})</span>
          </button>
        )}

        <button
          type="button"
          className="rs-pill rs-type-small rs-gap-1"
          style={{
            padding: 'var(--rs-space-2) var(--rs-space-3)',
            background: 'var(--md-surface-container-high)',
            marginLeft: 'auto',
          }}
          onClick={() => setShowStoreSettingsModal(true)}
          title="Manage active stores"
        >
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>tune</span>
          <span>Stores</span>
        </button>
      </div>

      {/* Add Item Form with Store Selector */}
      <form onSubmit={add} className="rs-flex rs-gap-2 rs-flex-wrap">
        <input
          className="rs-pill"
          style={{ flex: '2 1 180px', minWidth: 140, background: 'var(--md-surface-container-low)', border: 'none' }}
          placeholder={
            activeStoreFilter !== 'all' && activeStoreFilter !== 'Unassigned' 
              ? `Add to ${activeStoreFilter} list…` 
              : `Add item (defaults to ${primaryStore})…`
          }
          aria-label="Item to add"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="rs-pill rs-text-center"
          style={{ width: 64, background: 'var(--md-surface-container-low)', border: 'none' }}
          placeholder="Qty"
          aria-label="Quantity"
          value={qty}
          onChange={e => setQty(e.target.value)}
        />
        <input
          className="rs-pill rs-text-center"
          style={{ width: 68, background: 'var(--md-surface-container-low)', border: 'none' }}
          placeholder="Unit"
          aria-label="Unit"
          value={unit}
          onChange={e => setUnit(e.target.value)}
        />
        <select
          className="rs-pill rs-fw-600"
          style={{
            minWidth: 110,
            background: 'var(--md-surface-container-low)',
            border: 'none',
            color: 'inherit',
          }}
          aria-label="Store destination"
          value={selectedStore}
          onChange={e => setSelectedStore(e.target.value)}
        >
          <option value="">
            {activeStoreFilter !== 'all' && activeStoreFilter !== 'Unassigned' 
              ? `Store: ${activeStoreFilter}` 
              : `Store (${primaryStore})`}
          </option>
          {enabledStores.map(st => (
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
        <div className="rs-card-meta rs-c-error">{error}</div>
      )}

      {loading ? (
        <div className="rs-card-meta rs-p-6 rs-text-center">LOADING LIST…</div>
      ) : filteredItems.length === 0 ? (
        <div className="rs-card-meta rs-p-6 rs-text-center">
          {activeStoreFilter !== 'all'
            ? `Nothing on your ${activeStoreFilter} list. Add items above or tag existing items with this store.`
            : 'Nothing on the list. Anything you add here, say out loud, or that runs low in the stockroom shows up for everyone in the household.'}
        </div>
      ) : (
        <>
          <div className="rs-flex rs-flex-col rs-gap-2">
            {unchecked.map(row)}
          </div>

          {checked.length > 0 && (
            <div className="rs-flex rs-flex-col rs-gap-2 rs-mt-2">
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
      <div className="rs-flex rs-gap-2 rs-flex-wrap rs-mt-2">
        <button
          className="rs-btn-primary rs-grow rs-justify-center"
          style={{ minWidth: 200 }}
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
        <div className="rs-card" style={{ borderColor: exportResult.cart_url ? 'var(--rs-status-nominal)' : 'var(--md-outline-variant)' }}>
          <div className="rs-card-inner rs-flex rs-flex-col rs-gap-3">
            <div className="rs-card-head">
              <span className="rs-card-label rs-fw-800 rs-c-accent">
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
                className="rs-btn-primary rs-justify-center"
                style={{ textDecoration: 'none' }}
              >
                OPEN {exportResult.store.toUpperCase()} CART ({exportResult.mapped_count} ITEM{exportResult.mapped_count === 1 ? '' : 'S'})
              </a>
            ) : (
              <div className="rs-card-meta">
                Direct cart links require mapped product IDs/SKUs. You can link items below or browse search links directly.
              </div>
            )}

            {exportResult.search_links?.length > 0 && (
              <div className="rs-flex rs-flex-col rs-gap-2">
                <div className="rs-card-label">STORE ITEMS & SEARCH LINKS ({exportResult.search_links.length})</div>
                <div className="rs-flex rs-gap-2 rs-flex-wrap">
                  {exportResult.search_links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rs-pill rs-gap-2"
                      style={{ textDecoration: 'none' }}
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
              <div className="rs-flex rs-flex-col rs-gap-2">
                <div className="rs-card-label">NOT LINKED TO SKU YET ({exportResult.unmapped.length})</div>
                <div className="rs-flex rs-gap-2 rs-flex-wrap">
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
          <div className="rs-card-inner rs-flex rs-flex-col rs-gap-4">
            <div className="rs-card-head">
              <span className="rs-card-label rs-fw-900 rs-c-accent">STORE PRODUCT LINKS & MAPPINGS</span>
              <button className="rs-pill" onClick={() => setShowStoreLinks(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            <div className="rs-card-meta">
              Link ingredients and items to specific store product numbers or URLs (Walmart Item IDs, Amazon ASINs, Target TCINs, etc.) for automated cart building.
            </div>

            {/* Store Selection Tabs for Mapping */}
            <div className="rs-flex rs-gap-2" style={{ overflowX: 'auto', paddingBottom: 2 }}>
              {enabledStores.map(st => {
                const key = st.toLowerCase().replace(/[^a-z0-9]/g, '')
                const isSelected = activeLinkStore.replace(/[^a-z0-9]/g, '') === key
                const meta = getStoreMeta(st)
                return (
                  <button
                    key={st}
                    className="rs-pill rs-type-small"
                    style={{
                      padding: 'var(--rs-space-1) var(--rs-space-3)',
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

            <form onSubmit={saveMapping} className="rs-flex rs-gap-2 rs-flex-wrap">
              <input
                className="rs-pill rs-min-w-0"
                style={{ flex: '1 1 160px', background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder="Ingredient / Item name"
                aria-label="Ingredient name"
                value={mapName}
                onChange={e => setMapName(e.target.value)}
              />
              <input
                className="rs-pill rs-min-w-0"
                style={{ flex: '2 1 220px', background: 'var(--md-surface-container-low)', border: 'none' }}
                placeholder={`${activeLinkStore.toUpperCase()} URL, SKU, or Product ID`}
                aria-label="Store URL or Product ID"
                value={mapId}
                onChange={e => setMapId(e.target.value)}
              />
              <button className="rs-btn-primary" type="submit" disabled={!mapName.trim() || !mapId.trim()}>
                LINK
              </button>
            </form>
            {mapError && <div className="rs-card-meta rs-c-error">{mapError}</div>}

            <div className="rs-flex rs-flex-col rs-gap-2">
              {mappings.length === 0 ? (
                <div className="rs-card-meta">No mappings configured for {activeLinkStore}.</div>
              ) : mappings.map(m => {
                const meta = getStoreMeta(m.store)
                return (
                  <div key={m.id} className="rs-pill rs-gap-3" style={{ justifyContent: 'flex-start' }}>
                    <span className="material-symbols-rounded" style={{ color: meta?.color || 'inherit', fontSize: '1.1rem' }}>
                      {meta?.icon || 'store'}
                    </span>
                    <span className="rs-grow rs-fw-600">{m.ingredient_name}</span>
                    <span className="rs-muted rs-mono rs-type-small">{m.store_item_id}</span>
                    <button
                      className="rs-pill rs-p-1 rs-min-w-0"
                      aria-label={`Unlink ${m.ingredient_name}`}
                      style={{ background: 'transparent' }}
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

      {/* Store Settings Modal */}
      {showStoreSettingsModal && (
        <div className="rs-modal-overlay">
          <div className="rs-modal" style={{ maxWidth: 440 }}>
            <div className="rs-flex rs-justify-between rs-items-center rs-mb-4">
              <div>
                <div className="rs-card-label">SHOPPING STORE SETTINGS</div>
                <div className="rs-type-tiny rs-c-dim rs-mt-1">Toggle the stores you shop at and set your default store.</div>
              </div>
              <button 
                type="button" 
                className="rs-pill rs-p-1" 
                onClick={() => setShowStoreSettingsModal(false)}
                aria-label="Close store settings"
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <div className="rs-flex rs-flex-col rs-gap-2 rs-mb-5" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {ALL_AVAILABLE_STORES.map(storeName => {
                const meta = getStoreMeta(storeName)
                const isEnabled = enabledStores.includes(storeName)
                const isPrimary = primaryStore === storeName

                return (
                  <div
                    key={storeName}
                    className="rs-pill rs-justify-between rs-items-center"
                    style={{
                      padding: 'var(--rs-space-2) var(--rs-space-3)',
                      background: isEnabled ? 'var(--md-surface-container)' : 'var(--md-surface-container-low)',
                      opacity: isEnabled ? 1 : 0.65,
                    }}
                  >
                    <div className="rs-flex rs-items-center rs-gap-2">
                      <span className="material-symbols-rounded" style={{ color: meta.color, fontSize: '1.2rem' }}>
                        {meta.icon}
                      </span>
                      <span className="rs-fw-700">{storeName}</span>
                      {isPrimary && (
                        <span 
                          className="rs-pill rs-type-micro rs-fw-800" 
                          style={{ background: meta.color, color: '#fff', padding: '1px 6px' }}
                        >
                          PRIMARY
                        </span>
                      )}
                    </div>

                    <div className="rs-flex rs-items-center rs-gap-2">
                      {isEnabled && !isPrimary && (
                        <button
                          type="button"
                          className="rs-pill rs-type-micro"
                          onClick={() => handleSetPrimaryStore(storeName)}
                          title="Set as primary store"
                        >
                          Set Primary
                        </button>
                      )}
                      <button
                        type="button"
                        className={`rs-pill rs-type-micro ${isEnabled ? 'is-active' : ''}`}
                        onClick={() => handleToggleStore(storeName)}
                        style={{
                          background: isEnabled ? meta.color : 'transparent',
                          color: isEnabled ? '#fff' : 'inherit',
                          minWidth: 42,
                          justifyContent: 'center',
                        }}
                      >
                        {isEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="rs-flex rs-justify-end">
              <button 
                type="button"
                className="rs-btn-primary" 
                onClick={() => setShowStoreSettingsModal(false)}
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
