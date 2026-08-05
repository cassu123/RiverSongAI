import React, { useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

function preprocess(text) {
  if (!text) return ''
  return String(text).replace(WIKILINK_RE, (_m, title, alias) =>
    `[${alias || title}](wikilink:${encodeURIComponent(title.trim())})`
  )
}

export function openVaultNote(title, root = 'personal') {
  try {
    localStorage.setItem('rs-chronos-open', JSON.stringify({
      title,
      root,
      at: Date.now(),
    }))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }))
  } catch {}
}

export default function RsMarkdown({ children, root = 'personal', onNavigate, className = '', inline = false }) {
  const handleWikilinkClick = useCallback((title) => {
    openVaultNote(title, root)
    if (onNavigate) onNavigate('chronos')
  }, [onNavigate, root])

  const components = {
    a: ({ href, children: c, ...rest }) => {
      if (href && href.startsWith('wikilink:')) {
        const title = decodeURIComponent(href.slice('wikilink:'.length))
        return (
          <button
            type="button"
            className="rs-wikilink"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleWikilinkClick(title) }}
            title={`Open "${title}" in CHRONOS`}
          >
            {c}
          </button>
        )
      }
      return <a href={href} target="_blank" rel="noreferrer" {...rest}>{c}</a>
    },
  }

  if (inline) {
    components.p = ({ children: c }) => <>{c}</>
  }

  return (
    <div className={`rs-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {preprocess(children)}
      </ReactMarkdown>
    </div>
  )
}
