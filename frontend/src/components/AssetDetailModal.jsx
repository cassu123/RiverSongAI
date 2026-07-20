import React, { useState, useEffect, useRef } from 'react';

const CATEGORIES = [
  'FURNITURE', 'ELECTRONICS', 'APPLIANCES', 'TOOLS',
  'CLOTHING', 'VEHICLES', 'SPORTING_GOODS', 'ART',
  'JEWELRY', 'DOCUMENT', 'OTHER'
];

export default function AssetDetailModal({ item, homeId, onClose, token, onUpdate }) {
  const isNew = !item || item._isNew;
  
  const [formData, setFormData] = useState(isNew ? {
    name: '', category: 'OTHER', quantity: 1, location: '',
    manufacturer: '', model_number: '', serial_number: '',
    purchase_price: '', purchase_date: '', replacement_cost: '',
    warranty_expiry_date: '', is_insured: false, description: ''
  } : {
    name: item.name || '', category: item.category || 'OTHER', quantity: item.quantity || 1, location: item.location || '',
    manufacturer: item.manufacturer || '', model_number: item.model_number || '', serial_number: item.serial_number || '',
    purchase_price: item.purchase_price || '', purchase_date: item.purchase_date || '', replacement_cost: item.replacement_cost || '',
    warranty_expiry_date: item.warranty_expiry_date || '', is_insured: item.is_insured || false, description: item.description || ''
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  
  // Attachments & Uploads
  const [attachments, setAttachments] = useState([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadingWarranty, setUploadingWarranty] = useState(false);

  const photoInputRef = useRef(null);
  const receiptInputRef = useRef(null);
  const warrantyInputRef = useRef(null);

  useEffect(() => {
    if (!isNew && item.id) {
      fetch(`/api/inventory/items/${item.id}/attachments`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(r => r.json())
      .then(data => setAttachments(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to load attachments:', err));
    }
  }, [item, isNew, token]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...formData };
      if (!payload.purchase_price) payload.purchase_price = null;
      if (!payload.replacement_cost) payload.replacement_cost = null;
      if (!payload.purchase_date) payload.purchase_date = null;
      if (!payload.warranty_expiry_date) payload.warranty_expiry_date = null;

      let url = `/api/inventory/homes/${homeId}/items`;
      let method = 'POST';
      if (!isNew) {
        url = `/api/inventory/items/${item.id}`;
        method = 'PATCH';
      }

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Failed to save item');
      }
      
      const savedItem = await res.json();
      onUpdate(savedItem);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this asset?")) return;
    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to delete');
      
      // We pass a dummy object with _deleted flag so the parent can filter it out
      onUpdate({ ...item, _deleted: true });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadFile = async (url, file, setLoader) => {
    setLoader(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error('Upload failed');
      return await res.json();
    } finally {
      setLoader(false);
    }
  };

  const handleAddPhoto = async (e) => {
    if (isNew) {
      alert("Please save the item first before adding a photo.");
      return;
    }
    const file = e.target.files[0];
    if (!file) return;
    try {
      const att = await uploadFile(`/api/inventory/items/${item.id}/attachments`, file, setUploadingImage);
      // For now, assume the backend just adds it. We can refetch or just push:
      setAttachments(prev => [...prev, att]);
    } catch(err) {
      alert(err.message);
    }
  };
  
  const handleUploadReceipt = async (e) => {
    if (isNew) { alert("Please save first."); return; }
    const file = e.target.files[0];
    if (!file) return;
    try {
      const updated = await uploadFile(`/api/inventory/items/${item.id}/receipt`, file, setUploadingReceipt);
      onUpdate(updated);
    } catch(err) { alert(err.message); }
  };
  
  const handleUploadWarranty = async (e) => {
    if (isNew) { alert("Please save first."); return; }
    const file = e.target.files[0];
    if (!file) return;
    try {
      const updated = await uploadFile(`/api/inventory/items/${item.id}/warranty-image`, file, setUploadingWarranty);
      onUpdate(updated);
    } catch(err) { alert(err.message); }
  };

  const deleteAttachment = async (id) => {
    if (!window.confirm("Delete photo?")) return;
    try {
      await fetch(`/api/inventory/attachments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setAttachments(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="rs-modal-overlay animate-fade-in" onClick={onClose} style={{ display: 'flex', alignItems: 'flex-start', paddingTop: '10vh' }}>
      <div className="rs-modal" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 700, margin: '0 auto', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="rs-modal-header">
          <h2>{isNew ? 'New Asset' : 'Edit Asset'}</h2>
          {!isNew && item.ein && <div className="rs-pill" style={{ fontFamily: 'var(--font-mono)' }}>{item.ein}</div>}
          <button className="rs-modal-close" onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="rs-modal-body">
          {error && <div className="rs-status-strip" style={{ background: 'rgba(248,113,113,0.2)', color: '#f87171', marginBottom: 16 }}>{error}</div>}

          {!isNew && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
                {attachments.map(att => (
                   <div key={att.id} style={{ position: 'relative', width: 120, height: 120, borderRadius: 8, overflow: 'hidden', background: 'var(--md-surface-container-high)', flexShrink: 0 }}>
                     <img src={`/api/inventory/attachments/${att.id}/download?token=${token}`} alt="Attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                     <button onClick={() => deleteAttachment(att.id)} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer' }}>
                       <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>close</span>
                     </button>
                   </div>
                ))}
                <div 
                  onClick={() => photoInputRef.current.click()}
                  style={{ width: 120, height: 120, borderRadius: 8, background: 'var(--md-surface-container)', border: '2px dashed var(--md-outline-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, opacity: uploadingImage ? 0.5 : 1 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '2rem', color: 'var(--md-on-surface-variant)' }}>
                    {uploadingImage ? 'hourglass_empty' : 'add_a_photo'}
                  </span>
                </div>
                <input type="file" accept="image/*" capture="environment" ref={photoInputRef} style={{ display: 'none' }} onChange={handleAddPhoto} />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="rs-form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Asset Name</label>
              <input type="text" className="rs-input" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. DeWalt 20V Max Drill" autoFocus />
            </div>
            
            <div className="rs-form-group">
              <label>Category</label>
              <select className="rs-input" name="category" value={formData.category} onChange={handleChange}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="rs-form-group">
              <label>Location / Room</label>
              <input type="text" className="rs-input" name="location" value={formData.location} onChange={handleChange} placeholder="e.g. Garage" />
            </div>

            <div className="rs-form-group">
              <label>Manufacturer</label>
              <input type="text" className="rs-input" name="manufacturer" value={formData.manufacturer} onChange={handleChange} />
            </div>

            <div className="rs-form-group">
              <label>Model Number</label>
              <input type="text" className="rs-input" name="model_number" value={formData.model_number} onChange={handleChange} />
            </div>

            <div className="rs-form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Serial Number</label>
              <input type="text" className="rs-input" name="serial_number" value={formData.serial_number} onChange={handleChange} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>

            <div className="rs-form-group">
              <label>Purchase Price ($)</label>
              <input type="number" step="0.01" className="rs-input" name="purchase_price" value={formData.purchase_price} onChange={handleChange} />
            </div>

            <div className="rs-form-group">
              <label>Replacement Cost ($)</label>
              <input type="number" step="0.01" className="rs-input" name="replacement_cost" value={formData.replacement_cost} onChange={handleChange} />
            </div>

            <div className="rs-form-group">
              <label>Purchase Date</label>
              <input type="date" className="rs-input" name="purchase_date" value={formData.purchase_date} onChange={handleChange} />
            </div>

            <div className="rs-form-group">
              <label>Warranty Expiry</label>
              <input type="date" className="rs-input" name="warranty_expiry_date" value={formData.warranty_expiry_date} onChange={handleChange} />
            </div>

            <div className="rs-form-group" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" name="is_insured" checked={formData.is_insured} onChange={handleChange} id="is_insured_chk" style={{ width: 18, height: 18 }} />
              <label htmlFor="is_insured_chk" style={{ margin: 0, cursor: 'pointer' }}>Separately Scheduled / Insured</label>
            </div>

            <div className="rs-form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <textarea className="rs-input" name="description" value={formData.description} onChange={handleChange} rows={3}></textarea>
            </div>
          </div>
          
          {!isNew && (
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24, padding: 16, background: 'var(--md-surface-container)', borderRadius: 12 }}>
                <div>
                   <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--md-on-surface-variant)' }}>RECEIPT</h4>
                   {item.receipt_image_path ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                         <span className="material-symbols-rounded" style={{ color: '#4ade80' }}>check_circle</span>
                         <span style={{ fontSize: '0.85rem' }}>Attached</span>
                         <button className="rs-pill" onClick={() => receiptInputRef.current.click()}>Replace</button>
                      </div>
                   ) : (
                      <button className="rs-pill" onClick={() => receiptInputRef.current.click()} disabled={uploadingReceipt}>
                        {uploadingReceipt ? 'Uploading...' : 'Upload Receipt'}
                      </button>
                   )}
                   <input type="file" accept="image/*,application/pdf" ref={receiptInputRef} style={{ display: 'none' }} onChange={handleUploadReceipt} />
                </div>
                <div>
                   <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--md-on-surface-variant)' }}>WARRANTY</h4>
                   {item.warranty_image_path ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                         <span className="material-symbols-rounded" style={{ color: '#4ade80' }}>check_circle</span>
                         <span style={{ fontSize: '0.85rem' }}>Attached</span>
                         <button className="rs-pill" onClick={() => warrantyInputRef.current.click()}>Replace</button>
                      </div>
                   ) : (
                      <button className="rs-pill" onClick={() => warrantyInputRef.current.click()} disabled={uploadingWarranty}>
                        {uploadingWarranty ? 'Uploading...' : 'Upload Warranty'}
                      </button>
                   )}
                   <input type="file" accept="image/*,application/pdf" ref={warrantyInputRef} style={{ display: 'none' }} onChange={handleUploadWarranty} />
                </div>
             </div>
          )}
          
          {!isNew && item.qr_code_data && (
             <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                <img src={`data:image/png;base64,${item.qr_code_data}`} alt="QR Code" style={{ width: 120, height: 120, imageRendering: 'pixelated' }} />
             </div>
          )}

        </div>
        
        <div className="rs-modal-footer" style={{ justifyContent: 'space-between' }}>
          {!isNew ? (
             <button className="rs-btn-primary" style={{ background: 'transparent', color: '#f87171', border: '1px solid #f87171' }} onClick={handleDelete}>
               DELETE
             </button>
          ) : <div></div>}
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="rs-pill" onClick={onClose} disabled={saving}>CANCEL</button>
            <button className="rs-btn-primary" onClick={handleSave} disabled={saving || !formData.name}>
              {saving ? 'SAVING...' : 'SAVE ASSET'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
