import React, { useState, useRef } from 'react';

export default function AssetDetailModal({ item, onClose, token, onUpdate }) {
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadingWarranty, setUploadingWarranty] = useState(false);
  const [error, setError] = useState('');
  
  const receiptFileRef = useRef(null);
  const warrantyFileRef = useRef(null);

  const handleUploadReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingReceipt(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`/api/inventory/items/${item.id}/receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to upload receipt');
      }
      onUpdate(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleUploadWarranty = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingWarranty(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch(`/api/inventory/items/${item.id}/warranty-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to upload warranty');
      }
      onUpdate(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingWarranty(false);
    }
  };

  if (!item) return null;

  return (
    <div className="barcode-scanner-modal" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 500, padding: 24, position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}>
          <span className="material-symbols-rounded">close</span>
        </button>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{item.name}</h2>
        <div className="rs-status-strip" style={{ marginBottom: 24 }}>
          <span className="rs-status-dot" style={{ background: '#4ade80' }} />
          <span>{item.category || 'ASSET'} • QTY: {item.quantity}</span>
        </div>

        {error && <div style={{ color: '#f87171', padding: 8, background: 'rgba(248,113,113,0.1)', marginBottom: 16 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="rs-card-inner">
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Receipt</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button 
                className="rs-btn-primary" 
                onClick={() => receiptFileRef.current?.click()}
                disabled={uploadingReceipt}
              >
                <span className="material-symbols-rounded">upload</span>
                {uploadingReceipt ? 'UPLOADING...' : 'UPLOAD RECEIPT'}
              </button>
              <input type="file" ref={receiptFileRef} onChange={handleUploadReceipt} style={{ display: 'none' }} accept="image/*,application/pdf" />
              {item.receipt_url && <span style={{ color: '#4ade80' }}>Receipt attached</span>}
            </div>
          </div>

          <div className="rs-card-inner">
            <h3 style={{ fontSize: '1rem', marginTop: 0 }}>Warranty</h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button 
                className="rs-btn-primary" 
                onClick={() => warrantyFileRef.current?.click()}
                disabled={uploadingWarranty}
              >
                <span className="material-symbols-rounded">upload</span>
                {uploadingWarranty ? 'UPLOADING...' : 'UPLOAD WARRANTY'}
              </button>
              <input type="file" ref={warrantyFileRef} onChange={handleUploadWarranty} style={{ display: 'none' }} accept="image/*,application/pdf" />
              {item.warranty_url && <span style={{ color: '#4ade80' }}>Warranty attached</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
