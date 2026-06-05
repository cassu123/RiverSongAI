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
      setCompleting(false);
    }
  };

  return (
    <div className="barcode-scanner-modal" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 600, padding: 24, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Sector Audit</h2>
        <p className="rs-card-meta">Verify physical presence of operational assets.</p>

        {error && <div style={{ color: '#f87171', padding: 8, background: 'rgba(248,113,113,0.1)', marginBottom: 16 }}>{error}</div>}

        {loading ? (
          <div>INITIALIZING AUDIT SUBSYSTEM...</div>
        ) : !audit || audit.status === 'completed' || audit.status === 'abandoned' ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: 16 }}>fact_check</span>
            {audit && audit.status === 'completed' && <div style={{ color: '#4ade80', marginBottom: 16 }}>AUDIT COMPLETED SUCCESSFULLY</div>}
            <p>No active audit in progress.</p>
            <button className="rs-btn-primary" onClick={startAudit} style={{ marginTop: 16 }}>
              <span className="material-symbols-rounded">play_arrow</span>
              INITIATE NEW AUDIT
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ background: '#facc15' }} />
                <span>AUDIT IN PROGRESS</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>
                {audit.scanned_count} / {audit.total_items} VERIFIED
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <button className="rs-btn-primary" onClick={() => setScannerOpen(true)} style={{ width: '100%', justifyContent: 'center', height: 48 }}>
                <span className="material-symbols-rounded">barcode_scanner</span>
                SCAN ASSET
              </button>
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '0.9rem', color: '#4ade80' }}>SCANNED ({audit.scanned?.length || 0})</h3>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {audit.scanned?.map(i => (
                    <div key={i.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                      {i.name} <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>({i.ein})</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '0.9rem', color: '#f87171' }}>MISSING ({audit.missing?.length || 0})</h3>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {audit.missing?.map(i => (
                    <div key={i.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                      {i.name} <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>({i.ein})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <textarea 
                className="rs-chat-input"
                style={{ width: '100%', height: 60, padding: 12, marginBottom: 12, borderRadius: 8 }}
                placeholder="Audit completion notes..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <button className="rs-btn-primary" onClick={completeAudit} disabled={completing} style={{ width: '100%', justifyContent: 'center', background: 'rgba(74,222,128,0.2)', color: '#4ade80' }}>
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
