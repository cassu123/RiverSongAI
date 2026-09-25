import { describe, it, expect } from 'vitest'
import { wxIcon, compass, pressure, visibility, rangeBar, hourLabel, clockLabel, dayLabel, daylightProgress } from './wx.js'

describe('weather helpers', () => {
  it('gives night skies night icons', () => {
    expect(wxIcon(0, true)).toBe('clear_day')
    expect(wxIcon(0, false)).toBe('clear_night')
    expect(wxIcon(2, false)).toBe('partly_cloudy_night')
    expect(wxIcon(3, false)).toBe('cloud')
    expect(wxIcon(63)).toBe('rainy')
    expect(wxIcon(73)).toBe('weather_snowy')
    expect(wxIcon(95)).toBe('thunderstorm')
  })

  it('names the wind', () => {
    expect(compass(0)).toBe('N')
    expect(compass(200)).toBe('S')
    expect(compass(350)).toBe('N')
    expect(compass(undefined)).toBe('')
  })

  it('converts pressure and visibility to the unit system in use', () => {
    expect(pressure(1016, true)).toEqual({ value: '30.00', unit: 'inHg' })
    expect(pressure(1016, false)).toEqual({ value: '1016', unit: 'hPa' })
    expect(visibility(16000, true)).toEqual({ value: '9.9', unit: 'mi' })
    expect(visibility(24140, false)).toEqual({ value: '24', unit: 'km' })
  })

  it('places a day on the forecast scale', () => {
    expect(rangeBar(60, 80, 50, 90)).toEqual({ left: 25, width: 50 })
    expect(rangeBar(70, 70, 50, 90).width).toBe(4)
  })

  it('reads times as the location gives them', () => {
    expect(hourLabel('2026-09-25T00:00')).toBe('12 AM')
    expect(hourLabel('2026-09-25T14:00')).toBe('2 PM')
    expect(clockLabel('2026-09-25T06:58')).toBe('6:58 AM')
    expect(dayLabel('2026-09-25', 0)).toBe('Today')
    expect(dayLabel('2026-09-26', 1)).toBe('Sat')
  })

  it('knows how far through the day the sun is', () => {
    expect(daylightProgress('2026-09-25T07:00', '2026-09-25T19:00', '2026-09-25T13:00')).toBe(0.5)
    expect(daylightProgress('2026-09-25T07:00', '2026-09-25T19:00', '2026-09-25T21:00')).toBeNull()
  })
})
