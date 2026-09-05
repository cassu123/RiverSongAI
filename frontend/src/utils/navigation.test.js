import { describe, it, expect } from 'vitest'
import { ADMIN_PAGES, ALWAYS_VISIBLE, NAV_GROUPS } from './constants.js'

describe('Navigation Constants & Access Gating', () => {
  it('does not restrict home or routines behind adminMode', () => {
    expect(ADMIN_PAGES.has('home')).toBe(false)
    expect(ADMIN_PAGES.has('routines')).toBe(false)
  })

  it('keeps genuine system administration screens in ADMIN_PAGES', () => {
    const expectedAdmin = ['dashboard', 'fleet', 'users', 'killswitch', 'admin_settings', 'remote_ollama', 'webhook_tokens', 'slae']
    expectedAdmin.forEach(page => {
      expect(ADMIN_PAGES.has(page)).toBe(true)
    })
  })

  it('places Home Node in Primary navigation group', () => {
    const primary = NAV_GROUPS.find(g => g.label === 'Primary')
    expect(primary).toBeDefined()
    const homeItem = primary.items.find(i => i.key === 'home')
    expect(homeItem).toBeDefined()
    expect(homeItem.label).toBe('Home Node')
  })

  it('places Routines and Notes in More navigation group, and retires Environment', () => {
    const more = NAV_GROUPS.find(g => g.label === 'More')
    expect(more).toBeDefined()
    const routinesItem = more.items.find(i => i.key === 'routines')
    expect(routinesItem).toBeDefined()
    expect(routinesItem.label).toBe('Routines')

    const notesItem = more.items.find(i => i.key === 'chronos')
    expect(notesItem).toBeDefined()
    expect(notesItem.label).toBe('Notes')

    const envItem = more.items.find(i => i.key === 'environment')
    expect(envItem).toBeUndefined()
  })

  it('places Fleet Console in Admin navigation group', () => {
    const admin = NAV_GROUPS.find(g => g.label === 'Admin')
    expect(admin).toBeDefined()
    const fleetItem = admin.items.find(i => i.key === 'fleet')
    expect(fleetItem).toBeDefined()
    expect(fleetItem.label).toBe('Fleet Console')
  })

  it('preserves core utility pages in ALWAYS_VISIBLE', () => {
    expect(ALWAYS_VISIBLE.has('skills')).toBe(true)
    expect(ALWAYS_VISIBLE.has('briefing')).toBe(true)
    expect(ALWAYS_VISIBLE.has('speak')).toBe(true)
    expect(ALWAYS_VISIBLE.has('chat')).toBe(true)
    expect(ALWAYS_VISIBLE.has('chronos')).toBe(true)
    expect(ALWAYS_VISIBLE.has('documents')).toBe(true)
  })
})
