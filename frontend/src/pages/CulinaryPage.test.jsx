import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import CulinaryPage from './CulinaryPage.jsx'
import React from 'react'

// Mock dependencies
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'mock-token' })
}))
vi.mock('../components/BarcodeScanner.jsx', () => ({
  default: () => <div>BarcodeScanner Mock</div>
}))

describe('CulinaryPage Hardening Verification', () => {
  const mockRecipes = [
    { id: 'r1', title: 'Chicken Pasta', meal_type: 'Dinner', primary_protein: 'Chicken', rating: 4, ingredients: [], steps: [] },
    { id: 'r2', title: 'Beef Stew', meal_type: 'Dinner', primary_protein: 'Beef', rating: 5, ingredients: [], steps: [] }
  ]

  const mockProposals = [
    { id: 'p1', recipe_id: 'r1', recipe: mockRecipes[0], votes_yes: [], votes_no: [], status: 'pending' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn((url) => {
      if (url.includes('/api/culinary/recipes')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRecipes) })
      if (url.includes('/api/culinary/dinner')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProposals) })
      if (url.includes('/api/culinary/household/equipment')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('filters recipes by protein', async () => {
    let actions;
    const setAction = (el) => { actions = el };
    
    await act(async () => { render(<CulinaryPage setAction={setAction} />) })
    
    expect(screen.getByText('Chicken Pasta')).toBeDefined()
    expect(screen.getByText('Beef Stew')).toBeDefined()

    // Trigger filter change via the Action component
    const filterContainer = render(<div>{actions}</div>)
    const proteinFilter = filterContainer.getByDisplayValue('ALL PROTEINS')
    
    await act(async () => {
      fireEvent.change(proteinFilter, { target: { value: 'Beef' } })
    })

    expect(screen.queryByText('Chicken Pasta')).toBeNull()
    expect(screen.getByText('Beef Stew')).toBeDefined()
  })

  it('handles dinner voting', async () => {
    let actions;
    const setAction = (el) => { actions = el };
    
    await act(async () => { render(<CulinaryPage setAction={setAction} />) })
    
    // Switch to dinner tab
    const tabsContainer = render(<div>{actions}</div>)
    await act(async () => { fireEvent.click(tabsContainer.getByText('DINNER')) })

    expect(screen.getByText('PENDING PROPOSAL')).toBeDefined()
    const approveBtn = screen.getByText('APPROVE')
    
    await act(async () => { fireEvent.click(approveBtn) })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/culinary/dinner/p1/vote'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ vote: 'yes' })
      })
    )
  })

  it('opens recipe detail and enters edit mode', async () => {
    await act(async () => { render(<CulinaryPage setAction={() => {}} />) })
    
    const recipeCard = screen.getByText('Chicken Pasta')
    await act(async () => { fireEvent.click(recipeCard) })

    expect(screen.getByText('PROVISIONS')).toBeDefined()
    const editBtn = screen.getByText('EDIT')
    
    await act(async () => { fireEvent.click(editBtn) })
    
    expect(screen.getByPlaceholderText('RECIPE TITLE')).toBeDefined()
    expect(screen.getByText('SAVE CHANGES')).toBeDefined()
    
    const titleInput = screen.getByPlaceholderText('RECIPE TITLE')
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Updated Pasta' } }) })

    const saveBtn = screen.getByText('SAVE CHANGES')
    await act(async () => { fireEvent.click(saveBtn) })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/culinary/recipes/r1'),
      expect.objectContaining({ method: 'PUT' })
    )
  })
})
