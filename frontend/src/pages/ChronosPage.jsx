import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion } from '@codemirror/autocomplete'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * ChronosPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Obsidian-style vault with a futuristic glass layout.
 */

export default function ChronosPage({ setAction }) {
  const { token } = useAuth()
  
  const [activeRoot, setActiveRoot] = useState('personal')
  const [fileTree, setFileTree] = useState([])
  const [activeNote, setActiveNote] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [editorContent, setEditorContent] = useState('')
  const [backlinks, setBacklinks] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  
  const saveTimeoutRef = useRef(null)

  const fetchTree = useCallback(async (root) => {
    try {
      const res = await fetch(`/api/vault/tree?root=${root}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setFileTree(await res.json())
    } catch (err) {
      setError(err.message)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchTree(activeRoot)
  }, [token, activeRoot, fetchTree])

  const loadNote = async (path) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/vault/note?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const { content } = await res.json()
        setActiveNote({ path, content })
        setEditorContent(content)
        setEditMode(false)
        
        const blRes = await fetch(`/api/vault/backlinks?path=${encodeURIComponent(path)}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (blRes.ok) setBacklinks(await blRes.json())
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const createNote = async () => {
    const name = window.prompt('NOTE NAME:')
    if (!name) return
    const path = `${activeRoot}/${name.endsWith('.md') ? name : name + '.md'}`
    try {
      await fetch('/api/vault/note', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '# ' + name.replace('.md', '') + '\n\n' })
      })
      await fetchTree(activeRoot)
      loadNote(path)
    } catch {
      setError('Failed to create.')
    }
  }

  const deleteNote = async () => {
    if (!activeNote || !window.confirm(`Purge "${activeNote.path}"?`)) return
    try {
      const res = await fetch(`/api/vault/note?path=${encodeURIComponent(activeNote.path)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setActiveNote(null)
        fetchTree(activeRoot)
      }
    } catch {
      setError('Failed to delete.')
    }
  }

  const renameNote = async () => {
    if (!activeNote) return
    const newName = window.prompt('NEW NAME:', activeNote.path.split('/').pop())
    if (!newName) return
    const newPath = activeNote.path.split('/').slice(0, -1).concat(newName).join('/')
    try {
      const res = await fetch('/api/vault/note/rename', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: activeNote.path, new: newPath })
      })
      if (res.ok) {
        fetchTree(activeRoot)
        loadNote(newPath)
      }
    } catch {
      setError('Failed to rename.')
    }
  }

  const summarizeNote = async () => {
    if (!activeNote) return
    setIsSummarizing(true)
    try {
      const res = await fetch(`/api/vault/note/summarize?path=${encodeURIComponent(activeNote.path)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const { summary } = await res.json()
        window.alert(`SCRIBE SUMMARY:\n\n${summary}`)
      }
    } catch {
      setError('Failed to summarize.')
    } finally {
      setIsSummarizing(false)
    }
  }

  const saveNote = useCallback(async (content) => {
    if (!activeNote) return
    try {
      await fetch('/api/vault/note', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeNote.path, content })
      })
      setActiveNote(prev => ({ ...prev, content }))
    } catch {}
  }, [activeNote, token])

  const onEditorChange = useCallback((value) => {
    setEditorContent(value)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveNote(value), 1000)
  }, [saveNote])

  const handleSearch = async (e) => {
    const q = e.target.value
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setSearchResults(await res.json())
    } catch {}
  }

  // Hotkey support
  useEffect(() => {
    const handleKD = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowQuickSwitcher(true) }
      if (e.key === 'Escape') setShowQuickSwitcher(false)
    }
    window.addEventListener('keydown', handleKD)
    return () => window.removeEventListener('keydown', handleKD)
  }, [])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 260px', height: '100%', gap: 16 }}>
      
      {/* Search Modal */}
      {showQuickSwitcher && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }} onClick={() => setShowQuickSwitcher(false)}>
          <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 12 }}>
               <span className="material-symbols-rounded">search</span>
               <input autoFocus type="text" style={{ all: 'unset', flex: 1 }} placeholder="JUMP TO NOTE..." onChange={handleSearch} />
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {searchResults.map(r => (
                <button key={r.virtual_path} className="rs-pill" style={{ justifyContent: 'flex-start' }} onClick={() => { loadNote(r.virtual_path); setShowQuickSwitcher(false) }}>
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Left Rail: File Tree */}
      <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', padding: 12 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          <button className={`rs-pill ${activeRoot === 'personal' ? 'is-active' : ''}`} style={{ flex: 1 }} onClick={() => setActiveRoot('personal')}>PERS</button>
          <button className={`rs-pill ${activeRoot === 'household' ? 'is-active' : ''}`} style={{ flex: 1 }} onClick={() => setActiveRoot('household')}>HSE</button>
          <button className="rs-pill" onClick={createNote} title="New Note">
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>add</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <TreeList items={fileTree} onSelect={loadNote} activePath={activeNote?.path} />
        </div>
      </div>

      {/* Center: Editor/Viewer */}
      <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-card-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeNote?.path || 'CHRONOS VAULT'}
          </div>
          {activeNote && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="rs-pill" onClick={summarizeNote} disabled={isSummarizing}>
                {isSummarizing ? 'SCRIBING...' : 'AI SUM'}
              </button>
              <button className="rs-pill" onClick={renameNote}>RENAME</button>
              <button className="rs-pill" onClick={deleteNote} style={{ color: 'var(--md-error)' }}>DELETE</button>
              <button className={`rs-pill ${editMode ? 'is-active' : ''}`} onClick={() => setEditMode(!editMode)}>
                {editMode ? 'FINISH' : 'EDIT'}
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? (
            <div className="rs-card-meta">RETRIEVING DATA...</div>
          ) : activeNote ? (
            editMode ? (
              <div style={{ height: '100%' }}>
                <CodeMirror
                  value={editorContent}
                  height="100%"
                  theme="dark"
                  extensions={[markdown(), autocompletion()]}
                  onChange={onEditorChange}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>
            ) : (
              <div className="rs-markdown">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ node, href, children, ...props }) => {
                      if (href?.startsWith('wikilink:')) {
                        const title = href.replace('wikilink:', '')
                        return <button className="rs-pill" onClick={() => loadNote(`${activeRoot}/${title}.md`)}>{children}</button>
                      }
                      return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
                    }
                  }}
                >
                  {activeNote.content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, title, alias) => {
                    return `[${alias || title}](wikilink:${title})`
                  })}
                </ReactMarkdown>
              </div>
            )
          ) : (
             <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.2 }}>
               <span className="material-symbols-rounded" style={{ fontSize: '80px' }}>history</span>
             </div>
          )}
        </div>
      </div>

      {/* Right Rail: Backlinks */}
      <div className="rs-card" style={{ padding: 12 }}>
        <div className="rs-card-label" style={{ marginBottom: 12 }}>BACKLINKS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {backlinks.map(b => (
            <div key={b.virtual_path} className="rs-card is-tappable" style={{ padding: 12 }} onClick={() => loadNote(b.virtual_path)}>
              <div className="rs-card-label" style={{ fontSize: '0.65rem' }}>{b.title}</div>
            </div>
          ))}
          {backlinks.length === 0 && <div className="rs-card-meta">No references.</div>}
        </div>
      </div>

    </div>
  )
}

function TreeList({ items, onSelect, activePath }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map(item => <TreeItem key={item.path} item={item} onSelect={onSelect} activePath={activePath} />)}
    </div>
  )
}

function TreeItem({ item, onSelect, activePath }) {
  const [expanded, setExpanded] = useState(false)
  const isSelected = activePath === item.path

  if (item.is_dir) {
    return (
      <div>
        <button className="rs-drawer-item rs-drawer-item--compact" style={{ width: '100%' }} onClick={() => setExpanded(!expanded)}>
          <span className="material-symbols-rounded">{expanded ? 'expand_more' : 'chevron_right'}</span>
          <span style={{ flex: 1, textAlign: 'left' }}>{item.name}</span>
        </button>
        {expanded && <div style={{ paddingLeft: 12 }}><TreeList items={item.children} onSelect={onSelect} activePath={activePath} /></div>}
      </div>
    )
  }

  return (
    <button className={`rs-drawer-item rs-drawer-item--compact ${isSelected ? 'is-active' : ''}`} style={{ width: '100%' }} onClick={() => onSelect(item.path)}>
      <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>description</span>
      <span style={{ flex: 1, textAlign: 'left' }}>{item.name.replace(/\.md$/, '')}</span>
    </button>
  )
}
