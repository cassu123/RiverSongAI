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
      <div className="rs-flex rs-flex-col rs-gap-4">
        {/* Header Description & Metrics */}
        <div className="rs-flex rs-flex-wrap rs-items-center rs-justify-between rs-gap-3">
          <p className="rs-card-meta rs-m-0">
            Configure which skills, integrations, and tools River can access during voice and chat sessions.
            {saving && <span className="rs-c-accent" style={{ marginLeft: 'var(--rs-space-2)' }}>SAVING…</span>}
          </p>
          <div className="rs-flex rs-items-center rs-gap-2">
            <span className="rs-type-micro rs-fw-700 rs-c-nominal" style={{
              padding: '3px 10px',
              borderRadius: 'var(--md-shape-md)',
              background: 'color-mix(in srgb, var(--rs-status-nominal) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--rs-status-nominal) 30%, transparent)',
            }}>
              {enabledCount} ACTIVE
            </span>
            {disabledCount > 0 && (
              <span className="rs-type-micro rs-fw-700 rs-c-error" style={{
                padding: '3px 10px',
                borderRadius: 'var(--md-shape-md)',
                background: 'color-mix(in srgb, var(--md-error) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--md-error) 30%, transparent)',
              }}>
                {disabledCount} DISABLED
              </span>
            )}
          </div>
        </div>

        {/* Search & Bulk Action Bar */}
        <div className="rs-flex rs-flex-wrap rs-items-center rs-gap-3 rs-mt-1">
          <div className="rs-grow rs-flex rs-items-center rs-gap-2" style={{
            minWidth: 220,
            padding: 'var(--rs-space-2) var(--rs-space-3)',
            background: 'var(--md-surface-container)',
            border: '1px solid var(--md-outline-variant)',
            borderRadius: 'var(--md-shape-sm)',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--md-outline)' }}>search</span>
            <input
              type="text"
              placeholder="Search chat & voice tools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rs-w-full rs-type-tiny" style={{
                all: 'unset',
                color: 'var(--md-on-surface)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="rs-pointer" style={{ all: 'unset', opacity: 0.6 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>close</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="rs-pill rs-type-micro"
            style={{ padding: 'var(--rs-space-2) var(--rs-space-3)' }}
            onClick={() => handleToggleAll(true)}
          >
            ENABLE ALL
          </button>
          <button
            type="button"
            className="rs-pill rs-type-micro"
            style={{ padding: 'var(--rs-space-2) var(--rs-space-3)' }}
            onClick={() => handleToggleAll(false)}
          >
            DISABLE ALL
          </button>
        </div>

        {/* Category Filter Chips */}
        <div className="rs-flex rs-gap-2 rs-flex-wrap" style={{ marginBlock: 'var(--rs-space-1)' }}>
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rs-pill ${selectedCategory === cat ? 'is-active' : ''}`}
              style={{ fontSize: 'var(--rs-fs-micro)', padding: 'var(--rs-space-1) var(--rs-space-3)' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Tool Cards Grid */}
        <div className="rs-gap-3 rs-mt-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filteredTools.map(tool => {
            const isEnabled = !disabledList.includes(tool.name)
            return (
              <div
                key={tool.name}
                className="rs-p-4 rs-flex rs-flex-col rs-justify-between rs-gap-3" style={{
                  background: isEnabled ? 'var(--md-surface-container-low)' : 'var(--md-surface-container-lowest)',
                  border: `1px solid ${isEnabled ? 'var(--md-outline-variant)' : 'color-mix(in srgb, var(--md-outline) 20%, transparent)'}`,
                  borderRadius: 'var(--md-shape-md)',
                  opacity: isEnabled ? 1 : 0.65,
                  transition: 'all 0.15s ease',
                }}
              >
                <div>
                  <div className="rs-flex rs-items-center rs-justify-between rs-mb-2">
                    <div className="rs-flex rs-items-center rs-gap-2">
                      <span className="material-symbols-rounded" style={{ fontSize: '1.25rem', color: isEnabled ? 'var(--primary)' : 'var(--md-outline)' }}>
                        {tool.icon || 'handyman'}
                      </span>
                      <span className="rs-type-small rs-fw-600" style={{ color: 'var(--md-on-surface)' }}>
                        {tool.label}
                      </span>
                    </div>
                    <span className="rs-type-nano" style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      padding: '2px 6px',
                      borderRadius: 'var(--md-shape-xs)',
                      background: 'var(--md-surface-container)',
                      color: 'var(--md-outline)',
                    }}>
                      {tool.category}
                    </span>
                  </div>

                  <p className="rs-m-0 rs-type-micro rs-clip" style={{
                    color: 'var(--md-on-surface-variant)',
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}>
                    {tool.description}
                  </p>
                </div>

                <div className="rs-flex rs-items-center rs-justify-between" style={{
                  paddingTop: 'var(--rs-space-2)',
                  borderTop: '1px solid color-mix(in srgb, var(--md-outline-variant) 50%, transparent)',
                }}>
                  <span className="rs-type-micro" style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--md-outline)',
                    userSelect: 'all',
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
          <div className="rs-p-5 rs-text-center rs-type-tiny" style={{ color: 'var(--md-outline)' }}>
            No tools found matching "{search}".
          </div>
        )}
      </div>
    </Section>
  )
}
