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
        <div className="rs-flex rs-gap-4" style={{ overflowX: 'auto', paddingBottom: 'var(--rs-space-2)' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: '0 0 140px' }}>
              <div style={{ width: 140, height: 140, background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-md)' }} />
              <div className="rs-mt-2" style={{ height: 12, width: '80%', background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-xs)' }} />
              <div className="rs-mt-1" style={{ height: 10, width: '60%', background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-xs)' }} />
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

      <div className="rs-flex rs-gap-5" style={{
        overflowX: 'auto',
        paddingBottom: 'var(--rs-space-3)',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
      }}>
        {tracks.map((track) => (
          <div 
            key={track.videoId} 
            className="rs-pointer rs-relative" style={{
              flex: '0 0 160px',
              scrollSnapAlign: 'start',
            }}
            onClick={() => onPlay(track.videoId)}
            className="is-tappable"
          >
            <div className="rs-relative" style={{ width: 160, height: 160 }}>
              <img 
                src={track.thumbnail} 
                alt={track.title}
                className="rs-w-full rs-h-full" style={{
                  objectFit: 'cover',
                  borderRadius: 'var(--md-shape-lg)',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
                }}
              />
              <div className="rs-flex rs-items-center rs-justify-center" style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: 'var(--on-primary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>play_arrow</span>
              </div>
            </div>
            
            <div className="rs-mt-3">
              <div className="rs-type-tiny rs-nowrap rs-clip rs-ellipsis" style={{
                fontWeight: 600,
                color: 'var(--md-on-surface)',
              }}>
                {track.title}
              </div>
              <div className="rs-muted rs-type-micro rs-nowrap rs-clip rs-ellipsis">
                {track.artist}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
