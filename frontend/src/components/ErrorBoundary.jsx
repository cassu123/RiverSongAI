import React from 'react'
import './ErrorBoundary.css'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)
    const stack = this.state.error?.stack || ''

    return (
      <div className="eb-wrap">
        <div className="eb-card">
          <div className="eb-breadcrumb">
            <span>◢</span><span>SYSTEM</span>
            <span className="eb-sep">/</span>
            <span>RENDER FAULT</span>
          </div>
          <div className="eb-title">Page Error</div>
          <div className="eb-msg">{msg}</div>
          {stack && (
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
          <button className="rs-btn-primary eb-btn" onClick={this.reset}>
            ↺ RETRY
          </button>
        </div>
      </div>
    )
  }
}
