import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'
import SlaePage from './SlaePage.jsx'

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'mock-token' }) }))

// What a server with Langfuse and Graphiti switched off, and nothing run yet,
// sends back. Langfuse's link is always filled from settings.
const OFF = {
  agent_roles: { status: 'healthy', message: '1 roles registered.', roles: [
    { name: 'coder', provider: 'ollama', model: 'qwen2.5-coder:7b', temperature: 0.2, json_mode: false, last_invocation: null },
  ] },
  langfuse: { status: 'disabled', message: 'Set LANGFUSE_ENABLED=true…', dashboard_url: 'http://localhost:3000', recent_traces: [] },
  graphiti: { status: 'disabled', message: 'Set GRAPHITI_ENABLED=true…', neo4j_browser_url: 'http://localhost:7474', node_count: 0, edge_count: 0 },
  recent_activity: { status: 'idle', message: 'No agent activity yet. Run a daemon or have a conversation to populate the feed.', events: [] },
}

async function renderWith(data) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) }))
  await act(async () => { render(<SlaePage setAction={() => {}} />) })
}

describe('SlaePage', () => {
  afterEach(cleanup)

  it('offers no links into services that are switched off', async () => {
    await renderWith(OFF)
    expect(screen.queryByText(/OPEN DASHBOARD/)).toBeNull()
    expect(screen.queryByText(/OPEN NEO4J BROWSER/)).toBeNull()
  })

  it('keeps the links once the services are on', async () => {
    await renderWith({ ...OFF,
      langfuse: { ...OFF.langfuse, status: 'healthy' },
      graphiti: { ...OFF.graphiti, status: 'healthy' },
    })
    expect(screen.getByText(/OPEN DASHBOARD/)).toBeTruthy()
    expect(screen.getByText(/OPEN NEO4J BROWSER/)).toBeTruthy()
  })

  it('says a quiet feed once, as idle', async () => {
    await renderWith(OFF)
    expect(screen.getByText('IDLE')).toBeTruthy()
    expect(screen.queryByText('NOT CONFIGURED')).toBeNull()
    expect(screen.queryByText('No events yet.')).toBeNull()
    expect(screen.getByText(/No agent activity yet/)).toBeTruthy()
  })

  it('keeps a model name in one piece', async () => {
    await renderWith(OFF)
    expect(screen.getByText('ollama/qwen2.5-coder:7b').style.whiteSpace).toBe('nowrap')
  })
})
