import React, { useState, useEffect, useCallback } from 'react'

const C = {
  muted:   'oklch(50% 0.01 265)',
  text:    'oklch(86% 0.01 265)',
  dim:     'oklch(38% 0.01 265)',
  divider: 'oklch(26% 0.01 265)',
  green:   'oklch(71% 0.17 145)',
  red:     'oklch(64% 0.17 22)',
  sky:     'oklch(71% 0.13 238)',
}

export default function PulseWidget({ token }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/pulse/latest', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {}
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  if (!data && loading) return <PulseSkeleton />
  if (!data) return null

  const { markets, flights, ts } = data

  const fmtTs = (epoch) =>
    epoch
      ? new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--'

  const marketUp    = (markets?.change ?? 0) >= 0
  const marketColor = markets?.error ? C.muted : (marketUp ? C.green : C.red)

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {markets && (
        <PulseRow
          icon="show_chart"
          iconColor={marketColor}
          label="MARKETS"
          time={fmtTs(ts?.markets)}
        >
          {markets.error ? (
            <span style={{ fontSize: '0.75rem', color: C.muted, fontStyle: 'italic' }}>
              No data
            </span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                color: C.muted,
              }}>
                {markets.symbol}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.05rem',
                fontWeight: 750,
                letterSpacing: '-0.02em',
                color: C.text,
              }}>
                {markets.price != null
                  ? `$${Number(markets.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '--'}
              </span>
              {markets.change != null && markets.change_pct != null && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  fontWeight: 650,
                  letterSpacing: '-0.01em',
                  color: marketColor,
                }}>
                  {marketUp ? '▲' : '▼'} {Math.abs(markets.change_pct).toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </PulseRow>
      )}

      {flights && (
        <>
          {markets && <div style={{ height: 1, background: C.divider }} />}
          <PulseRow
            icon="flight"
            iconColor={C.sky}
            label="OVERHEAD"
            time={fmtTs(ts?.flights)}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.15rem',
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: C.sky,
              }}>
                {flights.flights?.length ?? 0}
              </span>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: C.muted,
                letterSpacing: '0.01em',
              }}>
                {(flights.flights?.length ?? 0) === 0
                  ? 'clear skies'
                  : 'aircraft overhead'}
              </span>
            </div>
          </PulseRow>
        </>
      )}

    </div>
  )
}

function PulseRow({ icon, iconColor, label, time, badge, children }) {
  return (
    <div style={{ padding: '11px 0' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 7,
      }}>
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: '0.9rem',
            lineHeight: 1,
            color: iconColor,
            flexShrink: 0,
            transition: 'color 0.3s ease',
          }}
        >
          {icon}
        </span>
        <span style={{
          fontSize: '0.58rem',
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: C.dim,
          flex: 1,
        }}>
          {label}
        </span>
        {badge && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.52rem',
            letterSpacing: '0.04em',
            color: C.dim,
            opacity: 0.6,
            marginRight: 4,
          }}>
            {badge}
          </span>
        )}
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.58rem',
          letterSpacing: '0.04em',
          color: C.dim,
          opacity: 0.75,
        }}>
          {time}
        </span>
      </div>
      <div style={{ paddingLeft: 20, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

function PulseSkeleton() {
  const shimmer = (w) => (
    <div style={{
      height: 9,
      width: w,
      borderRadius: 5,
      background: C.divider,
      opacity: 0.9,
    }} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          {i > 0 && <div style={{ height: 1, background: C.divider }} />}
          <div style={{ padding: '11px 0', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {shimmer('35%')}
            {shimmer(i === 1 ? '55%' : '80%')}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
