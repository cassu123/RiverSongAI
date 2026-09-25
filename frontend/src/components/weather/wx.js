// Small pure helpers for the Weather page.

// WMO weather code → Material Symbols icon, with night versions for the
// clear and partly-cloudy skies (the hourly strip showed suns all night).
export function wxIcon(code, isDay = true) {
  const night = isDay === false
  if (code == null) return night ? 'clear_night' : 'clear_day'
  if (code === 0) return night ? 'clear_night' : 'clear_day'
  if (code <= 2) return night ? 'partly_cloudy_night' : 'partly_cloudy_day'
  if (code === 3) return 'cloud'
  if (code <= 48) return 'foggy'
  if (code <= 55) return 'rainy_light'
  if (code <= 57) return 'weather_mix'
  if (code === 61) return 'rainy_light'
  if (code === 63) return 'rainy'
  if (code === 65) return 'rainy_heavy'
  if (code <= 67) return 'weather_mix'
  if (code === 75) return 'snowing_heavy'
  if (code <= 77) return 'weather_snowy'
  if (code <= 82) return 'rainy'
  if (code <= 86) return 'weather_snowy'
  return 'thunderstorm'
}

export function compass(deg) {
  if (typeof deg !== 'number') return ''
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}

export const round = v => (typeof v === 'number' ? Math.round(v) : null)

// Open-Meteo gives pressure in hPa and visibility in metres whatever the
// temperature unit; show them the way that unit's users read them.
export function pressure(hpa, imperial) {
  if (typeof hpa !== 'number') return null
  return imperial ? { value: (hpa * 0.02953).toFixed(2), unit: 'inHg' } : { value: String(Math.round(hpa)), unit: 'hPa' }
}

export function visibility(m, imperial) {
  if (typeof m !== 'number') return null
  const v = imperial ? m / 1609.344 : m / 1000
  return { value: v >= 10 ? String(Math.round(v)) : v.toFixed(1), unit: imperial ? 'mi' : 'km' }
}

export function uvLabel(uv) {
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Moderate'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very high'
  return 'Extreme'
}

// Where a day's low–high sits on the scale of the whole forecast, as
// percentages for a range bar.
export function rangeBar(lo, hi, min, max) {
  const span = (max - min) || 1
  return { left: ((lo - min) / span) * 100, width: Math.max(((hi - lo) / span) * 100, 4) }
}

// "2026-09-25T14:00" → "2 PM" (the wall clock the forecast was given in).
export function hourLabel(t) {
  const h = Number(t.slice(11, 13))
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

export function clockLabel(t) {
  if (!t) return ''
  const h = Number(t.slice(11, 13)), m = t.slice(14, 16)
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

export function dayLabel(date, i) {
  if (i === 0) return 'Today'
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

// How far through the daylight we are, 0..1, or null at night. Times are
// the location's wall clock, as Open-Meteo gives them.
export function daylightProgress(sunrise, sunset, now) {
  const mins = t => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16))
  if (!sunrise || !sunset || !now) return null
  const p = (mins(now) - mins(sunrise)) / (mins(sunset) - mins(sunrise))
  return p >= 0 && p <= 1 ? p : null
}
