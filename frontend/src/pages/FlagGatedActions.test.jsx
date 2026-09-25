import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React from 'react'
import ComparePage from './ComparePage.jsx'
import PresetsPage from './PresetsPage.jsx'
import DocumentsPage from './DocumentsPage.jsx'
import RemoteOllamaPage from './RemoteOllamaPage.jsx'
import SkillsPage from './SkillsPage.jsx'
import WebhookTokensPage from './WebhookTokensPage.jsx'

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 'mock-token' }) }))

// A feature that is switched off answers 404; its page shows "Disabled", so
// an action button in the bar would do nothing.
const PAGES = { ComparePage, PresetsPage, DocumentsPage, RemoteOllamaPage, SkillsPage, WebhookTokensPage }

async function lastAction(Page, status) {
  global.fetch = vi.fn(() => Promise.resolve({
    status, ok: status < 400, json: () => Promise.resolve({}),
  }))
  let action
  await act(async () => { render(<Page setAction={el => { action = el }} />) })
  return action
}

describe('flag-gated pages', () => {
  afterEach(cleanup)

  for (const [name, Page] of Object.entries(PAGES)) {
    it(`${name} drops its action while the feature is off`, async () => {
      expect(await lastAction(Page, 404)).toBeNull()
    })
    it(`${name} keeps its action while the feature is on`, async () => {
      expect(await lastAction(Page, 200)).toBeTruthy()
    })
  }
})
