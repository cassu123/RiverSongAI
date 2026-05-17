import React, { useEffect, useState, useMemo } from 'react'
import './preview.css'
import PreviewShell from './PreviewShell.jsx'
import PreviewDrawer from './PreviewDrawer.jsx'
import PreviewDashboard from './PreviewDashboard.jsx'
import PreviewChat, { ChatInputBar } from './PreviewChat.jsx'
import PreviewSheet, { SheetRow } from './PreviewSheet.jsx'
import PreviewStage from './PreviewStage.jsx'
import EnvIcon, { EnvProvider } from './EnvIcon.jsx'

const UNIVERSES = [
  { key: 'dune',      label: 'Dune' },
  { key: 'halo',      label: 'Halo' },
  { key: 'mv',        label: 'Monument Valley' },
  { key: 'nightcity', label: 'Night City' },
]

const ENVS_BY_UNIVERSE = {
  dune:      [{ key: 'atreides',   label: 'Atreides'   }, { key: 'harkonnen', label: 'Harkonnen' }, { key: 'arrakis', label: 'Arrakis' }],
  halo:      [{ key: 'forerunner', label: 'Forerunner' }, { key: 'unsc',      label: 'UNSC'      }],
  mv:        [{ key: 'spires',     label: 'Sacred Spires' }, { key: 'garden',  label: 'Garden Pavilion' }],
  nightcity: [{ key: 'corpo',      label: 'Corpo Plaza'   }, { key: 'pacifica', label: 'Pacifica Street' }],
}

const MOODS_BY_ENV = {
  atreides:   ['caladan-storm', 'caladan-sunset'],
  harkonnen:  ['giedi', 'bloodlight'],
  arrakis:    ['deep-desert', 'spice-blow', 'wormsign'],
  forerunner: ['hard-light', 'ceramic-veil'],
  unsc:       ['combat-steel', 'night-vision'],
  spires:     ['sacred', 'daybreak-temple', 'twilight-spires'],
  garden:     ['pastel-day', 'dusk-pavilion'],
  corpo:      ['chrome', 'executive'],
  pacifica:   ['glitch-street', 'smoke'],
}

const MODEL_FAMILIES = [
  { key: 'ollama', label: 'Ollama (Local)', sub: 'llama3 · deepseek · mistral', variants: [
    { key: 'fast',     label: 'Fast',     sub: 'Quick answers, daily tasks' },
    { key: 'thinking', label: 'Thinking', sub: 'Complex reasoning, step-by-step' },
    { key: 'pro',      label: 'Pro',      sub: 'Advanced code, analysis' },
  ]},
  { key: 'gemini', label: 'Gemini', sub: "Google's models", variants: [
    { key: 'gemini-flash', label: 'Flash', sub: 'Fast' },
    { key: 'gemini-pro',   label: 'Pro',   sub: 'Reasoning' },
  ]},
  { key: 'openai', label: 'OpenAI', sub: 'GPT-4o · o1 · o3', variants: [
    { key: 'gpt-4o', label: 'GPT-4o', sub: 'Daily driver' },
    { key: 'o3',     label: 'o3',     sub: 'Reasoning' },
  ]},
  { key: 'image', label: 'Image Generation', sub: 'DALL-E · Stable Diffusion', variants: [
    { key: 'dalle3', label: 'DALL-E 3', sub: 'Photoreal' },
    { key: 'sdxl',   label: 'SDXL',     sub: 'Open weights' },
  ]},
]

const ATTACH_OPTIONS = [
  { key: 'camera',   label: 'Camera',         icon: 'photo_camera' },
  { key: 'gallery',  label: 'Photo / Gallery', icon: 'image' },
  { key: 'doc',      label: 'Document',       icon: 'description' },
  { key: 'link',     label: 'Link / URL',     icon: 'link' },
  { key: 'file',     label: 'File',           icon: 'folder' },
]

export default function PreviewApp() {
  // Skin state -------------------------------------------------------------
  const [universe, setUniverse]       = useState('dune')
  const [environment, setEnvironment] = useState('atreides')
  const [mood, setMood]               = useState('caladan-storm')

  // Mark body so legacy body::before backdrop is suppressed inside preview.
  useEffect(() => {
    document.body.classList.add('rs-preview-active')
    return () => document.body.classList.remove('rs-preview-active')
  }, [])

  // Apply skin to body so existing themes.css backdrop + tokens engage.
  useEffect(() => {
    document.body.setAttribute('data-universe', universe)
    document.documentElement.setAttribute('data-universe', universe)
  }, [universe])
  useEffect(() => {
    document.body.setAttribute('data-env', environment)
    document.documentElement.setAttribute('data-env', environment)
    const moods = MOODS_BY_ENV[environment] || []
    if (!moods.includes(mood)) setMood(moods[0])
  }, [environment]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.body.setAttribute('data-mood', mood)
    document.documentElement.setAttribute('data-mood', mood)
  }, [mood])

  // Page + UI state --------------------------------------------------------
  const [mode, setMode]   = useState('foyer') // 'foyer' (dashboard) | 'workshop' (chat)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modelOpen, setModelOpen]   = useState(false)
  const [modelStep, setModelStep]   = useState(0) // 0 = family, 1 = variant
  const [modelFamily, setModelFamily] = useState('ollama')
  const [modelVariant, setModelVariant] = useState('fast')
  const [attachOpen, setAttachOpen] = useState(false)

  // Chat state -------------------------------------------------------------
  const [draft, setDraft]   = useState('')
  const [think, setThink]   = useState(false)
  const [search, setSearch] = useState(false)

  const envList   = ENVS_BY_UNIVERSE[universe] || []
  const moodList  = MOODS_BY_ENV[environment] || []

  const headerContext = useMemo(() => {
    const now = new Date()
    const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return mode === 'foyer'
      ? t
      : 'speak · ' + t
  }, [mode])

  // Mode-shift uses View Transitions API when available (declarative + cheap)
  function switchMode(next) {
    if (next === mode) return
    if (document.startViewTransition) {
      document.startViewTransition(() => setMode(next))
    } else {
      setMode(next)
    }
  }

  function send() {
    if (!draft.trim()) return
    // (PreviewChat owns its thread; this preview keeps state minimal.
    //  In a real build we'd lift thread into context.)
    setDraft('')
  }

  // Action bar contents depend on mode ------------------------------------
  const action = mode === 'foyer'
    ? (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button className="rs-btn-primary" onClick={() => switchMode('workshop')}>
          <EnvIcon name="mic" style={{ fontSize: 18 }} />
          Speak to River
        </button>
      </div>
    )
    : (
      <ChatInputBar
        draft={draft}
        onDraft={setDraft}
        think={think} onToggleThink={() => setThink(v => !v)}
        search={search} onToggleSearch={() => setSearch(v => !v)}
        onOpenAttach={() => setAttachOpen(true)}
        onOpenModel={() => { setModelStep(0); setModelOpen(true) }}
        modelLabel={modelVariant}
        onSend={send}
      />
    )

  return (
    <EnvProvider value={environment}>
      <PreviewStage environment={environment} />

      <PreviewShell
        context={headerContext}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSpeak={() => switchMode('workshop')}
        action={action}
      >
        {mode === 'foyer' ? <PreviewDashboard /> : <PreviewChat />}
      </PreviewShell>

      <PreviewDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        active={mode === 'workshop' ? 'speak' : 'dashboard'}
        onNavigate={(k) => {
          setDrawerOpen(false)
          if (k === 'speak') switchMode('workshop')
        }}
      />

      {/* Model selector — two-step sheet */}
      <PreviewSheet
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        title={modelStep === 0 ? 'Select Model' : MODEL_FAMILIES.find(f => f.key === modelFamily)?.label}
      >
        {modelStep === 0 ? (
          MODEL_FAMILIES.map(f => (
            <SheetRow
              key={f.key}
              icon="radio"
              title={f.label}
              sub={f.sub}
              active={f.key === modelFamily}
              onClick={() => { setModelFamily(f.key); setModelStep(1) }}
            />
          ))
        ) : (
          <>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 8px 12px', color: 'var(--text-dim, #aab)' }}
              onClick={() => setModelStep(0)}
            >
              <EnvIcon name="back" />
              Back
            </div>
            {(MODEL_FAMILIES.find(f => f.key === modelFamily)?.variants || []).map(v => (
              <SheetRow
                key={v.key}
                title={v.label}
                sub={v.sub}
                active={v.key === modelVariant}
                onClick={() => { setModelVariant(v.key); setModelOpen(false) }}
              />
            ))}
          </>
        )}
      </PreviewSheet>

      {/* Attachment sheet */}
      <PreviewSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
      >
        {ATTACH_OPTIONS.map(o => (
          <SheetRow
            key={o.key}
            icon={o.icon}
            title={o.label}
            onClick={() => setAttachOpen(false)}
          />
        ))}
      </PreviewSheet>

      {/* Skin switcher (preview-only — outside EnvProvider closing below) */}
      <div className="rs-skinbar" role="region" aria-label="Skin switcher">
        <div className="rs-mode-tabs">
          <button
            className={mode === 'foyer' ? 'is-active' : ''}
            onClick={() => switchMode('foyer')}
          >Foyer</button>
          <button
            className={mode === 'workshop' ? 'is-active' : ''}
            onClick={() => switchMode('workshop')}
          >Workshop</button>
        </div>
        <label>
          <span>Universe</span>
          <select value={universe} onChange={e => setUniverse(e.target.value)}>
            {UNIVERSES.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </label>
        <label>
          <span>Env</span>
          <select value={environment} onChange={e => setEnvironment(e.target.value)}>
            {envList.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </label>
        <label>
          <span>Mood</span>
          <select value={mood} onChange={e => setMood(e.target.value)}>
            {moodList.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
    </EnvProvider>
  )
}
