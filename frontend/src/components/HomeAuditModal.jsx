import React, { useState, useEffect } from 'react';
import BarcodeScanner from './BarcodeScanner';

export default function HomeAuditModal({ homeId, token, onClose }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchActiveAudit();
  }, [homeId]);

  const fetchActiveAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/homes/${homeId}/audit/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAudit(data); // data could be null if no active audit
      }
    } catch (err) {
      setError('Failed to check active audit');
    } finally {
      setLoading(false);
    }
  };

  const startAudit = async () => {
    setError('');
    try {
      const res = await fetch(`/api/inventory/homes/${homeId}/audit/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to start audit');
      setAudit(await res.json());
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScan = async (code) => {
    setScannerOpen(false);
    setError('');
    if (!audit) return;
    try {
      const res = await fetch(`/api/inventory/audits/${audit.id}/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ein: code })
      });
      if (!res.ok) {
        const data = await res.json().catch(()=>({}));
        throw new Error(data.detail || 'Scan failed');
      }
      // Re-fetch audit to get updated lists
      fetchActiveAudit();
    } catch (err) {
      setError(err.message);
    }
  };

  const completeAudit = async () => {
    setCompleting(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/audits/${audit.id}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      if (!res.ok) throw new Error('Failed to complete audit');
      setAudit(await res.json()); // the status will be 'completed'
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const downloadDiscrepancy = async (markMissing) => {
    window.open(`/api/inventory/audits/${audit.id}/discrepancy?token=${token}&mark_missing=${markMissing}`, '_blank');
  };

  const groupByLocation = (items) => {
    if (!items) return {};
    return items.reduce((acc, item) => {
      const loc = item.location || 'UNSPECIFIED';
      if (!acc[loc]) acc[loc] = [];
      acc[loc].push(item);
      return acc;
    }, {});
  };

  const scannedByLoc = groupByLocation(audit?.scanned);
  const missingByLoc = groupByLocation(audit?.missing);

  return (
    <div className="barcode-scanner-modal" role="dialog" style={{ backgroundColor: 'var(--md-background)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, overflowY: 'auto', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 1000, position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-on-background)' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        
        <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: '2rem' }}>Sector Audit</h2>
        <p className="rs-card-meta">Verify physical presence of operational assets.</p>

        {error && <div style={{ color: '#f87171', padding: 8, background: 'rgba(248,113,113,0.1)', marginBottom: 16 }}>{error}</div>}

        {loading ? (
          <div>INITIALIZING AUDIT SUBSYSTEM...</div>
        ) : !audit || audit.status === 'completed' || audit.status === 'abandoned' ? (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '4rem', opacity: 0.2, marginBottom: 16 }}>fact_check</span>
            {audit && audit.status === 'completed' && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ color: '#4ade80', fontSize: '1.2rem', marginBottom: 16 }}>AUDIT COMPLETED SUCCESSFULLY</div>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                  <button className="rs-btn-primary" onClick={() => downloadDiscrepancy(false)} style={{ background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)' }}>
                    <span className="material-symbols-rounded">picture_as_pdf</span>
                    DISCREPANCY REPORT
                  </button>
                  <button className="rs-btn-primary" onClick={() => downloadDiscrepancy(true)} style={{ background: '#7f1d1d', color: '#fef2f2' }}>
                    <span className="material-symbols-rounded">gavel</span>
                    MARK UN-SCANNED MISSING & DOWNLOAD
                  </button>
                </div>
              </div>
            )}
            <p>No active audit in progress.</p>
            <button className="rs-btn-primary" onClick={startAudit} style={{ marginTop: 16 }}>
              <span className="material-symbols-rounded">play_arrow</span>
              INITIATE NEW AUDIT
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ background: '#facc15' }} />
                <span>AUDIT IN PROGRESS</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>
                {audit.scanned_count} / {audit.total_items} VERIFIED
              </div>
            </div>
            <div style={{ width: '100%', height: 8, background: 'var(--md-surface-container-highest)', borderRadius: 4, marginBottom: 24, overflow: 'hidden' }}>
              <div style={{ width: `${audit.total_items > 0 ? (audit.scanned_count / audit.total_items) * 100 : 0}%`, height: '100%', background: '#4ade80', transition: 'width 0.3s ease' }} />
            </div>

            <div style={{ marginBottom: 32 }}>
              <button className="rs-btn-primary" onClick={() => setScannerOpen(true)} style={{ width: '100%', justifyContent: 'center', height: 64, fontSize: '1.2rem' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2rem' }}>barcode_scanner</span>
                SCAN ASSET
              </button>
            </div>

            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 400px' }}>
                <h3 style={{ fontSize: '1.1rem', color: '#4ade80', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <span>SCANNED</span>
                  <span>({audit.scanned?.length || 0})</span>
                </h3>
                {Object.keys(scannedByLoc).sort().map(loc => (
                  <div key={loc} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{loc}</div>
                    {scannedByLoc[loc].map(i => (
                      <div key={i.id} style={{ padding: '8px 12px', background: 'rgba(74,222,128,0.05)', borderRadius: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{i.name}</span>
                        <span style={{ opacity: 0.5, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>{i.ein}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ flex: '1 1 400px' }}>
                <h3 style={{ fontSize: '1.1rem', color: '#f87171', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                  <span>MISSING</span>
                  <span>({audit.missing?.length || 0})</span>
                </h3>
                {Object.keys(missingByLoc).sort().map(loc => (
                  <div key={loc} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{loc}</div>
                    {missingByLoc[loc].map(i => (
                      <div key={i.id} style={{ padding: '8px 12px', background: 'rgba(248,113,113,0.05)', borderRadius: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{i.name}</span>
                        <span style={{ opacity: 0.5, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>{i.ein}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 32, padding: 24, background: 'var(--md-surface-container)', borderRadius: 12 }}>
              <textarea 
                className="rs-chat-input"
                style={{ width: '100%', height: 80, padding: 12, marginBottom: 16, borderRadius: 8, background: 'var(--md-surface-container-high)', border: 'none', color: 'white' }}
                placeholder="Audit completion notes (optional)..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <button className="rs-btn-primary" onClick={completeAudit} disabled={completing} style={{ width: '100%', justifyContent: 'center', height: 56, background: 'rgba(74,222,128,0.2)', color: '#4ade80' }}>
                <span className="material-symbols-rounded">done_all</span>
                {completing ? 'FINALIZING...' : 'FINALIZE AUDIT'}
              </button>
            </div>
          </div>
        )}

        {scannerOpen && (
          <BarcodeScanner continuous={true} onDetected={handleScan} onClose={() => setScannerOpen(false)} />
        )}
      </div>
    </div>
  );
}
