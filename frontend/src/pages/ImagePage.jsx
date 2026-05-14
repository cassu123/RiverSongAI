import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './ImagePage.css'

export default function ImagePage() {
  const { token } = useAuth()
  
  const [prompt, setPrompt] = useState('')
  const [negPrompt, setNegPrompt] = useState('low quality, blurry, distorted')
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [steps, setSteps] = useState(20)
  
  const [loading, setLoading] = useState(false)
  const [imageUrl, setImageUrl] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const handleGenerate = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return
    
    setLoading(true)
    setError(null)
    setImageUrl(null)
    
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negative_prompt: negPrompt,
          width,
          height,
          steps
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Generation failed')
      }
      
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setImageUrl(url)
      setHistory(prev => [{ url, prompt: prompt.trim(), date: new Date().toISOString() }, ...prev].slice(0, 10))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-wrap image-page-wrap">
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>VISUALS</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>STABLE DIFFUSION</span>
          </div>
          <h1 className="page-title">Dreamscape</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            Generate local AI images.
          </div>
        </div>
      </div>

      <div className="image-layout">
        <div className="image-sidebar">
          <form className="card image-form" onSubmit={handleGenerate}>
            <div className="card-title">GENERATION PARAMETERS</div>
            
            <div className="im-field">
              <label>PROMPT</label>
              <textarea 
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="A cosmic owl guarding a library of stars..."
                rows={4}
                required
              />
            </div>

            <div className="im-field">
              <label>NEGATIVE PROMPT</label>
              <textarea 
                value={negPrompt}
                onChange={e => setNegPrompt(e.target.value)}
                placeholder="Deformed, ugly..."
                rows={2}
              />
            </div>

            <div className="im-row">
              <div className="im-field">
                <label>WIDTH</label>
                <select value={width} onChange={e => setWidth(Number(e.target.value))}>
                  <option value={256}>256</option>
                  <option value={512}>512</option>
                  <option value={768}>768</option>
                  <option value={1024}>1024</option>
                </select>
              </div>
              <div className="im-field">
                <label>HEIGHT</label>
                <select value={height} onChange={e => setHeight(Number(e.target.value))}>
                  <option value={256}>256</option>
                  <option value={512}>512</option>
                  <option value={768}>768</option>
                  <option value={1024}>1024</option>
                </select>
              </div>
            </div>

            <div className="im-field">
              <label>STEPS: {steps}</label>
              <input 
                type="range" min={1} max={50} 
                value={steps} 
                onChange={e => setSteps(Number(e.target.value))} 
              />
            </div>

            <button className="btn btn--cta im-submit" type="submit" disabled={loading}>
              {loading ? 'DREAMING...' : 'GENERATE IMAGE'}
            </button>

            {error && (
              <div className="im-error">
                <span className="dot dot--warn" /> {error}
              </div>
            )}
          </form>

          {history.length > 0 && (
            <div className="card im-history">
              <div className="card-title">RECENT DREAMS</div>
              <div className="im-history-grid">
                {history.map((item, i) => (
                  <div key={i} className="im-history-item" onClick={() => setImageUrl(item.url)}>
                    <img src={item.url} alt="History" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="image-main">
          <div className="card im-preview-card">
            {imageUrl ? (
              <div className="im-result animate-fade-in">
                <img src={imageUrl} alt="Generated" />
                <div className="im-download">
                  <a href={imageUrl} download={`river-dream-${Date.now()}.png`} className="btn btn--ghost">DOWNLOAD</a>
                </div>
              </div>
            ) : loading ? (
              <div className="im-loading">
                <div className="im-spinner" />
                <span>CHANNELING LATENT SPACE...</span>
              </div>
            ) : (
              <div className="im-placeholder">
                <span className="material-symbols-rounded">image</span>
                <p>Your imagination will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
