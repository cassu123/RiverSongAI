// =============================================================================
// src/pages/settings/ChatToolsSection.jsx
//
// Admin matrix to view and toggle all capabilities / tools that River can
// execute through voice or live chat. Disabling a tool removes it from the
// active LLM agent loop schema so broken or restricted tools never trigger.
// =============================================================================

import React, { useState, useMemo } from 'react'
import { Section, Toggle } from './shared.jsx'

export default function ChatToolsSection({ data, token, onChanged }) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [saving, setSaving] = useState(false)

  const tools = data?.tools || []
  const disabledList = data?.disabled_tools || []

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(tools.map(t => t.category))
    return ['ALL', ...Array.from(cats).sort()]
  }, [tools])

  // Filter tools based on search and category
  const filteredTools = useMemo(() => {
    return tools.filter(t => {
      const matchCat = selectedCategory === 'ALL' || t.category === selectedCategory
      const query = search.toLowerCase().trim()
      const matchSearch =
        !query ||
        t.name.toLowerCase().includes(query) ||
        t.label.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
      return matchCat && matchSearch
    })
  }, [tools, selectedCategory, search])

  const enabledCount = tools.filter(t => !disabledList.includes(t.name)).length
  const disabledCount = disabledList.length

  const handleToggle = async (toolName, shouldEnable) => {
    let updatedDisabled
    if (shouldEnable) {
      updatedDisabled = disabledList.filter(n => n !== toolName)
    } else {
      updatedDisabled = [...disabledList, toolName]
    }

    const nextData = {
      ...data,
      disabled_tools: updatedDisabled,
      tools: tools.map(t => (t.name === toolName ? { ...t, enabled: shouldEnable } : t)),
    }
    onChanged(nextData)

    setSaving(true)
    try {
      const res = await fetch('/api/admin/chat-tools', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ disabled_tools: updatedDisabled }),
      })
      if (!res.ok) {
        throw new Error(`Failed to save tools (HTTP ${res.status})`)
      }
    } catch (err) {
      console.error('Failed to update tool state:', err)
      onChanged(data) // rollback on failure
    } finally {
      setSaving(false)
    }
  }

  const handleToggleAll = async (enableAll) => {
    const updatedDisabled = enableAll ? [] : tools.map(t => t.name)
    const nextData = {
      ...data,
      disabled_tools: updatedDisabled,
      tools: tools.map(t => ({ ...t, enabled: enableAll })),
    }
    onChanged(nextData)

    setSaving(true)
    try {
      const res = await fetch('/api/admin/chat-tools', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ disabled_tools: updatedDisabled }),
      })
      if (!res.ok) {
        throw new Error(`Failed to save tools (HTTP ${res.status})`)
      }
    } catch (err) {
      console.error('Failed to update all tools:', err)
      onChanged(data) // rollback on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="CHAT & VOICE CAPABILITIES MATRIX">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header Description & Metrics */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p className="rs-card-meta" style={{ margin: 0 }}>
            Configure which skills, integrations, and tools River can access during voice and chat sessions.
            {saving && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>SAVING…</span>}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--rs-status-nominal) 15%, transparent)',
              color: 'var(--rs-status-nominal)',
              border: '1px solid color-mix(in srgb, var(--rs-status-nominal) 30%, transparent)'
            }}>
              {enabledCount} ACTIVE
            </span>
            {disabledCount > 0 && (
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 12,
                background: 'color-mix(in srgb, var(--md-error) 15%, transparent)',
                color: 'var(--md-error)',
                border: '1px solid color-mix(in srgb, var(--md-error) 30%, transparent)'
              }}>
                {disabledCount} DISABLED
              </span>
            )}
          </div>
        </div>

        {/* Search & Bulk Action Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <div style={{
            flex: 1,
            minWidth: 220,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--md-surface-container)',
            border: '1px solid var(--md-outline-variant)',
            borderRadius: 'var(--md-shape-sm)'
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--md-outline)' }}>search</span>
            <input
              type="text"
              placeholder="Search chat & voice tools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                all: 'unset',
                width: '100%',
                fontSize: '0.85rem',
                color: 'var(--md-on-surface)'
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ all: 'unset', cursor: 'pointer', opacity: 0.6 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>close</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="rs-pill"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            onClick={() => handleToggleAll(true)}
          >
            ENABLE ALL
          </button>
          <button
            type="button"
            className="rs-pill"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            onClick={() => handleToggleAll(false)}
          >
            DISABLE ALL
          </button>
        </div>

        {/* Category Filter Chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBlock: 4 }}>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rs-pill ${selectedCategory === cat ? 'is-active' : ''}`}
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Tool Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 4 }}>
          {filteredTools.map(tool => {
            const isEnabled = !disabledList.includes(tool.name)
            return (
              <div
                key={tool.name}
                style={{
                  background: isEnabled ? 'var(--md-surface-container-low)' : 'var(--md-surface-container-lowest)',
                  padding: 14,
                  border: `1px solid ${isEnabled ? 'var(--md-outline-variant)' : 'color-mix(in srgb, var(--md-outline) 20%, transparent)'}`,
                  borderRadius: 'var(--md-shape-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 10,
                  opacity: isEnabled ? 1 : 0.65,
                  transition: 'all 0.15s ease'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '1.25rem', color: isEnabled ? 'var(--primary)' : 'var(--md-outline)' }}>
                        {tool.icon || 'handyman'}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--md-on-surface)' }}>
                        {tool.label}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-mono, monospace)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--md-surface-container)',
                      color: 'var(--md-outline)'
                    }}>
                      {tool.category}
                    </span>
                  </div>

                  <p style={{
                    fontSize: '0.78rem',
                    color: 'var(--md-on-surface-variant)',
                    margin: 0,
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {tool.description}
                  </p>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 8,
                  borderTop: '1px solid color-mix(in srgb, var(--md-outline-variant) 50%, transparent)'
                }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--md-outline)',
                    userSelect: 'all'
                  }}>
                    {tool.name}
                  </span>
                  <Toggle
                    id={`tool-toggle-${tool.name}`}
                    checked={isEnabled}
                    onChange={checked => handleToggle(tool.name, checked)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {filteredTools.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--md-outline)', fontSize: '0.85rem' }}>
            No tools found matching "{search}".
          </div>
        )}
      </div>
    </Section>
  )
}
