import React from 'react'

export function MusicDiscoveryCard({ tracks = [], isLoading, onPlay }) {
  if (isLoading) {
    return (
      <div className="rs-card is-wide animate-pulse">
        <div className="rs-card-head">
          <span className="rs-card-label">TRENDING MUSIC</span>
        </div>
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

  if (tracks.length === 0) {
    return (
      <div className="rs-card is-wide">
        <div className="rs-card-head">
          <span className="rs-card-label">TRENDING MUSIC</span>
        </div>
        <p className="rs-card-meta">Trending music is currently unavailable.</p>
      </div>
    )
  }

  return (
    <div className="rs-card is-wide animate-fade-in">
      <div className="rs-card-head">
        <span className="rs-card-label">TRENDING MUSIC</span>
        <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.5 }}>trending_up</span>
      </div>
      
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
