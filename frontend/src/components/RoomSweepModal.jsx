import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function RoomSweepModal({ homeId, onClose, onComplete }) {
  const { token } = useAuth();
  const [location, setLocation] = useState('');
  const [count, setCount] = useState(0);
  
  // States for the loop
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    category: 'OTHER',
    manufacturer: '',
    description: ''
  });

  const fileInputRef = useRef(null);

  const handleCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setPhotoFile(file);
    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    
    const fd = new FormData();
    fd.append('file', file);
    
    try {
      const res = await fetch('/api/vision/inventory-item', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (res.ok) {
        const data = await res.json();
        setFormData({
          name: data.name || '',
          category: data.category?.toUpperCase() || 'OTHER',
          manufacturer: data.manufacturer || '',
          description: data.description || ''
        });
      }
    } catch (err) {
      alert("Analysis failed: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirm = async () => {
    if (!formData.name) { alert("Name is required"); return; }
    if (!location) { alert("Please set a location for this room sweep."); return; }
    
    setSaving(true);
    try {
      // 1. Create item
      const createRes = await fetch(`/api/inventory/homes/${homeId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name,
          category: formData.category,
          manufacturer: formData.manufacturer,
          description: formData.description,
          location: location
        })
      });
      if (!createRes.ok) throw new Error('Failed to create item');
      const item = await createRes.json();
      
      // 2. Upload photo
      if (photoFile) {
        const fd = new FormData();
        fd.append('file', photoFile);
        await fetch(`/api/inventory/items/${item.id}/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      }
      
      // Success, reset for next
      setCount(prev => prev + 1);
      setPhotoFile(null);
      setPreview(null);
      setFormData({ name: '', category: 'OTHER', manufacturer: '', description: '' });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // Re-trigger camera
      fileInputRef.current?.click();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = () => {
    onComplete();
    onClose();
  };

  return (
    <div className="rs-modal-overlay animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="rs-modal" style={{ width: 400, maxWidth: '90vw', padding: 24 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          Room Sweep
          <button className="rs-pill" onClick={handleFinish} style={{ padding: '4px 12px', fontSize: '0.9rem' }}>Done</button>
        </h2>
        <p style={{ opacity: 0.7, margin: 0, marginBottom: 24, fontSize: '0.9rem' }}>Captured this session: <strong>{count}</strong> items</p>
        
        <div className="rs-form-group" style={{ marginBottom: 24 }}>
          <label>Room / Location</label>
          <input 
            type="text" 
            className="rs-input" 
            value={location} 
            onChange={e => setLocation(e.target.value)} 
            placeholder="e.g. Kitchen, Master Bedroom" 
            disabled={photoFile !== null}
          />
        </div>

        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleCapture} 
        />

        {!photoFile ? (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button 
              className="rs-btn-primary" 
              onClick={() => {
                if (!location) { alert("Set location first!"); return; }
                fileInputRef.current?.click();
              }} 
              style={{ width: '100%', height: 64, fontSize: '1.2rem', gap: 12 }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '2rem' }}>photo_camera</span>
              SNAP NEXT ITEM
            </button>
          </div>
        ) : (
          <div className="rs-card" style={{ padding: 16, background: 'var(--md-surface-container)' }}>
             <img src={preview} alt="Preview" style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 8, marginBottom: 16 }} />
             
             {analyzing ? (
               <div style={{ textAlign: 'center', opacity: 0.7, padding: '24px 0' }}>
                 <span className="material-symbols-rounded" style={{ animation: 'spin 2s linear infinite', fontSize: '2rem' }}>sync</span>
                 <p>Analyzing image...</p>
               </div>
             ) : (
               <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                 <div className="rs-form-group">
                   <label>Name</label>
                   <input className="rs-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                 </div>
                 <div className="rs-form-group">
                   <label>Category</label>
                   <select className="rs-input" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                      <option value="FURNITURE">Furniture</option>
                      <option value="ELECTRONICS">Electronics</option>
                      <option value="APPLIANCES">Appliances</option>
                      <option value="TOOLS">Tools</option>
                      <option value="CLOTHING">Clothing</option>
                      <option value="VEHICLES">Vehicles</option>
                      <option value="SPORTING_GOODS">Sporting Goods</option>
                      <option value="ART">Art & Collectibles</option>
                      <option value="JEWELRY">Jewelry</option>
                      <option value="DOCUMENT">Document</option>
                      <option value="OTHER">Other</option>
                   </select>
                 </div>
                 <div className="rs-form-group">
                   <label>Manufacturer</label>
                   <input className="rs-input" value={formData.manufacturer} onChange={e => setFormData({...formData, manufacturer: e.target.value})} />
                 </div>
                 
                 <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    <button className="rs-btn-secondary" style={{ flex: 1 }} onClick={() => setPhotoFile(null)}>RETRIES</button>
                    <button className="rs-btn-primary" style={{ flex: 2 }} onClick={handleConfirm} disabled={saving}>
                      {saving ? 'SAVING...' : 'CONFIRM & NEXT'}
                    </button>
                 </div>
               </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
}
