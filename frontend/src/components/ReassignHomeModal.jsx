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
    <div className="barcode-scanner-modal" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 500, padding: 24, position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Bulk Reassign (PCS Move)</h2>
        <p className="rs-card-meta">Move all assets in this stash to another home.</p>

        {error && <div style={{ color: '#f87171', padding: 8, background: 'rgba(248,113,113,0.1)', marginBottom: 16 }}>{error}</div>}

        {availableHomes.length === 0 ? (
          <div style={{ color: '#facc15', marginBottom: 16 }}>
            You don't have any other homes to move items to. Please create a new home first.
          </div>
        ) : (
          <form onSubmit={handleReassign}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', opacity: 0.7, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Destination Home</label>
              <select 
                className="rs-input" 
                style={{ width: '100%', background: 'var(--md-surface-container)' }} 
                value={targetHomeId} 
                onChange={(e) => setTargetHomeId(e.target.value)}
                required
              >
                <option value="">-- Select Destination --</option>
                {availableHomes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
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
