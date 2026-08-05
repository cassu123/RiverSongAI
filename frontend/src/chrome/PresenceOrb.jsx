// PresenceOrb — River's pulse, in the header on every page.
//
// Now a thin wrapper over <PresenceBulb/>, which is the same component the
// Speaking stage renders. Previously this was a flat CSS circle and the stage
// was a separate three.js scene, so River had two unrelated faces depending on
// which page you were on.
//
// Subscribes to the global bus itself (rs-presence / rs-toast) — see
// PresenceBulb — so it needs no props beyond its size context.

import PresenceBulb from '../components/PresenceBulb.jsx'

export default function PresenceOrb({ mode, onClick }) {
  const large = mode === 'foyer'
  return (
    <PresenceBulb
      interactive
      onClick={onClick}
      size={large ? 34 : 26}
      // Below ~48px the inner veils are sub-pixel noise; skip them.
      className="is-compact rs-orb"
    />
  )
}
