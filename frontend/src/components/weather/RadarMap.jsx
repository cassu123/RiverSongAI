import React, { useEffect, useRef, useState } from 'react'
import { inConus, iemFrames, rainviewerFrames, RAINVIEWER_MAX_ZOOM } from './radar.js'

const STEP_MS = 650       // between frames
const HOLD_MS = 2000      // on the latest frame before looping
const REFRESH_MS = 5 * 60_000

function prefersStill() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Animated radar loop centred on the user, with a dot where they are.
 * NEXRAD over the lower 48, RainViewer elsewhere (see radar.js).
 */
export default function RadarMap({ lat, lon }) {
  const boxRef    = useRef(null)
  const mapRef    = useRef(null)
  const layersRef = useRef([])
  const [source, setSource]   = useState(null)   // 'nexrad' | 'rainviewer'
  const [frames, setFrames]   = useState([])
  const [idx, setIdx]         = useState(0)
  const [playing, setPlaying] = useState(() => !prefersStill())

  // Which frames, refreshed every five minutes.
  useEffect(() => {
    if (lat == null || lon == null) return
    let cancelled = false
    const load = () => {
      if (inConus(lat, lon)) {
        setSource('nexrad')
        // The five-minute bucket keeps "now" from being served from the
        // browser's cache after the mosaic has moved on.
        const bucket = Math.floor(Date.now() / REFRESH_MS)
        setFrames(iemFrames().map(f => ({ ...f, url: `${f.url}?v=${bucket}` })))
        return
      }
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(r => r.json())
        .then(maps => {
          if (cancelled) return
          setSource('rainviewer')
          setFrames(rainviewerFrames(maps))
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [lat, lon])

  // The map itself.
  useEffect(() => {
    if (!boxRef.current || !source || lat == null || lon == null) return
    let disposed = false
    import('leaflet').then(L => {
      if (disposed || mapRef.current) return
      const map = L.map(boxRef.current, {
        center: [lat, lon],
        zoom: source === 'rainviewer' ? RAINVIEWER_MAX_ZOOM : 8,
        maxZoom: 10,
        zoomControl: false,
        attributionControl: false,
        // A one-finger drag on a phone should scroll the page, not the map;
        // pinch still zooms.
        dragging: !L.Browser.mobile,
        scrollWheelZoom: false,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        className: 'rs-wx-basemap',
      }).addTo(map)
      L.circleMarker([lat, lon], { radius: 5, className: 'rs-wx-here', interactive: false }).addTo(map)
      mapRef.current = map
      setFrames(f => [...f])   // lay the frames onto the new map
    })
    return () => {
      disposed = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        layersRef.current = []
      }
    }
  }, [lat, lon, source])

  // One tile layer per frame, all loaded, only one visible.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !frames.length) return
    let disposed = false
    import('leaflet').then(L => {
      if (disposed || !mapRef.current) return
      layersRef.current.forEach(l => map.removeLayer(l))
      layersRef.current = frames.map(f => L.tileLayer(f.url, {
        opacity: 0,
        className: 'rs-wx-echo',
        maxNativeZoom: source === 'rainviewer' ? RAINVIEWER_MAX_ZOOM : 10,
        maxZoom: 10,
      }).addTo(map))
      setIdx(frames.length - 1)
    })
    return () => { disposed = true }
  }, [frames, source])

  useEffect(() => {
    layersRef.current.forEach((l, i) => l.setOpacity(i === idx ? 0.85 : 0))
  }, [idx, frames])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const last = idx === frames.length - 1
    const t = setTimeout(() => setIdx(i => (i + 1) % frames.length), last ? HOLD_MS : STEP_MS)
    return () => clearTimeout(t)
  }, [playing, idx, frames.length])

  const frame = frames[idx]
  return (
    <div className="rs-wx-radar">
      <div ref={boxRef} className="rs-wx-map" />
      {frame && (
        <div className="rs-wx-radar-bar">
          <button
            className="rs-wx-radar-play"
            onClick={() => setPlaying(p => !p)}
            aria-label={playing ? 'Pause radar loop' : 'Play radar loop'}
          >
            <span className="material-symbols-rounded" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
          </button>
          <div className="rs-wx-radar-steps" aria-hidden="true">
            {frames.map((_, i) => <span key={i} className={i === idx ? 'is-on' : ''} />)}
          </div>
          <span className="rs-wx-radar-time">{idx === frames.length - 1 ? `Latest · ${clock(frame.time)}` : clock(frame.time)}</span>
        </div>
      )}
      <div className="rs-wx-attrib">
        {source === 'rainviewer' ? 'RainViewer' : 'NWS NEXRAD via Iowa Environmental Mesonet'} · CARTO · OpenStreetMap
      </div>
    </div>
  )
}
