import re

with open("frontend/src/pages/SettingsPage.jsx", "r") as f:
    content = f.read()

# Replace state definition
content = content.replace(
    "const [saveStatus,       setSaveStatus]       = useState('')\n  const [saveErrorDetail,  setSaveErrorDetail]  = useState('')",
    "const [saveStatuses, setSaveStatuses] = useState({})"
)

# Add helper function
helper = """  const [reloadPending,    setReloadPending]    = useState(false)

  const setSaveStatus = (key, status, err = '') => {
    setSaveStatuses(prev => {
      if (!status) { const next = { ...prev }; delete next[key]; return next; }
      return { ...prev, [key]: { status, error: err } }
    })
  }"""
content = content.replace("  const [reloadPending,    setReloadPending]    = useState(false)", helper)

# Replace all setSaveStatus('...') with setSaveStatus('func_name', '...')
functions = [
    "selectModel", "saveFallback", "saveOrchestration", "saveScribeEnabled",
    "saveElevenLabs", "saveMemory", "saveUserPrefs", "saveAiFeature",
    "savePersona", "saveBriefingSettings", "saveFeedPrefs", "resetPersona",
    "triggerDaemonTask"
]

for func in functions:
    # Find the function definition
    pattern = rf"(const {func} = useCallback\(async \([^)]*\) => {{)(.*?)(  }}, \[.*?\]\))"
    def replacer(match):
        body = match.group(2)
        body = re.sub(r"setSaveErrorDetail\(([^)]+)\)\n\s*setSaveStatus\('error'\)", rf"setSaveStatus('{func}', 'error', \1)", body)
        body = re.sub(r"setSaveErrorDetail\(([^)]+)\)\s*;\s*setSaveStatus\('error'\)", rf"setSaveStatus('{func}', 'error', \1)", body)
        body = re.sub(r"setSaveStatus\((['\"a-zA-Z0-9_]+)\)", rf"setSaveStatus('{func}', \1)", body)
        # Note: setTimeout(() => setSaveStatus(''), 2500) will become setTimeout(() => setSaveStatus('func', ''), 2500) which is correct!
        return match.group(1) + body + match.group(3)
        
    content = re.sub(pattern, replacer, content, flags=re.DOTALL)

# Also fix loadData error handling
content = content.replace(
    "setSaveErrorDetail(err?.message || String(err))\n        setSaveStatus('error')",
    "setSaveStatus('loadData', 'error', err?.message || String(err))"
)

# Fix the render part
toast_jsx = """      {/* Save status toasts */}
      <div style={{ position: 'fixed', bottom: 32, right: 32, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(saveStatuses).map(([key, { status, error }]) => (
          <div
            key={key}
            role="status"
            aria-live="polite"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px',
              borderRadius: 'var(--md-shape-lg)',
              background: status === 'error'
                ? 'var(--md-error-container)'
                : 'var(--md-primary-container)',
              color: status === 'error'
                ? 'var(--md-on-error-container)'
                : 'var(--md-on-primary-container)',
              fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.06em',
              boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5)',
              border: '1px solid',
              borderColor: status === 'error'
                ? 'color-mix(in srgb, var(--md-error) 40%, transparent)'
                : 'color-mix(in srgb, var(--md-primary) 40%, transparent)',
            }}
          >
            {status === 'saving' && (
              <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>sync</span>SAVING…</>
            )}
            {status === 'saved' && (
              <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>check_circle</span>SAVED</>
            )}
            {status === 'error' && (
              <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>
                ERROR{error ? ` — ${error}` : ' — CHECK CONSOLE'}</>
            )}
          </div>
        ))}
      </div>"""

old_toast = """      {/* Save status toast */}
      {saveStatus && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 32, right: 32, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px',
            borderRadius: 'var(--md-shape-lg)',
            background: saveStatus === 'error'
              ? 'var(--md-error-container)'
              : 'var(--md-primary-container)',
            color: saveStatus === 'error'
              ? 'var(--md-on-error-container)'
              : 'var(--md-on-primary-container)',
            fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.06em',
            boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5)',
            border: '1px solid',
            borderColor: saveStatus === 'error'
              ? 'color-mix(in srgb, var(--md-error) 40%, transparent)'
              : 'color-mix(in srgb, var(--primary) 40%, transparent)',
          }}
        >
          {saveStatus === 'saving' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>sync</span>SAVING…</>
          )}
          {saveStatus === 'saved' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>check_circle</span>SAVED</>
          )}
          {saveStatus === 'error' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>
              ERROR{saveErrorDetail ? ` — ${saveErrorDetail}` : ' — CHECK CONSOLE'}</>
          )}
        </div>
      )}"""

content = content.replace(old_toast, toast_jsx)

# TASK 3: Independent fetches
# Current loadData uses Promise.all for the first three: models, settings/llm, settings/memory
# We want to change this so each can fail independently.
# "In SettingsPage.jsx's initial loader, the three okJson() fetches (/api/models, /api/settings/llm, /api/settings/memory) fail as a group because they share one Promise.all + try/catch. Let each fail independently so one bad endpoint degrades only its own sections."

old_fetch = """        const [modData, llmData, memData, voiceData, featData, prefData, feedPrefsData] = await Promise.all([
          fetch(`${API_BASE}/api/models`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/llm${query}`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/memory${query}`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/voice`, { headers }).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/api/features`, { headers }).then(r => r.json()).catch(() => ({ ai_features: {} })),
          fetch(`${API_BASE}/api/settings`, { headers }).then(r => r.json()).catch(() => ({ music_provider: 'youtube_music' })),
          fetch(`${API_BASE}/api/feeds/preferences`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        ])"""

new_fetch = """        const [modData, llmData, memData, voiceData, featData, prefData, feedPrefsData] = await Promise.all([
          fetch(`${API_BASE}/api/models`, { headers }).then(okJson).catch(err => { console.error(err); return { local: [], cloud: [], enabled_providers: {} }; }),
          fetch(`${API_BASE}/api/settings/llm${query}`, { headers }).then(okJson).catch(err => { console.error(err); return null; }),
          fetch(`${API_BASE}/api/settings/memory${query}`, { headers }).then(okJson).catch(err => { console.error(err); return null; }),
          fetch(`${API_BASE}/api/settings/voice`, { headers }).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/api/features`, { headers }).then(r => r.json()).catch(() => ({ ai_features: {} })),
          fetch(`${API_BASE}/api/settings`, { headers }).then(r => r.json()).catch(() => ({ music_provider: 'youtube_music' })),
          fetch(`${API_BASE}/api/feeds/preferences`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        ])"""

content = content.replace(old_fetch, new_fetch)

with open("frontend/src/pages/SettingsPage.jsx", "w") as f:
    f.write(content)
