import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import CulinaryPage from './CulinaryPage.jsx'
import React from 'react'

// Mock dependencies
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'mock-token' })
}))
vi.mock('../chrome/Sheet', () => ({
  default: ({ children, open }) => open ? <div>{children}</div> : null
}))
vi.mock('../components/BarcodeScanner.jsx', () => ({
  default: () => <div>BarcodeScanner Mock</div>
}))

describe('CulinaryPage Restoration Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn((url) => {
      if (url.includes('/api/culinary/recipes')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('renders with corrected Culinary branding', async () => {
    await act(async () => {
      render(<CulinaryPage setAction={() => {}} />)
    })
    expect(screen.getByText('Culinary')).toBeDefined()
  })

  it('contains the restored Menu, Dinner, Stock, Prep tabs', async () => {
    let actions;
    const setAction = (el) => { actions = el };
    
    await act(async () => {
      render(<CulinaryPage setAction={setAction} />)
    })

    expect(actions).toBeDefined()
    // The tabs are rendered inside setAction
    render(<div>{actions}</div>)
    expect(screen.getByText('MENU')).toBeDefined()
    expect(screen.getByText('DINNER')).toBeDefined()
    expect(screen.getByText('STOCK')).toBeDefined()
    expect(screen.getByText('PREP')).toBeDefined()
    expect(screen.getByText('HARDWARE')).toBeDefined()
  })

  it('renders category and protein filters in the library tab', async () => {
    let actions;
    const setAction = (el) => { actions = el };
    
    await act(async () => {
      render(<CulinaryPage setAction={setAction} />)
    })

    render(<div>{actions}</div>)
    expect(screen.getByText('ALL TYPES')).toBeDefined()
    expect(screen.getByText('ALL PROTEINS')).toBeDefined()
  })
})
