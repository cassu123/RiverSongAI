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

const CYCLE_INTERVAL = 7000
const FADE_DURATION  = 320

export default function PulseWidget({ token }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [newsIdx, setNewsIdx] = useState(0)
  const [visible, setVisible] = useState(true)

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

  const newsItems = data
    ? Array.isArray(data.news) ? data.news : (data.news ? [data.news] : [])
    : []

  useEffect(() => {
    if (newsItems.length <= 1) return
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setNewsIdx(i => (i + 1) % newsItems.length)
        setVisible(true)
      }, FADE_DURATION)
    }, CYCLE_INTERVAL)
    return () => clearInterval(id)
  }, [newsItems.length])

  if (!data && loading) return <PulseSkeleton />
  if (!data) return null

  const { markets, flights, ts } = data
  const currentNews = newsItems[newsIdx] || null

  const fmtTs = (epoch) =>
    epoch
      ? new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '--:--'

  const marketUp    = (markets?.change ?? 0) >= 0
  const marketColor = markets?.error ? C.muted : (marketUp ? C.green : C.red)

  return (
    <div className="rs-flex rs-flex-col">

      {currentNews && (
        <PulseRow
          icon="public"
          iconColor="var(--primary)"
          label="NEWS"
          time={fmtTs(ts?.news)}
          badge={newsItems.length > 1 ? `${newsIdx + 1}/${newsItems.length}` : null}
        >
          <div
            className="rs-flex rs-items-center rs-gap-3 rs-min-w-0" style={{
              opacity: visible ? 1 : 0,
              transition: `opacity ${FADE_DURATION}ms ease`,
            }}
          >
            <span className="rs-grow rs-type-tiny rs-nowrap rs-clip rs-ellipsis" style={{
              fontWeight: 550,
              color: C.text,
              letterSpacing: '-0.01em',
              lineHeight: 1.35,
            }}>
              {currentNews.headline || 'No headlines.'}
            </span>
            {currentNews.source && (
              <span className="rs-no-shrink rs-type-nano rs-nowrap" style={{
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: C.muted,
                background: 'oklch(20% 0.01 265)',
                padding: '2px 8px',
                borderRadius: 4,
              }}>
                {currentNews.source}
              </span>
            )}
          </div>
        </PulseRow>
      )}

      {markets && (
        <>
          <div style={{ height: 1, background: C.divider }} />
          <PulseRow
            icon="show_chart"
            iconColor={marketColor}
            label="MARKETS"
            time={fmtTs(ts?.markets)}
          >
            {markets.error ? (
              <span className="rs-type-micro" style={{ color: C.muted, fontStyle: 'italic' }}>
                No data
              </span>
            ) : (
              <div className="rs-flex rs-gap-3" style={{ alignItems: 'baseline' }}>
                <span className="rs-mono rs-type-nano" style={{
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: C.muted,
                }}>
                  {markets.symbol}
                </span>
                <span className="rs-mono rs-type-body" style={{
                  fontWeight: 750,
                  letterSpacing: '-0.02em',
                  color: C.text,
                }}>
                  {markets.price != null
                    ? `$${Number(markets.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '--'}
                </span>
                {markets.change != null && markets.change_pct != null && (
                  <span className="rs-mono rs-type-micro" style={{
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
        </>
      )}

      {flights && (
        <>
          <div style={{ height: 1, background: C.divider }} />
          <PulseRow
            icon="flight"
            iconColor={C.sky}
            label="OVERHEAD"
            time={fmtTs(ts?.flights)}
          >
            <div className="rs-flex rs-gap-2" style={{ alignItems: 'baseline' }}>
              <span className="rs-mono rs-type-body" style={{
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: C.sky,
              }}>
                {flights.flights?.length ?? 0}
              </span>
              <span className="rs-type-micro" style={{
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
      <div className="rs-flex rs-items-center rs-gap-2" style={{
        marginBottom: 7,
      }}>
        <span
          className="material-symbols-rounded rs-no-shrink"
          style={{
            fontSize: '0.9rem',
            lineHeight: 1,
            color: iconColor,
            transition: 'color 0.3s ease',
          }}
        >
          {icon}
        </span>
        <span className="rs-grow rs-type-nano" style={{
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: C.dim,
        }}>
          {label}
        </span>
        {badge && (
          <span className="rs-mono rs-type-nano" style={{
            letterSpacing: '0.04em',
            color: C.dim,
            marginRight: 4,
          }}>
            {badge}
          </span>
        )}
        <span className="rs-mono rs-type-nano" style={{
          letterSpacing: '0.04em',
          color: C.dim,
        }}>
          {time}
        </span>
      </div>
      <div className="rs-min-w-0" style={{ paddingLeft: 20 }}>
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
    <div className="rs-flex rs-flex-col">
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          {i > 0 && <div style={{ height: 1, background: C.divider }} />}
          <div className="rs-flex rs-flex-col" style={{ padding: '11px 0', gap: 9 }}>
            {shimmer('35%')}
            {shimmer(i === 1 ? '55%' : '80%')}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
