import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion } from '@codemirror/autocomplete'
import { useAuth } from '@context/AuthContext.jsx'
import VaultGraph from '@components/VaultGraph.jsx'

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
  const [viewMode, setViewMode] = useState('notes')   // 'notes' | 'graph'
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] })
  const [graphLoading, setGraphLoading] = useState(false)

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

  const fetchGraph = useCallback(async () => {
    if (!token) return
    setGraphLoading(true)
    try {
      const res = await fetch('/api/vault/graph', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setGraphData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setGraphLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (viewMode === 'graph') fetchGraph()
  }, [viewMode, fetchGraph])

  const loadNote = useCallback(async (path) => {
    setViewMode('notes')
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
        return true
      }
      return false
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setLoading(false)
    }
  }, [token])

  const createNote = useCallback(async (suggestedName = null, targetRoot = null) => {
    const name = suggestedName || window.prompt('NOTE NAME:')
    if (!name) return
    const root = targetRoot || activeRoot
    const path = `${root}/${name.endsWith('.md') ? name : name + '.md'}`
    try {
      const res = await fetch('/api/vault/note', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '# ' + name.replace('.md', '') + '\n\n' })
      })
      if (!res.ok) throw new Error('Failed to create')
      await fetchTree(root)
      loadNote(path)
      setEditMode(true)
    } catch {
      setError('Failed to create.')
    }
  }, [activeRoot, token, fetchTree, loadNote])

  // Cross-page handoff: open a note someone wikilinked from Chat/Briefing.
  useEffect(() => {
    if (!token) return
    let raw
    try { raw = localStorage.getItem('rs-chronos-open') } catch { return }
    if (!raw) return
    try { localStorage.removeItem('rs-chronos-open') } catch {}
    let payload
    try { payload = JSON.parse(raw) } catch { return }
    if (!payload?.title) return
    const root = payload.root || 'personal'
    setActiveRoot(prev => (prev === root ? prev : root))
    const path = `${root}/${payload.title.endsWith('.md') ? payload.title : payload.title + '.md'}`
    ;(async () => {
      const exists = await loadNote(path)
      if (!exists) {
        if (window.confirm(`Note "${payload.title}" does not exist. Create it?`)) {
          await createNote(payload.title, root)
        }
      }
    })()
  }, [token, loadNote, createNote])

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
    <div className="grid grid-cols-1 rail:grid-cols-[260px_1fr_260px] h-full gap-4">
      
      {/* Search Modal */}
      {showQuickSwitcher && (
        <div className="rs-flex rs-items-center rs-justify-center" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }} onClick={() => setShowQuickSwitcher(false)}>
          <div className="rs-card is-elev rs-w-full" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="rs-flex rs-gap-3 rs-items-center" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-3)' }}>
               <span className="material-symbols-rounded">search</span>
               <input autoFocus type="text" className="rs-grow" style={{ all: 'unset' }} placeholder="JUMP TO NOTE..." onChange={handleSearch} />
            </div>
            <div className="rs-mt-3 rs-flex rs-flex-col rs-gap-1">
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
      <div className="rs-card rs-flex rs-flex-col rs-p-3">
        <div className="rs-flex rs-gap-1 rs-mb-4">
          <button className={`rs-pill rs-grow rs-nowrap ${activeRoot === 'personal' ? 'is-active' : ''}`} onClick={() => setActiveRoot('personal')}>PERSONAL</button>
          <button className={`rs-pill rs-grow rs-nowrap ${activeRoot === 'household' ? 'is-active' : ''}`} onClick={() => setActiveRoot('household')}>HOUSEHOLD</button>
          <button className="rs-pill" onClick={createNote} title="New Note">
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>add</span>
          </button>
        </div>
        <div className="rs-grow" style={{ overflowY: 'auto' }}>
          <TreeList items={fileTree} onSelect={loadNote} activePath={activeNote?.path} />
        </div>
      </div>

      {/* Center: Editor/Viewer/Graph */}
      <div className="rs-card rs-flex rs-flex-col" style={{ padding: 0 }}>
        <div className="rs-flex rs-items-center rs-gap-3" style={{ padding: 'var(--rs-space-3) var(--rs-space-5)', borderBottom: '1px solid var(--md-outline-variant)' }}>
          {/* View mode toggle */}
          <div className="rs-flex rs-gap-1">
            <button
              className={`rs-pill ${viewMode === 'notes' ? 'is-active' : ''}`}
              onClick={() => setViewMode('notes')}
              title="Note editor"
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>edit_note</span>
            </button>
            <button
              className={`rs-pill ${viewMode === 'graph' ? 'is-active' : ''}`}
              onClick={() => setViewMode('graph')}
              title="Knowledge graph"
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>hub</span>
            </button>
          </div>

          <div className="rs-card-label rs-grow rs-nowrap rs-clip rs-ellipsis">
            {viewMode === 'graph'
              ? `GRAPH · ${graphData.nodes.filter(n => !n.ghost).length} notes · ${graphData.edges.length} links`
              : (activeNote?.path || 'CHRONOS VAULT')}
          </div>

          {viewMode === 'notes' && activeNote && (
            <div className="rs-flex rs-gap-2">
              <button className="rs-pill" onClick={summarizeNote} disabled={isSummarizing}>
                {isSummarizing ? 'SCRIBING...' : 'AI SUM'}
              </button>
              <button className="rs-pill" onClick={renameNote}>RENAME</button>
              <button className="rs-pill rs-c-error" onClick={deleteNote}>DELETE</button>
              <button className={`rs-pill ${editMode ? 'is-active' : ''}`} onClick={() => setEditMode(!editMode)}>
                {editMode ? 'FINISH' : 'EDIT'}
              </button>
            </div>
          )}

          {viewMode === 'graph' && (
            <button className="rs-pill" onClick={fetchGraph} disabled={graphLoading} title="Refresh graph">
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>refresh</span>
            </button>
          )}
        </div>

        {/* Graph view */}
        {viewMode === 'graph' ? (
          <div className="rs-grow rs-relative">
            {graphLoading ? (
              <div className="rs-flex rs-items-center rs-justify-center rs-h-full">
                <span className="rs-card-meta">LOADING GRAPH...</span>
              </div>
            ) : (
              <VaultGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                activeNodePath={activeNote?.path}
                onNodeClick={(path) => loadNote(path)}
              />
            )}
          </div>
        ) : (

        <div className="rs-grow rs-p-5" style={{ overflowY: 'auto' }}>
          {loading ? (
            <div className="rs-card-meta">RETRIEVING DATA...</div>
          ) : activeNote ? (
            editMode ? (
              <div className="rs-h-full">
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
                        const targetPath = `${activeRoot}/${title}.md`
                        return (
                          <button
                            className="rs-pill rs-type-tiny"
                            style={{ padding: '0 var(--rs-space-2)', height: '1.4rem' }}
                            onClick={async () => {
                              const exists = await loadNote(targetPath)
                              if (!exists) {
                                if (window.confirm(`Note "${title}" does not exist. Create it?`)) {
                                  await createNote(title)
                                }
                              }
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
            )
          ) : (
             <div className="rs-flex rs-items-center rs-justify-center rs-h-full" style={{ opacity: 0.2 }}>
               <span className="material-symbols-rounded" style={{ fontSize: '80px' }}>history</span>
             </div>
          )}
        </div>
        )}
      </div>

      {/* Right Rail: Backlinks */}
      <div className="rs-card rs-p-3">
        <div className="rs-card-label rs-mb-3">BACKLINKS</div>
        <div className="rs-flex rs-flex-col rs-gap-2">
          {backlinks.map(b => (
            <div key={b.virtual_path} className="rs-card is-tappable rs-p-3" onClick={() => loadNote(b.virtual_path)}>
              <div className="rs-card-label rs-type-nano">{b.title}</div>
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
    <div className="rs-flex rs-flex-col rs-gap-1">
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
        <button className="rs-drawer-item rs-drawer-item--compact rs-w-full" onClick={() => setExpanded(!expanded)}>
          <span className="material-symbols-rounded">{expanded ? 'expand_more' : 'chevron_right'}</span>
          <span className="rs-grow rs-text-left">{item.name}</span>
        </button>
        {expanded && <div style={{ paddingLeft: 'var(--rs-space-3)' }}><TreeList items={item.children} onSelect={onSelect} activePath={activePath} /></div>}
      </div>
    )
  }

  return (
    <button className={`rs-drawer-item rs-drawer-item--compact rs-w-full ${isSelected ? 'is-active' : ''}`} onClick={() => onSelect(item.path)}>
      <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>description</span>
      <span className="rs-grow rs-text-left">{item.name.replace(/\.md$/, '')}</span>
    </button>
  )
}
