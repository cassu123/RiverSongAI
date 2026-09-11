import React, { useState } from 'react';

export default function ReassignHomeModal({ homeId, homes, token, onClose, onComplete }) {
  const [targetHomeId, setTargetHomeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const availableHomes = homes.filter(h => h.id !== homeId);

  const handleReassign = async (e) => {
    e.preventDefault();
    if (!targetHomeId) {
      setError("Please select a destination home.");
      return;
    }
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`/api/inventory/homes/${homeId}/reassign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_home_id: targetHomeId })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Reassignment failed');
      }
      
      onComplete();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="barcode-scanner-modal rs-flex rs-items-center rs-justify-center" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
      <div className="rs-card is-elev rs-w-full rs-p-5 rs-relative" style={{ maxWidth: 500 }}>
        <button onClick={onClose} className="rs-pointer rs-c-fg" style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        
        <h2 className="rs-mb-2" style={{ marginTop: 0 }}>Bulk Reassign (PCS Move)</h2>
        <p className="rs-card-meta">Move all assets in this stash to another home.</p>

        {error && <div className="rs-p-2 rs-mb-4 rs-c-critical" style={{ background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

        {availableHomes.length === 0 ? (
          <div className="rs-mb-4 rs-c-warning">
            You don't have any other homes to move items to. Please create a new home first.
          </div>
        ) : (
          <form onSubmit={handleReassign}>
            <div className="rs-mb-4">
              <label className="rs-mb-2 rs-muted rs-type-tiny" style={{ display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>Destination Home</label>
              <select 
                className="rs-input rs-w-full" 
                style={{ background: 'var(--md-surface-container)' }} 
                value={targetHomeId} 
                onChange={(e) => setTargetHomeId(e.target.value)}
                required
              >
                <option value="">-- Select Destination --</option>
                {availableHomes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            
            <div className="rs-mt-5 rs-flex rs-gap-3 rs-justify-end">
              <button type="button" className="rs-btn" onClick={onClose}>CANCEL</button>
              <button type="submit" className="rs-btn-primary" disabled={loading || !targetHomeId}>
                {loading ? 'MOVING...' : 'MOVE ALL ASSETS'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
