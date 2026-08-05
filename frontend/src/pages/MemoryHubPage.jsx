import React, { useState, Suspense, lazy } from 'react'

/**
 * MemoryHubPage
 * -----------------------------------------------------------------------------
 * Single home for everything memory-related. Hosts three tabs — Memory, Notes,
 * and Docs — each backed by its existing page component, so there's one drawer
 * entry instead of three scattered ones.
 *
 * The standalone /chronos and /documents routes are intentionally kept alive in
 * App.jsx for deep-links and the Briefing quick-actions; this hub simply reuses
 * the same components under one roof.
 */

const MemoryPage    = lazy(() => import('./MemoryPage.jsx'))
const ChronosPage   = lazy(() => import('./ChronosPage.jsx'))
const DocumentsPage = lazy(() => import('./DocumentsPage.jsx'))

const TABS = [
  { key: 'memory', label: 'Memory', icon: 'neurology' },
  { key: 'notes',  label: 'Notes',  icon: 'edit_note' },
  { key: 'docs',   label: 'Docs',   icon: 'description' },
]

export default function MemoryHubPage({ setAction, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'memory')

  // Clear the shared header action slot the moment we switch tabs, before the
  // next tab mounts and injects its own. This keeps one tab's filter/search bar
  // from lingering on another. The newly-mounted page re-injects its action.
  const switchTab = (next) => {
    if (next === tab) return
    setAction(null)
    setTab(next)
  }

  return (
    <div className="rs-memory-hub animate-fade-in">
      <div
        className="rs-memory-hub-tabs"
        role="tablist"
        aria-label="Memory sections"
        style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}
      >
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`rs-pill ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => switchTab(t.key)}
          >
            <span className="material-symbols-rounded">{t.icon}</span>
            <span className="rs-speak-actions-label">{t.label}</span>
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="loading-screen">INITIALIZING...</div>}>
        {tab === 'memory' && <MemoryPage    setAction={setAction} />}
        {tab === 'notes'  && <ChronosPage   setAction={setAction} />}
        {tab === 'docs'   && <DocumentsPage setAction={setAction} />}
      </Suspense>
    </div>
  )
}
