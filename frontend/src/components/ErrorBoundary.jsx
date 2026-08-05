import React from 'react'
import './ErrorBoundary.css'

/**
 * A lazily-imported page chunk failed to load. This is almost always a stale
 * deploy: the running app shell references chunk filenames (content hashes)
 * that a newer build has since replaced on the server, so the import 404s.
 * A hard reload pulls the fresh index.html (served no-cache) + new chunks.
 */
function isChunkLoadError(error) {
  const msg = (error && (error.message || String(error))) || ''
  return (
    error?.name === 'ChunkLoadError' ||
    /dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    (/failed to fetch/i.test(msg) && /\.js/i.test(msg))
  )
}

// Timestamp of our last auto-reload. If we reloaded within this window and the
// chunk STILL won't load, it's a genuine failure (not staleness) — stop
// reloading and show the manual UI instead of looping forever.
const RELOAD_TS = 'rs-chunk-reload-ts'
const RELOAD_WINDOW_MS = 10_000

function shouldAutoReload() {
  try {
    const prev = Number(sessionStorage.getItem(RELOAD_TS) || 0)
    if (Date.now() - prev < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_TS, String(Date.now()))
    return true
  } catch {
    return false // storage blocked — don't risk a reload loop
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, chunkError: false }
  }

  static getDerivedStateFromError(error) {
    return { error, chunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    // Stale-deploy chunk error: auto-reload once to fetch the fresh shell.
    if (isChunkLoadError(error) && shouldAutoReload()) {
      window.location.reload()
    }
  }

  hardReload = () => window.location.reload()

  reset = () => this.setState({ error: null, chunkError: false })

  render() {
    if (!this.state.error) return this.props.children

    const { chunkError } = this.state
    const msg = chunkError
      ? 'A new version was deployed. Reloading to pick it up…'
      : (this.state.error?.message || String(this.state.error))
    const stack = this.state.error?.stack || ''

    return (
      <div className="eb-wrap">
        <div className="eb-card">
          <div className="eb-breadcrumb">
            <span>◢</span><span>SYSTEM</span>
            <span className="eb-sep">/</span>
            <span>{chunkError ? 'UPDATE AVAILABLE' : 'RENDER FAULT'}</span>
          </div>
          <div className="eb-title">{chunkError ? 'New Version' : 'Page Error'}</div>
          <div className="eb-msg">{msg}</div>
          {!chunkError && stack && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                marginTop: 12,
                padding: 10,
                fontSize: '0.7rem',
                lineHeight: 1.4,
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                maxHeight: 240,
                overflow: 'auto',
                opacity: 0.85,
                textAlign: 'left',
              }}
            >
              {stack.split('\n').slice(0, 10).join('\n')}
            </pre>
          )}
          <button
            className="rs-btn-primary eb-btn"
            onClick={chunkError ? this.hardReload : this.reset}
          >
            ↺ {chunkError ? 'RELOAD' : 'RETRY'}
          </button>
        </div>
      </div>
    )
  }
}
