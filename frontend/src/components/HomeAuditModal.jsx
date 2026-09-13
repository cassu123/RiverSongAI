import React, { useState, useEffect } from 'react';
import BarcodeScanner from './BarcodeScanner';

export default function HomeAuditModal({ homeId, token, onClose }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [notes, setNotes] = useState('');

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

  useEffect(() => {
    fetchActiveAudit();
  }, [homeId, token]);

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
    <div className="barcode-scanner-modal rs-flex rs-items-start rs-justify-center rs-p-5" role="dialog" style={{ backgroundColor: 'var(--md-background)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, overflowY: 'auto' }}>
      <div className="rs-w-full rs-relative" style={{ maxWidth: 1000 }}>
        <button onClick={onClose} className="rs-pointer" style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', color: 'var(--md-on-background)' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        
        <h2 className="rs-mb-2" style={{ marginTop: 0, fontSize: '2rem' }}>Sector Audit</h2>
        <p className="rs-card-meta">Verify physical presence of operational assets.</p>

        {error && <div className="rs-p-2 rs-mb-4 rs-c-critical" style={{ background: 'color-mix(in srgb, var(--rs-status-critical) 10%, transparent)' }}>{error}</div>}

        {loading ? (
          <div>INITIALIZING AUDIT SUBSYSTEM...</div>
        ) : !audit || audit.status === 'completed' || audit.status === 'abandoned' ? (
          <div className="rs-text-center" style={{ padding: '64px 0' }}>
            <span className="material-symbols-rounded rs-mb-4" style={{ fontSize: '4rem', opacity: 0.2 }}>fact_check</span>
            {audit && audit.status === 'completed' && (
              <div className="rs-mb-6">
                <div className="rs-mb-4 rs-type-h3 rs-c-nominal">AUDIT COMPLETED SUCCESSFULLY</div>
                <div className="rs-flex rs-gap-4 rs-justify-center">
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
            <button className="rs-btn-primary rs-mt-4" onClick={startAudit}>
              <span className="material-symbols-rounded">play_arrow</span>
              INITIATE NEW AUDIT
            </button>
          </div>
        ) : (
          <div>
            <div className="rs-flex rs-justify-between rs-mb-2">
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ background: 'var(--rs-status-warning)' }} />
                <span>AUDIT IN PROGRESS</span>
              </div>
              <div className="rs-mono">
                {audit.scanned_count} / {audit.total_items} VERIFIED
              </div>
            </div>
            <div className="rs-w-full rs-mb-5 rs-clip" style={{ height: 8, background: 'var(--md-surface-container-highest)', borderRadius: 'var(--md-shape-xs)' }}>
              <div className="rs-h-full" style={{ width: `${audit.total_items > 0 ? (audit.scanned_count / audit.total_items) * 100 : 0}%`, background: 'var(--rs-status-nominal)', transition: 'width 0.3s ease' }} />
            </div>

            <div className="rs-mb-6">
              <button className="rs-btn-primary rs-w-full rs-justify-center rs-type-h3" onClick={() => setScannerOpen(true)} style={{ height: 64 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2rem' }}>barcode_scanner</span>
                SCAN ASSET
              </button>
            </div>

            <div className="rs-flex rs-gap-6 rs-flex-wrap">
              <div style={{ flex: '1 1 400px' }}>
                <h3 className="rs-mb-4 rs-flex rs-justify-between rs-type-body rs-c-nominal">
                  <span>SCANNED</span>
                  <span>({audit.scanned?.length || 0})</span>
                </h3>
                {Object.keys(scannedByLoc).sort().map(loc => (
                  <div key={loc} className="rs-mb-4">
                    <div className="rs-mb-2 rs-muted rs-type-tiny" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{loc}</div>
                    {scannedByLoc[loc].map(i => (
                      <div key={i.id} className="rs-mb-1 rs-flex rs-justify-between" style={{ padding: 'var(--rs-space-2) var(--rs-space-3)', background: 'color-mix(in srgb, var(--rs-status-nominal) 5%, transparent)', borderRadius: 'var(--md-shape-xs)' }}>
                        <span>{i.name}</span>
                        <span className="rs-muted rs-type-tiny rs-mono">{i.ein}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ flex: '1 1 400px' }}>
                <h3 className="rs-mb-4 rs-flex rs-justify-between rs-type-body rs-c-critical">
                  <span>MISSING</span>
                  <span>({audit.missing?.length || 0})</span>
                </h3>
                {Object.keys(missingByLoc).sort().map(loc => (
                  <div key={loc} className="rs-mb-4">
                    <div className="rs-mb-2 rs-muted rs-type-tiny" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{loc}</div>
                    {missingByLoc[loc].map(i => (
                      <div key={i.id} className="rs-mb-1 rs-flex rs-justify-between" style={{ padding: 'var(--rs-space-2) var(--rs-space-3)', background: 'color-mix(in srgb, var(--rs-status-critical) 5%, transparent)', borderRadius: 'var(--md-shape-xs)' }}>
                        <span>{i.name}</span>
                        <span className="rs-muted rs-type-tiny rs-mono">{i.ein}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="rs-mt-6 rs-p-5" style={{ background: 'var(--md-surface-container)', borderRadius: 'var(--md-shape-md)' }}>
              <textarea 
                className="rs-chat-input rs-w-full rs-p-3 rs-mb-4 rs-c-fg"
                style={{ height: 80, borderRadius: 'var(--md-shape-sm)', background: 'var(--md-surface-container-high)', border: 'none' }}
                placeholder="Audit completion notes (optional)..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <button className="rs-btn-primary rs-w-full rs-justify-center rs-c-nominal" onClick={completeAudit} disabled={completing} style={{ height: 56, background: 'color-mix(in srgb, var(--rs-status-nominal) 20%, transparent)' }}>
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
