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
          <button className="rs-btn-primary eb-btn" onClick={this.reset}>
            ↺ RETRY
          </button>
        </div>
      </div>
    )
  }
}
