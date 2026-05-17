import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'Apparel', 'Beauty', 'Electronics', 'Food & Beverage',
  'Fragrance', 'Health', 'Home Goods', 'Jewelry',
  'Services', 'Sports & Outdoors', 'Toys & Games', 'Other',
];

const PLATFORMS = ['Etsy', 'eBay', 'Shopify', 'Amazon'];

async function apiFetch(path, token, opts = {}) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error(`Blocked absolute URL in apiFetch: ${path}`)
  }
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'API error')
  }
  return res.status === 204 ? null : res.json()
}

function StockBadge({ qty, threshold }) {
  if (qty === 0) return <span className="rs-pill" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', borderColor: '#f87171' }}>OUT</span>;
  if (qty <= threshold) return <span className="rs-pill" style={{ background: 'rgba(250,204,21,0.1)', color: '#facc15', borderColor: '#facc15' }}>LOW</span>;
  return <span className="rs-pill" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', borderColor: '#4ade80' }}>IN STOCK</span>;
}

// ---------------------------------------------------------------------------
// Listing Builder Component
// ---------------------------------------------------------------------------

function ListingBuilder({ product }) {
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [listing, setListing] = useState({ title: '', description: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const title = `${platform} Listing: ${product.name}`;
    const desc = `${product.description || 'No description available.'}\n\nCategory: ${product.category}\nSKU: ${product.sku}`;
    setListing({ title, description: desc });
  }, [product, platform]);

  const handleCopy = () => {
    navigator.clipboard.writeText(`${listing.title}\n\n${listing.description}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--md-outline-variant)' }}>
      <div className="rs-card-label" style={{ marginBottom: 12, color: 'var(--primary)' }}>LIST ON PLATFORM</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select 
          className="rs-pill" 
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', color: 'var(--fg)', padding: '0 12px' }}
          value={platform} 
          onChange={(e) => setPlatform(e.target.value)}
        >
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="rs-pill" onClick={handleCopy}>
          {copied ? 'COPIED!' : 'COPY TO CLIPBOARD'}
        </button>
      </div>
      <div style={{ 
        padding: 12, 
        background: 'rgba(0,0,0,0.2)', 
        borderRadius: 8, 
        fontSize: '0.8rem', 
        maxHeight: 150, 
        overflowY: 'auto',
        border: '1px solid var(--md-outline-variant)'
      }}>
        <strong style={{ color: 'var(--primary)' }}>{listing.title}</strong>
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 4, opacity: 0.8 }}>{listing.description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Form (Add/Edit)
// ---------------------------------------------------------------------------

const BLANK = { name: '', sku: '', category: 'Other', description: '', stock_qty: 0, threshold: 5, unit_price: '', cost_price: '' };

function ProductForm({ initial, onSave, onCancel, saveLabel, workspaceId, token }) {
  const [form, setForm] = useState(initial ? {
    name: initial.name || '', sku: initial.sku || '', category: initial.category || 'Other',
    description: initial.description || '', stock_qty: initial.stock_qty ?? 0,
    threshold: initial.threshold ?? 5, unit_price: initial.unit_price ?? '', cost_price: initial.cost_price ?? '',
  } : BLANK);
  const [imageFile, setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(initial?.image_data || null);
  const [error, setError]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleGenerateImage = async () => {
    if (!form.name.trim()) { setError('Product name is required for generation.'); return; }
    setGenerating(true);
    setError('');
    const prompt = `${form.name} product photography, white background, professional`;
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ prompt, style: "product", context: form.description, width: 512, height: 512, steps: 20 }),
        signal: AbortSignal.timeout(90000)
      });
      if (res.status === 403) throw new Error("Image generation disabled.");
      if (!res.ok) throw new Error("Generation failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setImagePreview(url);
      const file = new File([blob], `${form.name.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
      setImageFile(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleAnalyzePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('prompt', "Analyze this product image. Return JSON with: title (string), description (string), category (string), suggested_price (number), tags (array of strings)");
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error('Analysis failed.');
      const data = await res.json();
      let structured = data;
      if (typeof data.description === 'string' && data.description.includes('{')) {
        try {
          const match = data.description.match(/\{.*\}/s);
          if (match) structured = JSON.parse(match[0]);
        } catch (e) {}
      }
      if (structured.title) setForm(f => ({ ...f, name: structured.title }));
      if (structured.description) setForm(f => ({ ...f, description: structured.description }));
      if (structured.category) setForm(f => ({ ...f, category: structured.category }));
      if (structured.suggested_price) setForm(f => ({ ...f, unit_price: structured.suggested_price }));
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target.result);
      reader.readAsDataURL(file);
      setImageFile(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Product name is required.'); return; }
    if (!form.sku.trim())  { setError('SKU is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        stock_qty:  Number(form.stock_qty),
        threshold:  Number(form.threshold),
        unit_price: form.unit_price !== '' ? Number(form.unit_price) : null,
        cost_price: form.cost_price !== '' ? Number(form.cost_price) : null,
      };
      await onSave(payload, imageFile);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 32, border: '1px solid var(--primary)' }}>
      {error && <div style={{ color: '#f87171', marginBottom: 16, fontSize: '0.85rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ width: 160 }}>
          <div 
            style={{ 
              width: 160, height: 160, 
              border: '2px dashed var(--md-outline-variant)', 
              borderRadius: 'var(--md-shape-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', 
              cursor: 'pointer', overflow: 'hidden'
            }} 
            onClick={() => fileRef.current.click()}
          >
            {imagePreview
              ? <img src={imagePreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span className="rs-card-label">+ IMAGE</span>
            }
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <label className="rs-pill" style={{ cursor: analyzing ? 'default' : 'pointer', justifyContent: 'center' }}>
              <span className="material-symbols-rounded">visibility</span>
              {analyzing ? '...' : 'ANALYZE'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAnalyzePhoto} disabled={analyzing} />
            </label>
            <button className="rs-pill" onClick={handleGenerateImage} disabled={generating} style={{ justifyContent: 'center' }}>
              <span className="material-symbols-rounded">auto_awesome</span>
              {generating ? '...' : 'GENERATE'}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">PRODUCT NAME *</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} value={form.name} onChange={set('name')} placeholder="e.g. Midnight Bloom" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">SKU *</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} value={form.sku} onChange={set('sku')} placeholder="e.g. HBH-MB-001" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">CATEGORY</label>
              <select style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">STOCK QTY</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} type="number" min="0" value={form.stock_qty} onChange={set('stock_qty')} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">THRESHOLD</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} type="number" min="0" value={form.threshold} onChange={set('threshold')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">SALE PRICE ($)</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} type="number" min="0" step="0.01" value={form.unit_price} onChange={set('unit_price')} placeholder="0.00" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="rs-card-label">COST PRICE ($)</label>
              <input style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }} type="number" min="0" step="0.01" value={form.cost_price} onChange={set('cost_price')} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="rs-card-label">DESCRIPTION</label>
            <textarea style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)', resize: 'vertical' }} value={form.description} onChange={set('description')} rows={2} placeholder="Optional notes..." />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
        <button className="rs-pill" onClick={onCancel} disabled={saving}>CANCEL</button>
        <button className="rs-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'SAVING...' : (saveLabel || 'SAVE')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Card Component
// ---------------------------------------------------------------------------

function ProductCard({ product, onEdit, onDelete, onGenerateImage }) {
  const [showListing, setShowListing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGen = async () => {
    setGenerating(true);
    await onGenerateImage(product);
    setGenerating(false);
  };

  return (
    <div className="rs-card animate-fade-in" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', height: 180, background: 'rgba(0,0,0,0.2)' }}>
        {product.image_data
          ? <img src={product.image_data} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, fontSize: '2rem' }}>
              {product.category?.slice(0,3).toUpperCase() || 'IMG'}
            </div>
        }
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <StockBadge qty={product.stock_qty} threshold={product.threshold} />
        </div>
      </div>
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>{product.sku}</div>
        <div className="rs-card-value" style={{ fontSize: '1.1rem', marginBottom: 8 }}>{product.name}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span className="rs-card-meta" style={{ margin: 0 }}>{product.category}</span>
          {product.unit_price != null && <span style={{ color: 'var(--primary)', fontWeight: 600 }}>${Number(product.unit_price).toFixed(2)}</span>}
        </div>
        
        <div style={{ marginTop: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="rs-pill" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => onEdit(product)}>EDIT</button>
          <button className="rs-pill" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={handleGen} disabled={generating}>
            {generating ? '...' : 'GEN'}
          </button>
          <button className="rs-pill" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => setShowListing(!showListing)}>
            {showListing ? 'HIDE' : 'LIST'}
          </button>
          <button className="rs-pill" style={{ padding: '4px 8px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f87171' }} onClick={() => onDelete(product.id)}>DEL</button>
        </div>

        {showListing && <ListingBuilder product={product} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function CommercePage({ setAction }) {
  const { token } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError]     = useState('')
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('ALL');
  const [formMode, setFormMode]     = useState('none');
  const [editProduct, setEditProduct] = useState(null);

  const fetchWorkspace = useCallback(async () => {
    if (!token) return
    try {
      const list = await apiFetch('/api/commerce/workspaces', token)
      if (list.length > 0) setWorkspace(list[0])
    } catch (e) {
      setWsError(e.message)
    } finally {
      setWsLoading(false)
    }
  }, [token])

  const fetchProducts = useCallback(async () => {
    if (!token || !workspace) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/commerce/workspaces/${workspace.id}/products`, token);
      setProducts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [token, workspace]);

  useEffect(() => { fetchWorkspace() }, [fetchWorkspace]);
  useEffect(() => { fetchProducts() }, [fetchProducts]);

  useEffect(() => {
    if (!workspace) {
      setAction(null)
      return
    }

    setAction(
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span className="material-symbols-rounded" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>search</span>
          <input 
            style={{ 
              width: '100%', background: 'rgba(255,255,255,0.08)', 
              border: '1px solid var(--md-outline-variant)', 
              borderRadius: 30, padding: '10px 12px 10px 40px', color: 'var(--fg)',
              fontSize: '0.92rem'
            }} 
            placeholder="Search products..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </div>
        <button className="rs-btn-primary" onClick={() => { setFormMode('add'); window.scrollTo(0,0); }}>
          <span className="material-symbols-rounded">add</span>
          PRODUCT
        </button>
      </div>
    )
  }, [workspace, search, setAction])

  const uploadImage = async (productId, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await apiFetch(`/api/commerce/products/${productId}/image`, token, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
  };

  const handleAdd = async (payload, imageFile) => {
    const p = await apiFetch(`/api/commerce/workspaces/${workspace.id}/products`, token, {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (imageFile) await uploadImage(p.id, imageFile);
    setFormMode('none');
    fetchProducts();
  };

  const handleEdit = async (payload, imageFile) => {
    await apiFetch(`/api/commerce/products/${editProduct.id}`, token, {
      method: 'PATCH', body: JSON.stringify(payload),
    });
    if (imageFile) await uploadImage(editProduct.id, imageFile);
    setFormMode('none');
    setEditProduct(null);
    fetchProducts();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    await apiFetch(`/api/commerce/products/${id}`, token, { method: 'DELETE' });
    fetchProducts();
  };

  const handleGenerateProductImage = async (product) => {
    const prompt = `${product.name} product photography, white background, professional`;
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ prompt, style: "product", context: product.description }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const blob = await res.blob();
      const file = new File([blob], "generated.png", { type: "image/png" });
      await uploadImage(product.id, file);
      fetchProducts();
    } catch (e) {
      alert(e.message);
    }
  };

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchCat = filterCat === 'ALL' || p.category === filterCat;
    return matchSearch && matchCat;
  });

  if (wsLoading) return <div className="rs-foyer"><div className="rs-card-meta">Initializing...</div></div>;
  if (wsError) return <div className="rs-foyer"><div className="rs-card" style={{ color: '#f87171' }}>{wsError}</div></div>;

  return (
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-status-strip" style={{ marginBottom: 16 }}>
          <span className="rs-status-dot" />
          <span>TOOLS / COMMERCE</span>
        </div>
        <h1 className="rs-greeting">Inventory</h1>
        {workspace && <div className="rs-greeting-sub">Managing {workspace.name}.</div>}
      </header>

      {!workspace ? (
        <div className="rs-card-flow">
          <CreateWorkspaceForm token={token} onCreate={setWorkspace} />
        </div>
      ) : (
        <div className="rs-card-flow">
          {formMode !== 'none' && (
            <ProductForm
              initial={editProduct}
              workspaceId={workspace.id}
              token={token}
              onSave={formMode === 'add' ? handleAdd : handleEdit}
              onCancel={() => { setFormMode('none'); setEditProduct(null); }}
              saveLabel={formMode === 'add' ? "ADD PRODUCT" : "SAVE CHANGES"}
            />
          )}

          {loading ? (
            <div className="rs-card is-wide" style={{ textAlign: 'center' }}>
              <span className="rs-card-meta">Syncing inventory data...</span>
            </div>
          ) : (
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
              {filtered.map(p => (
                <ProductCard 
                  key={p.id} 
                  product={p} 
                  onEdit={(p) => { setEditProduct(p); setFormMode('edit'); window.scrollTo(0,0); }} 
                  onDelete={handleDelete}
                  onGenerateImage={handleGenerateProductImage}
                />
              ))}
            </div>
          )}
          
          {filtered.length === 0 && !loading && (
            <div className="rs-card is-wide" style={{ textAlign: 'center', padding: 48, borderStyle: 'dashed' }}>
              <div className="rs-card-meta">No products found matching your criteria.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateWorkspaceForm({ token, onCreate }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      const ws = await apiFetch('/api/commerce/workspaces', token, {
        method: 'POST', body: JSON.stringify({ name: name.trim(), currency: 'USD', tax_rate: 0 }),
      })
      onCreate(ws)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="rs-card animate-fade-in" style={{ maxWidth: 500 }}>
      <span className="rs-card-label" style={{ color: 'var(--primary)' }}>CREATE YOUR FIRST WORKSPACE</span>
      <p className="rs-card-meta" style={{ marginBottom: 20 }}>Workspaces organize your products, stock, and listings.</p>
      {error && <div style={{ color: '#f87171', marginBottom: 12, fontSize: '0.8rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <input 
          style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: 10, color: 'var(--fg)' }}
          placeholder="e.g. My Boutique" 
          value={name} 
          onChange={e => setName(e.target.value)} 
        />
        <button className="rs-btn-primary" onClick={handleCreate} disabled={busy}>{busy ? '...' : 'CREATE'}</button>
      </div>
    </div>
  )
}
