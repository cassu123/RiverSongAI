import { describe, it, expect } from 'vitest'
import { summarizeToolEvents, toolLabel } from './toolActivity.js'

const use = (tool) => ({ type: 'tool_use', tool, input: {} })
const res = (tool, result = 'ok') => ({ type: 'tool_result', tool, result })

describe('summarizeToolEvents', () => {
  it('shows a call as running until its result arrives, then done', () => {
    expect(summarizeToolEvents([use('control_device')])).toEqual([{ key: 'call-0', label: 'Control device', status: 'running' }])
    expect(summarizeToolEvents([use('control_device'), res('control_device')])[0].status).toBe('done')
  })

  it('marks the agent loop\'s error results as failed', () => {
    const timeout = res('find_notes', 'Error: Tool find_notes timed out after 30 seconds.')
    const thrown = res('announce', 'Error executing announce: speaker offline')
    expect(summarizeToolEvents([use('find_notes'), timeout])[0].status).toBe('failed')
    expect(summarizeToolEvents([use('announce'), thrown])[0].status).toBe('failed')
  })

  it('pairs each result with the latest unfinished call of that tool', () => {
    const s = summarizeToolEvents([use('control_device'), res('control_device'), use('control_device')])
    expect(s.map((c) => c.status)).toEqual(['done', 'running'])
  })

  it('keeps only the most recent calls', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].flatMap((t) => [use(t), res(t)])
    expect(summarizeToolEvents(events, 4).map((c) => c.label)).toEqual(['B', 'C', 'D', 'E'])
  })

  it('shows nothing when River has not used a tool', () => {
    expect(summarizeToolEvents([])).toEqual([])
    expect(summarizeToolEvents()).toEqual([])
  })
})

describe('toolLabel', () => {
  it('reads snake_case and dotted names as words', () => {
    expect(toolLabel('create_calendar_event')).toBe('Create calendar event')
    expect(toolLabel('lights.set_brightness')).toBe('Lights set brightness')
  })
})
