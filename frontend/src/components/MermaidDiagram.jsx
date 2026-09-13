import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import './MermaidDiagram.css'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
  fontFamily: 'inherit',
  themeVariables: {
    darkMode: true,
    background: '#111827',
    primaryColor: '#0ea5e9',
    primaryTextColor: '#f3f4f6',
    primaryBorderColor: '#38bdf8',
    lineColor: '#94a3b8',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0f172a',
  },
})

export default function MermaidDiagram({ chart, className = '' }) {
  const containerRef = useRef(null)
  const [svgContent, setSvgContent] = useState('')
  const [error, setError] = useState(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`)

  useEffect(() => {
    let isMounted = true
    const renderChart = async () => {
      if (!chart || !chart.trim()) return
      try {
        setError(null)
        const cleanChart = chart.trim()
        const { svg } = await mermaid.render(idRef.current, cleanChart)
        if (isMounted) {
          const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })
          setSvgContent(cleanSvg)
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to render Mermaid diagram')
          console.warn('Mermaid render failed:', err)
        }
      }
    }

    renderChart()
    return () => {
      isMounted = false
    }
  }, [chart])

  if (error) {
    return (
      <div className="rs-mermaid-error">
        <div className="rs-mermaid-error-title">Diagram Render Error</div>
        <pre>{chart}</pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`rs-mermaid-container ${className}`}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  )
}

