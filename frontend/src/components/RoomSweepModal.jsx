import { useState, useRef } from 'react';
import { useAuth } from '@context/AuthContext';

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
    category: 'Other',
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
          category: data.category || 'Other',
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
    <div className="rs-modal-overlay animate-fade-in rs-flex rs-items-center rs-justify-center">
      <div className="rs-modal rs-p-5" style={{ width: 400, maxWidth: '90vw' }}>
        <h2 className="rs-mb-2 rs-flex rs-justify-between" style={{ marginTop: 0 }}>
          Room Sweep
          <button className="rs-pill" onClick={handleFinish} style={{ padding: '4px 12px', fontSize: 'var(--rs-fs-small)' }}>Done</button>
        </h2>
        <p style={{ color: 'var(--text-muted)', margin: 0, marginBottom: 24, fontSize: 'var(--rs-fs-small)' }}>Captured this session: <strong>{count}</strong> items</p>
        
        <div className="rs-form-group rs-mb-5">
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
          className="rs-hidden" 
          onChange={handleCapture} 
        />

        {!photoFile ? (
          <div className="rs-text-center rs-mt-6">
            <button 
              className="rs-btn-primary rs-w-full rs-gap-3" 
              onClick={() => {
                if (!location) { alert("Set location first!"); return; }
                fileInputRef.current?.click();
              }} 
              style={{ height: 64, fontSize: 'var(--rs-fs-h3)' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '2rem' }}>photo_camera</span>
              SNAP NEXT ITEM
            </button>
          </div>
        ) : (
          <div className="rs-card rs-p-4" style={{ background: 'var(--md-surface-container)' }}>
             <img src={preview} alt="Preview" className="rs-w-full rs-mb-4" style={{ height: 200, objectFit: 'cover', borderRadius: 8 }} />
             
             {analyzing ? (
               <div className="rs-text-center" style={{ opacity: 0.7, padding: '24px 0' }}>
                 <span className="material-symbols-rounded" style={{ animation: 'spin 2s linear infinite', fontSize: '2rem' }}>sync</span>
                 <p>Analyzing image...</p>
               </div>
             ) : (
               <div className="rs-flex rs-flex-col rs-gap-3">
                 <div className="rs-form-group">
                   <label>Name</label>
                   <input className="rs-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                 </div>
                 <div className="rs-form-group">
                   <label>Category</label>
                   <select className="rs-input" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                      <option value="Furniture">Furniture</option>
                      <option value="Electronics">Electronics</option>
                      <option value="Appliance">Appliances</option>
                      <option value="Tool">Tools</option>
                      <option value="Clothing">Clothing</option>
                      <option value="Vehicle">Vehicles</option>
                      <option value="Sporting Goods">Sporting Goods</option>
                      <option value="Collectible">Art & Collectibles</option>
                      <option value="Jewelry">Jewelry</option>
                      <option value="Document">Document</option>
                      <option value="Other">Other</option>
                   </select>
                 </div>
                 <div className="rs-form-group">
                   <label>Manufacturer</label>
                   <input className="rs-input" value={formData.manufacturer} onChange={e => setFormData({...formData, manufacturer: e.target.value})} />
                 </div>
                 
                 <div className="rs-flex rs-gap-3 rs-mt-4">
                    <button className="rs-btn-secondary rs-grow" onClick={() => setPhotoFile(null)}>RETRIES</button>
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
