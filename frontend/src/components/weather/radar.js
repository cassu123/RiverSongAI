// Where radar frames come from.
//
// US (lower 48): the Iowa Environmental Mesonet's NEXRAD mosaic, the NWS's
// own WSR-88D composite, re-published as map tiles every 5 minutes with past
// frames kept under -mNNm names. Free, no key.
//
// Elsewhere: RainViewer. Since 1 Jan 2026 its free tier serves zoom 7 at
// most, one colour scheme (2, Universal Blue) and no future frames; asking
// for zoom 8, as this page did, returned nothing.

const IEM = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0'
export const RAINVIEWER_MAX_ZOOM = 7

// The NEXRAD mosaic's coverage.
export function inConus(lat, lon) {
  return lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66
}

// Oldest first; the last is now.
export function iemFrames(now = Date.now()) {
  return [50, 40, 30, 20, 10, 0].map(m => ({
    url: `${IEM}/nexrad-n0q-900913${m ? `-m${String(m).padStart(2, '0')}m` : ''}/{z}/{x}/{y}.png`,
    time: now - m * 60_000,
  }))
}

// From https://api.rainviewer.com/public/weather-maps.json.
export function rainviewerFrames(maps, count = 6) {
  const host = maps?.host || 'https://tilecache.rainviewer.com'
  return (maps?.radar?.past || []).slice(-count).map(f => ({
    url: `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
    time: f.time * 1000,
  }))
}
