import React, { useState, useEffect, useRef } from 'react';
import './MaintenancePulse.css';
import { useAuth } from '../context/AuthContext.jsx';
import RsMarkdown from './RsMarkdown.jsx';

async function apiFetch(path, token, opts = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  
  const res = await fetch(path, { headers, ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.status === 204 ? null : res.json();
}

export default function JobWalkthroughModal({ vehicle, checkpoint, onClose, onLogComplete }) {
  const { token } = useAuth();
  const [media, setMedia] = useState([]);
  const [manualExcerpt, setManualExcerpt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(true);
  
  // For logging
  const [actualValue, setActualValue] = useState('');
  const [status, setStatus] = useState('pass'); // pass, warn, fail
  
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, [checkpoint.id]);

  const loadData = async () => {
    setLoadingMedia(true);
    try {
      const mediaList = await apiFetch(`/api/vehicles/${vehicle.id}/media?checkpoint_id=${checkpoint.id}`, token);
      setMedia(mediaList || []);
      
      try {
        const ragRes = await apiFetch(`/api/vehicles/${vehicle.id}/query`, token, {
           method: 'POST', body: JSON.stringify({ query: `How to perform ${checkpoint.description}` })
        });
        setManualExcerpt(ragRes.answer);
      } catch(e) {
        setManualExcerpt("No manual excerpt available.");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch(`/api/vehicles/${vehicle.id}/media?checkpoint_id=${checkpoint.id}`, token, {
        method: 'POST',
        body: fd
      });
      setMedia([...media, res]);
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setBusy(false);
      e.target.value = null;
    }
  };
  
  const handleArchiveWeb = async () => {
    const q = window.prompt("Ask River to find a guide for this job. What should she search for?", `How to do ${checkpoint.description} on ${vehicle.year || ''} ${vehicle.make} ${vehicle.model}`);
    if (!q) return;
    
    setBusy(true);
    try {
      const res = await apiFetch(`/api/vehicles/${vehicle.id}/media/archive`, token, {
        method: 'POST',
        body: JSON.stringify({ query: q, checkpoint_id: checkpoint.id })
      });
      alert(`Archived: ${res.title}`);
      setMedia([...media, res]);
    } catch(e) {
      alert("Archive failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  const completeJob = () => {
    onLogComplete({
      checkpoint_id: checkpoint.id,
      actual_value: actualValue,
      status: status
    });
  };

  const svcColor = checkpoint.service_level === 'replace' ? 'var(--rs-status-critical)' : 
                   checkpoint.service_level === 'service' ? 'var(--rs-status-warning)' : 'var(--primary)';

  return (
    <div className="rs-modal-overlay">
      <div className="rs-modal" style={{ width: '800px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="rs-modal-close" onClick={onClose}>✕</button>
        <h2 style={{ color: svcColor, marginTop: 0 }}>
          {checkpoint.service_level.toUpperCase()} : {checkpoint.description}
        </h2>
        
        <div className="form-grid" style={{ marginBottom: '20px' }}>
          {checkpoint.expected_spec && (
            <div className="pulse-field">
              <label className="rs-card-label">SPECIFICATION</label>
              <div className="rs-card-value">{checkpoint.expected_spec} {checkpoint.unit ? `(${checkpoint.unit})` : ''} {checkpoint.volume ? `[${checkpoint.volume}]` : ''}</div>
            </div>
          )}
          {(checkpoint.ft_lb || checkpoint.nm) && (
            <div className="pulse-field">
              <label className="rs-card-label">TORQUE</label>
              <div className="rs-card-value">{checkpoint.ft_lb ? `${checkpoint.ft_lb} ft-lb` : ''} {checkpoint.nm ? `/ ${checkpoint.nm} N·m` : ''}</div>
            </div>
          )}
        </div>

        <h3 className="rs-card-label">» MANUAL EXCERPT</h3>
        <div style={{ background: 'var(--bg-layer-2)', padding: '12px', borderRadius: '8px', marginBottom: '20px', minHeight: '60px' }}>
          <RsMarkdown content={manualExcerpt} />
        </div>

        <h3 className="rs-card-label">» MEDIA GALLERY</h3>
        <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', marginBottom: '20px', paddingBottom: '10px' }}>
          {media.map(m => (
            <div key={m.id} style={{ position: 'relative', width: '150px', height: '100px', flexShrink: 0, borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
              <img src={`/api/vehicles/media/${m.id}?thumb=true`} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: m.kind === 'video' ? 0.7 : 1 }} alt={m.title} 
                   onError={(e) => { e.target.style.display = 'none'; }} />
              {m.kind === 'video' && <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#fff'}}>▶</div>}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', padding: '4px' }}>
                {m.title}
              </div>
              <a href={`/api/vehicles/media/${m.id}`} target="_blank" rel="noreferrer" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            </div>
          ))}
          {media.length === 0 && !loadingMedia && <div style={{ color: 'var(--text-dim)' }}>No media attached to this checkpoint.</div>}
          {loadingMedia && <div style={{ color: 'var(--text-dim)' }}>Loading media...</div>}
        </div>
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*" onChange={handleUpload} />
          <button className="rs-pill" onClick={() => fileInputRef.current.click()} disabled={busy}>+ UPLOAD MEDIA</button>
          <button className="rs-pill" onClick={handleArchiveWeb} disabled={busy}>FIND A GUIDE (WEB)</button>
        </div>

        <hr style={{ borderColor: 'var(--border-color)', margin: '20px 0' }} />
        
        <h3 className="rs-card-label">» LOG COMPLETION</h3>
        <div className="form-grid">
          <div className="pulse-field">
            <label className="rs-card-label">ACTUAL VALUE / OBSERVATION</label>
            <input className="cyber-input" value={actualValue} onChange={e => setActualValue(e.target.value)} placeholder="e.g. 5mm remaining, looks good" />
          </div>
          <div className="pulse-field">
            <label className="rs-card-label">STATUS</label>
            <select className="cyber-input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="pass">Pass</option>
              <option value="warn">Warn</option>
              <option value="fail">Fail</option>
            </select>
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button className="rs-pill" onClick={onClose}>CANCEL</button>
          <button className="rs-pill is-active" onClick={completeJob}>COMPLETE & LOG</button>
        </div>
      </div>
    </div>
  );
}
