import { useEffect, useRef, useState } from 'react'

/**
 * AppliancePanel — tick what is actually printed on the front of the machine.
 *
 * Two Instant Pot pressure cookers, one with an air fry lid, are why this
 * exists. Nothing in the name separates them; the AIR CRISP button does. So
 * rather than asking anyone to describe their appliance, this shows every
 * button the system knows about and asks them to look at the thing and tap.
 *
 * The whole catalogue is listed, not just the guessed ones, because the
 * correction that matters most is *adding* the button the guess missed — and
 * a list of only what was already claimed makes that impossible.
 *
 * Inline rather than a modal, deliberately: this is read side by side with
 * the appliance, and a sheet that covers the screen fights that.
 */
export default function AppliancePanel({ api, equipmentId, onSaved, onClose }) {
  const [rows, setRows]     = useState([])
  const [on, setOn]         = useState(() => new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // Generation counter rather than a cleanup flag: an async effect body
  // cannot return a cleanup that React will run, so a stale response is
  // fenced off by comparing the run it belongs to.
  const runRef = useRef(0)

  useEffect(() => {
    const run = ++runRef.current
    setLoading(true)
    setError('')
    api.get(`/household/equipment/${equipmentId}/panel`)
      .then(data => {
        if (run !== runRef.current) return
        setRows(data.buttons || [])
        setOn(new Set((data.buttons || []).filter(b => b.on).map(b => b.key)))
        setConfirmed(!!data.confirmed)
      })
      .catch(() => { if (run === runRef.current) setError('Could not load the panel.') })
      .finally(() => { if (run === runRef.current) setLoading(false) })
  }, [api, equipmentId])

  const toggle = key => setOn(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      // Labels, not keys: the panel is stored as the wording a person would
      // read off the machine, and the server normalises it back.
      const panel = rows.filter(r => on.has(r.key)).map(r => r.label)
      const saved = await api.post(`/household/equipment/${equipmentId}/panel`, { panel })
      onSaved?.(saved)
    } catch {
      setError('Could not save. Nothing was changed.')
    } finally {
      setSaving(false)
    }
  }

  // Buttons that earn a station are what change the schedule; the rest are
  // real controls with nothing for the planner to do. Split so it is obvious
  // why ticking DEHYDRATE changes nothing.
  const scheduled = rows.filter(r => r.station)
  const other     = rows.filter(r => !r.station)
  const stations  = [...new Set(scheduled.filter(r => on.has(r.key)).map(r => r.station))]

  return (
    <div style={{
      marginTop: 14, paddingTop: 14,
      borderTop: '1px solid var(--rs-border, rgba(128,128,128,0.25))',
    }}>
      <div className="rs-card-label" style={{ marginBottom: 6 }}>
        WHAT IS PRINTED ON IT
      </div>
      <div className="rs-card-meta" style={{ fontSize: '0.72rem', marginBottom: 12, lineHeight: 1.5 }}>
        {confirmed
          ? 'Confirmed from the machine. Retick if anything is wrong.'
          : 'Guessed from the name. Two appliances can share a name and differ by one button — tick what you can actually see.'}
      </div>

      {loading && <div className="rs-card-meta">READING…</div>}

      {!loading && (
        <>
          <Group rows={scheduled} on={on} toggle={toggle} />
          {other.length > 0 && (
            <>
              <div className="rs-card-meta" style={{
                fontSize: '0.68rem', opacity: 0.6, margin: '14px 0 8px',
              }}>
                ON THE MACHINE, NOT PART OF A PLAN
              </div>
              <Group rows={other} on={on} toggle={toggle} />
            </>
          )}

          <div className="rs-card-meta" style={{ marginTop: 14, fontSize: '0.72rem' }}>
            {stations.length
              ? <>This makes it a <strong style={{ color: 'var(--primary)' }}>
                  {stations.join(', ').replace(/_/g, ' ')}
                </strong>.</>
              : 'Nothing ticked yet that a meal plan can use.'}
          </div>

          {error && (
            <div className="rs-card-meta" style={{ marginTop: 8, color: 'var(--md-error)' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {/* No rows means the load failed, not that the machine has no
                buttons. Saving that would post an empty panel and strip every
                station off a working appliance — a failed read turning into a
                destructive write. */}
            <button className="rs-pill" onClick={save}
                    disabled={saving || rows.length === 0}>
              <span className="material-symbols-rounded">check</span>
              {saving ? 'SAVING…' : 'THAT IS MY MACHINE'}
            </button>
            <button className="rs-pill" onClick={onClose} disabled={saving}>CANCEL</button>
          </div>
        </>
      )}
    </div>
  )
}

function Group({ rows, on, toggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {rows.map(row => {
        const active = on.has(row.key)
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => toggle(row.key)}
            aria-pressed={active}
            style={{
              padding: '7px 13px',
              borderRadius: 999,
              fontSize: '0.74rem',
              fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              border: active
                ? '1px solid var(--primary)'
                : '1px solid var(--rs-border, rgba(128,128,128,0.35))',
              background: active ? 'var(--primary)' : 'transparent',
              color: active ? 'var(--on-primary, #000)' : 'inherit',
              opacity: active ? 1 : 0.75,
            }}
          >
            {row.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
