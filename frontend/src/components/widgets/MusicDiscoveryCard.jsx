import React from 'react'

function Head() {
  return (
    <div className="rs-card-head">
      <span className="rs-card-label">
        <span className="material-symbols-rounded rs-card-label-icon">graphic_eq</span>
        Trending music
      </span>
    </div>
  )
}

export function MusicDiscoveryCard({
  tracks = [], isLoading, error, onRetry, onPlay,
}) {
  if (isLoading) {
    return (
      <div className="rs-card rs-span-2 animate-pulse">
        <Head />
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: '0 0 140px' }}>
              <div style={{ width: 140, height: 140, background: 'var(--md-surface-container-high)', borderRadius: 12 }} />
              <div style={{ height: 12, width: '80%', background: 'var(--md-surface-container-high)', marginTop: 8, borderRadius: 4 }} />
              <div style={{ height: 10, width: '60%', background: 'var(--md-surface-container-high)', marginTop: 4, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // An outage and an empty chart are different problems: one is worth a retry,
  // the other is not. The old card showed the same dead sentence for both.
  if (error) {
    return (
      <div className="rs-card rs-span-2">
        <Head />
        <div className="rs-card-state">
          <span className="material-symbols-rounded rs-card-state-icon">music_off</span>
          <p className="rs-card-state-msg">{error}</p>
          {onRetry && <button className="rs-pill" onClick={onRetry}>Retry</button>}
        </div>
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="rs-card rs-span-2">
        <Head />
        <div className="rs-card-state">
          <span className="material-symbols-rounded rs-card-state-icon">music_note</span>
          <p className="rs-card-state-msg">No trending tracks right now.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-card rs-span-2 animate-fade-in">
      <Head />

      <div style={{ 
        display: 'flex', 
        gap: 20, 
        overflowX: 'auto', 
        paddingBottom: 12,
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch'
      }}>
        {tracks.map((track) => (
          <div 
            key={track.videoId} 
            style={{ 
              flex: '0 0 160px', 
              scrollSnapAlign: 'start',
              cursor: 'pointer',
              position: 'relative'
            }}
            onClick={() => onPlay(track.videoId)}
            className="is-tappable"
          >
            <div style={{ position: 'relative', width: 160, height: 160 }}>
              <img 
                src={track.thumbnail} 
                alt={track.title}
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover', 
                  borderRadius: 16,
                  boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
                }}
              />
              <div style={{ 
                position: 'absolute', 
                bottom: 8, 
                right: 8, 
                width: 36, 
                height: 36, 
                borderRadius: '50%', 
                background: 'var(--primary)', 
                color: 'var(--on-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>play_arrow</span>
              </div>
            </div>
            
            <div style={{ marginTop: 10 }}>
              <div style={{ 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                color: 'var(--md-on-surface)'
              }}>
                {track.title}
              </div>
              <div style={{ 
                fontSize: '0.75rem', 
                opacity: 0.6,
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis'
              }}>
                {track.artist}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
