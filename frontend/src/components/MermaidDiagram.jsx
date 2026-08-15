import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
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
          setSvgContent(svg)
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
      <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-300 font-mono overflow-x-auto my-2">
        <div className="font-semibold mb-1 text-red-400">Diagram Render Error</div>
        <pre>{chart}</pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`my-3 p-4 bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto shadow-inner flex justify-center items-center ${className}`}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  )
}
