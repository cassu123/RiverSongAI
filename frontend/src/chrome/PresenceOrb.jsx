// PresenceOrb — River's pulse, in the header on every page.
//
// Listens to two global signals:
//   rs-presence  {state: 'idle'|'listening'|'thinking'|'speaking', level?: 0..1}
//                broadcast by ConversationPage's voice state machine
//   rs-toast     any toast (incl. initiative-engine proactive events)
//                triggers a brief attention flash
//
// Pure CSS animation per state (chrome-shell.css .rs-orb.is-*) — the glass
// aesthetic and theme --primary drive the visuals.

import { useEffect, useRef, useState } from 'react'

export default function PresenceOrb({ mode, onClick }) {
  const [state, setState] = useState('idle')
  const [attention, setAttention] = useState(false)
  const attentionTimer = useRef(null)

  useEffect(() => {
    const onPresence = (e) => {
      const s = e.detail?.state
      if (['idle', 'listening', 'thinking', 'speaking'].includes(s)) setState(s)
    }
    const onToast = () => {
      setAttention(true)
      clearTimeout(attentionTimer.current)
      attentionTimer.current = setTimeout(() => setAttention(false), 2400)
    }
    window.addEventListener('rs-presence', onPresence)
    window.addEventListener('rs-toast', onToast)
    return () => {
      window.removeEventListener('rs-presence', onPresence)
      window.removeEventListener('rs-toast', onToast)
      clearTimeout(attentionTimer.current)
    }
  }, [])

  const classes = [
    'rs-orb',
    mode === 'foyer' ? 'is-large' : 'is-small',
    state !== 'idle' ? `is-${state}` : '',
    attention ? 'is-attention' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      className={classes}
      onClick={onClick}
      aria-label={`Speak to River (${state})`}
      title={state === 'idle' ? 'Speak to River' : `River is ${state}`}
    />
  )
}
