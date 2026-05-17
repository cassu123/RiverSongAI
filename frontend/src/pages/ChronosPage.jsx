import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion } from '@codemirror/autocomplete'
import { useAuth } from '../context/AuthContext.jsx'
import './ChronosPage.css'

// ── Material Symbol component ────────────────────────────────────────────────
function MdIcon({ name, size = 20, style }) {
  return (
    <span
      className="material-symbols-rounded"
      style={{
        fontSize: size,
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {name}
    </span>
  )
}

export default function ChronosPage() {
  const { token, user } = useAuth()
  
  const [activeRoot, setActiveRoot] = useState('personal')
  const [fileTree, setFileTree] = useState([])
  const [activeNote, setActiveNote] = useState(null) // { path, content }
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
      if (!res.ok) throw new Error('Failed to fetch tree')
      const data = await res.json()
      setFileTree(data)
    } catch (err) {
      console.error(err)
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
      if (!res.ok) throw new Error('Failed to load note')
      const { content } = await res.json()
      setActiveNote({ path, content })
      setEditorContent(content)
      setEditMode(false)
      
      // Load backlinks
      const blRes = await fetch(`/api/vault/backlinks?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (blRes.ok) {
        const blData = await blRes.json()
        setBacklinks(blData)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const createNote = async () => {
    const name = window.prompt('Note name (e.g. "My Ideas.md"):')
    if (!name) return
    const path = `${activeRoot}/${name.endsWith('.md') ? name : name + '.md'}`
    try {
      await fetch('/api/vault/note', {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path, content: '# ' + name.replace('.md', '') + '\n\n' })
      })
      await fetchTree(activeRoot)
      loadNote(path)
    } catch (err) {
      setError('Failed to create note.')
    }
  }

  const deleteNote = async () => {
    if (!activeNote) return
    if (!window.confirm(`Delete "${activeNote.path}"?`)) return
    try {
      const res = await fetch(`/api/vault/note?path=${encodeURIComponent(activeNote.path)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error()
      setActiveNote(null)
      fetchTree(activeRoot)
    } catch (err) {
      setError('Failed to delete note.')
    }
  }

  const renameNote = async () => {
    if (!activeNote) return
    const newName = window.prompt('New name (including .md):', activeNote.path.split('/').pop())
    if (!newName) return
    const newPath = activeNote.path.split('/').slice(0, -1).concat(newName).join('/')
    try {
      const res = await fetch('/api/vault/note/rename', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ old: activeNote.path, new: newPath })
      })
      if (!res.ok) throw new Error()
      fetchTree(activeRoot)
      loadNote(newPath)
    } catch (err) {
      setError('Failed to rename note.')
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
      if (!res.ok) throw new Error()
      const { summary } = await res.json()
      window.alert(`AI SUMMARY:\n\n${summary}`)
    } catch (err) {
      setError('Failed to summarize note.')
    } finally {
      setIsSummarizing(false)
    }
  }

  const saveNote = useCallback(async (content) => {
    if (!activeNote) return
    try {
      await fetch('/api/vault/note', {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: activeNote.path, content })
      })
      setActiveNote(prev => ({ ...prev, content }))
    } catch (err) {
      console.error('Save failed:', err)
    }
  }, [activeNote, token])

  const onEditorChange = useCallback((value) => {
    setEditorContent(value)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveNote(value), 1000)
  }, [saveNote])

  const completionSource = useCallback(async (context) => {
    const word = context.matchBefore(/\[\[[^\]]*$/)
    if (!word) return null
    
    const query = word.text.slice(2)
    if (query.length < 2) return null

    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        return {
          from: word.from + 2,
          options: data.map(r => ({ label: r.title, type: "variable" })),
          filter: false
        }
      }
    } catch (err) {
      console.error(err)
    }
    return null
  }, [token])

  const handleSearch = async (e) => {
    const q = e.target.value
    setSearchQuery(q)
    if (q.length < 2) {
      setSearchResults([])
      return
    }
    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Quick Switcher hotkey
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowQuickSwitcher(true)
      }
      if (e.key === 'Escape') {
        setShowQuickSwitcher(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="chronos-page">
      {showQuickSwitcher && (
        <div className="chronos-modal-overlay" onClick={() => setShowQuickSwitcher(false)}>
          <div className="chronos-quick-switcher card" onClick={e => e.stopPropagation()}>
            <div className="qs-header">
              <MdIcon name="search" size={18} />
              <input 
                autoFocus 
                type="text" 
                placeholder="Find note..." 
                onChange={handleSearch}
              />
            </div>
            <div className="qs-results">
              {searchResults.map(r => (
                <div key={r.virtual_path} className="qs-item" onClick={() => { loadNote(r.virtual_path); setShowQuickSwitcher(false); setSearchResults([]) }}>
                  <MdIcon name="description" size={16} />
                  <span>{r.title}</span>
                </div>
              ))}
              {searchResults.length === 0 && searchQuery && <div className="qs-empty">No notes found.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar: Tree */}
      <div className="chronos-sidebar">
        <div className="chronos-root-selector">
          <button className={activeRoot === 'personal' ? 'active' : ''} onClick={() => setActiveRoot('personal')}>PERSONAL</button>
          <button className={activeRoot === 'household' ? 'active' : ''} onClick={() => setActiveRoot('household')}>HOUSEHOLD</button>
          <button className="chronos-new-btn" onClick={createNote} title="New Note">
            <MdIcon name="add" size={18} />
          </button>
        </div>
        <div className="chronos-tree">
          <TreeList items={fileTree} onSelect={loadNote} activePath={activeNote?.path} />
        </div>
      </div>

      {/* Main Content */}
      <div className="chronos-main">
        <div className="chronos-topbar">
          <div className="chronos-search-wrap">
            <MdIcon name="search" size={18} style={{ color: 'var(--md-outline)' }} />
            <input 
              type="text" 
              placeholder="Search vault (Ctrl+K)..." 
              value={searchQuery}
              onChange={handleSearch}
              onFocus={() => setShowQuickSwitcher(true)}
            />
          </div>
          <div style={{ flex: 1 }} />
          {activeNote && (
            <div className="chronos-topbar-actions">
              <button 
                className={`btn btn--ghost btn--xs ${isSummarizing ? 'loading' : ''}`} 
                onClick={summarizeNote} 
                disabled={isSummarizing}
              >
                {isSummarizing ? 'THINKING...' : 'AI SUMMARY'}
              </button>
              <button className="btn btn--ghost btn--xs" onClick={renameNote}>RENAME</button>
              <button className="btn btn--ghost btn--xs color-error" onClick={deleteNote}>DELETE</button>
              <button className={`btn btn--ghost btn--xs ${editMode ? 'btn--primary' : ''}`} onClick={() => setEditMode(!editMode)}>
                {editMode ? 'FINISH' : 'EDIT'}
              </button>
            </div>
          )}
        </div>

        <div className="chronos-content-wrap">
          {activeNote ? (
            <div className="chronos-viewer animate-fade-in">
              <div className="chronos-note-header">
                <div className="chronos-note-path">{activeNote.path}</div>
              </div>
              
              {editMode ? (
                <div className="chronos-editor">
                  <CodeMirror
                    value={editorContent}
                    height="100%"
                    theme="dark"
                    extensions={[
                      markdown(),
                      autocompletion({ override: [completionSource] })
                    ]}
                    onChange={onEditorChange}
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                    }}
                  />
                </div>
              ) : (
                <div className="chronos-markdown">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node, href, children, ...props }) => {
                        if (href?.startsWith('wikilink:')) {
                          const title = href.replace('wikilink:', '')
                          return (
                            <button 
                              className="chronos-wikilink" 
                              onClick={() => {
                                setSearchQuery(title)
                                fetch(`/api/vault/search?q=${encodeURIComponent(title)}`, {
                                  headers: { Authorization: `Bearer ${token}` }
                                }).then(r => r.json()).then(data => {
                                  setSearchResults(data)
                                  if (data.length === 1) {
                                    loadNote(data[0].virtual_path)
                                  } else if (data.length === 0) {
                                    if (window.confirm(`Note "${title}" does not exist. Create it?`)) {
                                      const path = `${activeRoot}/${title}.md`
                                      fetch('/api/vault/note', {
                                        method: 'PUT',
                                        headers: { 
                                          'Authorization': `Bearer ${token}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({ path, content: '# ' + title + '\n\n' })
                                      }).then(res => {
                                        if (res.ok) {
                                          fetchTree(activeRoot)
                                          loadNote(path)
                                        }
                                      })
                                    }
                                  }
                                })
                              }}
                            >
                              {children}
                            </button>
                          )
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
              )}
            </div>
          ) : (
            <div className="chronos-empty">
              <MdIcon name="history" size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
              <p>Select a note to read or start searching.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Backlinks */}
      <div className="chronos-right">
        <div className="chronos-panel-title">BACKLINKS</div>
        <div className="chronos-backlinks">
          {backlinks.length > 0 ? (
            backlinks.map(b => (
              <div key={b.virtual_path} className="chronos-backlink-item card" onClick={() => loadNote(b.virtual_path)}>
                {b.title}
              </div>
            ))
          ) : (
            <div className="chronos-panel-empty">No backlinks found.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function TreeList({ items, onSelect, activePath }) {
  return (
    <ul className="tree-list">
      {items.map(item => (
        <TreeItem key={item.path} item={item} onSelect={onSelect} activePath={activePath} />
      ))}
    </ul>
  )
}

function TreeItem({ item, onSelect, activePath }) {
  const [expanded, setExpanded] = useState(false)
  const isSelected = activePath === item.path

  if (item.is_dir) {
    return (
      <li className="tree-node">
        <div className="tree-label" onClick={() => setExpanded(!expanded)}>
          <MdIcon name={expanded ? 'expand_more' : 'chevron_right'} size={18} />
          <MdIcon name="folder" size={18} style={{ marginRight: 6, color: 'var(--md-primary)' }} />
          {item.name}
        </div>
        {expanded && <TreeList items={item.children} onSelect={onSelect} activePath={activePath} />}
      </li>
    )
  }

  return (
    <li className={`tree-leaf ${isSelected ? 'selected' : ''}`} onClick={() => onSelect(item.path)}>
      <MdIcon name="description" size={18} style={{ marginRight: 6, opacity: 0.6 }} />
      {item.name.replace(/\.md$/, '')}
    </li>
  )
}
