import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import Sheet from './Sheet.jsx'

describe('Sheet', () => {
  afterEach(cleanup)

  // Pages render inside wrappers that keep a transform, which would pin a
  // position:fixed sheet to the page instead of the screen.
  it('renders over the page, not inside it', () => {
    render(
      <div data-testid="page" style={{ transform: 'scale(1)' }}>
        <Sheet open={false} onClose={() => {}} title="Pick">body</Sheet>
      </div>
    )
    const dialog = screen.getByRole('dialog', { hidden: true })
    expect(screen.getByTestId('page').contains(dialog)).toBe(false)
    expect(dialog.parentElement).toBe(document.body)
  })
})
