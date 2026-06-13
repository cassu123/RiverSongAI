import React from 'react';

/**
 * PreviewRoot — Scaffolding for the Chrome Layout Rework
 * This component acts as a standalone sandbox to prototype the futuristic, 
 * Kimi-clean spatial interface. Once the design iterations are finalized here, 
 * they will be migrated to the main App.jsx shell.
 */
export default function PreviewRoot() {
  return (
    <div className="rs-root rs-preview-active">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', padding: 40, alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ color: 'var(--primary)', fontWeight: 900, fontSize: '3rem', letterSpacing: '0.1em' }}>
          SPATIAL INTERFACE V2.0
        </h1>
        <div style={{ marginTop: 24, fontSize: '1.2rem', opacity: 0.7, maxWidth: 600, textAlign: 'center', lineHeight: 1.6 }}>
          This sandbox is isolated from the main application. 
          Use this route to experiment with double-bezel cards, tactile pills, 
          and per-environment (Universe/Environment/Mood) SVG backdrops.
        </div>
      </div>
    </div>
  );
}
