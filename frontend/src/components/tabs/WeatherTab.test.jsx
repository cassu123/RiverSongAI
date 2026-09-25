import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('../weather/RadarMap.jsx', () => ({ default: () => <div data-testid="radar" /> }))
import WeatherTab from './WeatherTab.jsx'

const hourly = Array.from({ length: 48 }, (_, i) => {
  const h = (21 + i) % 24
  return { time: `2026-09-${25 + Math.floor((21 + i) / 24)}T${String(h).padStart(2, '0')}:00`, temperature: 68 - i / 4,
    weathercode: 0, is_day: h >= 7 && h < 19, precip_prob: i === 20 ? 60 : 0 }
})
const WEATHER = {
  current: { temperature: 68, feels_like: 68, condition: 'Clear sky', weathercode: 0, is_day: false,
    wind_speed: 6, wind_direction: 200, wind_gusts: 15, humidity: 68, uv_index: 0, visibility: 16000,
    dew_point: 57, pressure: 1016, unit: '°F', wind_unit: 'mph' },
  hourly,
  daily: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(25 + i).padStart(2, '0')}`, condition: 'Partly cloudy',
    weathercode: 2, temp_max: 78 + i, temp_min: 59, precip_prob_max: i === 1 ? 70 : 0, sunrise: '2026-09-25T06:58', sunset: '2026-09-25T19:02' })),
  minutely: [],
  outlook: 'Rain likely around 5 PM tomorrow.',
  forecast_text: [{ name: 'Tonight', short: 'Clear', detailed: 'Mostly clear, with a low around 59.' },
                  { name: 'Tonight', short: 'Clear', detailed: 'A second period with the same name.' }],
  air_quality: { aqi: 42, label: 'Good', color: '#0c4', source: 'openmeteo' },
  unit: '°F', location_name: 'Jacksonville, Arkansas',
}

async function renderWith(weather = WEATHER, alerts = []) {
  global.fetch = vi.fn(url => {
    const u = String(url)
    const body = u.includes('/settings/page') ? { weather: { lat: 34.87, lon: -92.11, units: 'imperial' } }
      : u.includes('/weather/alerts') ? { alerts } : weather
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  await act(async () => { render(<WeatherTab token="t" active />) })
}

describe('WeatherTab', () => {
  afterEach(cleanup)

  it('says when rain is coming, in a sentence', async () => {
    await renderWith()
    expect(screen.getByText('Rain likely around 5 PM tomorrow.')).toBeTruthy()
  })

  it('shows night skies at night', async () => {
    await renderWith()
    const icons = [...document.querySelectorAll('.rs-wx-hour-icon')].map(e => e.textContent)
    expect(icons[0]).toBe('clear_night')
    expect(icons).toContain('clear_day')
    expect(document.querySelector('.rs-wx-now-icon').textContent).toBe('clear_night')
  })

  it('shows ten days with their rain chance', async () => {
    await renderWith()
    expect(document.querySelectorAll('.rs-wx-day')).toHaveLength(10)
    expect(screen.getByText('10-day forecast')).toBeTruthy()
    expect(screen.getByText('70%')).toBeTruthy()
  })

  it("carries the NWS's words, even when two periods share a name", async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderWith()
    expect(screen.getByText('Mostly clear, with a low around 59.')).toBeTruthy()
    expect(warn.mock.calls.some(c => String(c[0]).includes('same key'))).toBe(false)
    warn.mockRestore()
  })

  it('reads pressure and visibility in the units in use', async () => {
    await renderWith()
    expect(screen.getByText('30.00')).toBeTruthy()
    expect(screen.getByText('9.9')).toBeTruthy()
    expect(screen.getByText('Dew point 57°')).toBeTruthy()
  })

  it('shows the next two hours only when rain is coming', async () => {
    await renderWith()
    expect(screen.queryByText('Next two hours')).toBeNull()
    cleanup()
    await renderWith({ ...WEATHER, minutely: Array.from({ length: 8 }, (_, i) => ({ time: `2026-09-25T21:${String(i * 15 % 60).padStart(2, '0')}`, precipitation: i > 1 ? 0.5 : 0 })) })
    expect(screen.getByText('Next two hours')).toBeTruthy()
  })

  it('opens an alert to its instructions', async () => {
    await renderWith(WEATHER, [{ id: 'a', event: 'Heat Advisory', severity: 'Moderate', description: 'Heat index to 108.',
      instruction: 'Drink plenty of fluids.', expires: '2026-09-26T20:00:00-05:00' }])
    expect(screen.getByText('Heat Advisory')).toBeTruthy()
    expect(screen.getByText('Drink plenty of fluids.')).toBeTruthy()
  })
})
