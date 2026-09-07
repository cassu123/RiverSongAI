import { describe, it, expect } from 'vitest'
import {
  HOUR_METERED_TYPES,
  odometerUnit,
  isServiceDue,
  nextMilestoneLabel,
} from './VehiclePage.jsx'

describe('Hangar odometer units', () => {
  it('meters ATVs, mowers, tractors and generators in hours', () => {
    ;['atv', 'mower', 'tractor', 'generator'].forEach(t => {
      expect(HOUR_METERED_TYPES.has(t)).toBe(true)
      expect(odometerUnit(t)).toBe('HRS')
    })
  })

  it('meters road vehicles in miles', () => {
    ;['auto', 'moto', 'truck', 'other', undefined].forEach(t => {
      expect(odometerUnit(t)).toBe('MI')
    })
  })
})

describe('isServiceDue', () => {
  it('reports nothing due for a vehicle with no recorded odometer', () => {
    expect(isServiceDue(0, [{ due_at_miles: 5000 }])).toBe(false)
  })

  it('reports nothing due when no checkpoints are configured', () => {
    expect(isServiceDue(50000, [])).toBe(false)
  })

  it('flags a fixed target once the odometer reaches it', () => {
    expect(isServiceDue(4999, [{ due_at_miles: 5000 }])).toBe(false)
    expect(isServiceDue(5000, [{ due_at_miles: 5000 }])).toBe(true)
  })

  it('flags a recurring interval within 500 units of a multiple', () => {
    const cp = [{ interval_miles: 5000 }]
    expect(isServiceDue(10200, cp)).toBe(true)   // just past 10,000
    expect(isServiceDue(9600, cp)).toBe(true)    // approaching 10,000
    expect(isServiceDue(7500, cp)).toBe(false)   // mid-interval
  })

  it('does not flag an interval the vehicle has not reached once', () => {
    expect(isServiceDue(300, [{ interval_miles: 5000 }])).toBe(false)
  })
})

describe('nextMilestoneLabel', () => {
  const cps = [{ interval_miles: 5000 }, { due_at_miles: 12000 }]

  it('says NONE SET when the vehicle has no targets', () => {
    expect(nextMilestoneLabel(1000, [])).toBe('NONE SET')
  })

  it('returns the first target above the current reading', () => {
    expect(nextMilestoneLabel(1000, cps)).toBe('5,000 MI')
    expect(nextMilestoneLabel(6000, cps)).toBe('12,000 MI')
  })

  it('never points at a target the vehicle already passed', () => {
    // Regression: this previously fell back to the *lowest* target, showing
    // "5,000 MI" as upcoming for a vehicle sitting at 90,000.
    expect(nextMilestoneLabel(90000, cps)).toBe('ALL PASSED')
  })

  it('carries the vehicle\'s own unit', () => {
    expect(nextMilestoneLabel(10, [{ interval_miles: 50 }], 'HRS')).toBe('50 HRS')
  })
})
