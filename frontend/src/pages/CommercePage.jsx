import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './CommercePage.css'

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
  if (qty === 0) return <span className="iv-badge iv-badge--out">OUT</span>;
  if (qty <= threshold) return <span className="iv-badge iv-badge--low">LOW</span>;
  return <span className="iv-badge iv-badge--ok">IN STOCK</span>;
}

// ---------------------------------------------------------------------------
// Listing Builder Component
// ---------------------------------------------------------------------------

function ListingBuilder({ product }) {
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [listing, setListing] = useState({ title: '', description: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Auto-generate listing text based on product
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
    <div className="iv-listing-builder">
      <div className="iv-listing-title">LIST ON PLATFORM</div>
      <div className="iv-form-row">
        <select className="iv-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={handleCopy}>
          {copied ? 'COPIED!' : 'COPY TO CLIPBOARD'}
        </button>
      </div>
      <div className="iv-listing-preview">
        <strong>{listing.title}</strong>
        <p>{listing.description}</p>
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
    
    // Prompt as requested in Task 1B
    const prompt = `${form.name} product photography, white background, professional`;
    
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          prompt,
          style: "product",
          context: form.description,
          width: 512,
          height: 512,
          steps: 20
        }),
        signal: AbortSignal.timeout(90000)
      });
      
      if (res.status === 403) throw new Error("Image generation disabled in settings.");
      if (res.status === 503) throw new Error("Image generation service unavailable.");
      if (!res.ok) throw new Error("Image generation failed.");
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setImagePreview(url);
      
      const file = new File([blob], `${form.name.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
      setImageFile(file);
      
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Generation timed out (90s).' : err.message);
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
      // prompt as requested in Task 1A
      fd.append('prompt', "Analyze this product image. Return JSON with: title (string), description (string), category (string), suggested_price (number), tags (array of strings)");

      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error(res.status === 503 ? 'Vision model not enabled.' : 'Analysis failed.');
      const data = await res.json();

      // The backend /analyze might return just description string if not using listing endpoint,
      // but the prompt asked for structured data. We try to parse if it's a string.
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
      
      // Update preview if we just uploaded a file
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
      const saved = await onSave(payload, imageFile);
      return saved;
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="iv-form-panel">
      {error && <div className="iv-error">{error}</div>}
      <div className="iv-form-body">
        <div className="iv-form-image-col">
          <div className="iv-form-image-drop" onClick={() => fileRef.current.click()} title="Click to upload image">
            {imagePreview
              ? <img src={imagePreview} alt="preview" className="iv-form-image-preview" />
              : <span className="iv-form-image-hint">+ IMAGE</span>
            }
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label className="iv-btn iv-btn--ghost iv-btn--sm" style={{ cursor: analyzing ? 'default' : 'pointer', opacity: analyzing ? 0.7 : 1 }}>
              {analyzing ? 'Analyzing...' : 'Analyze Photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAnalyzePhoto} disabled={analyzing} />
            </label>
            <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={handleGenerateImage} disabled={generating}>
              {generating ? 'Generating...' : '✨ Generate Image'}
            </button>
          </div>
        </div>

        <div className="iv-form-fields">
          <div className="iv-form-row">
            <div className="iv-field">
              <label className="iv-label">PRODUCT NAME *</label>
              <input className="iv-input" value={form.name} onChange={set('name')} placeholder="e.g. Midnight Bloom" />
            </div>
            <div className="iv-field">
              <label className="iv-label">SKU *</label>
              <input className="iv-input" value={form.sku} onChange={set('sku')} placeholder="e.g. HBH-MB-001" />
            </div>
          </div>
          <div className="iv-form-row">
            <div className="iv-field">
              <label className="iv-label">CATEGORY</label>
              <select className="iv-input" value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="iv-field">
              <label className="iv-label">STOCK QTY</label>
              <input className="iv-input" type="number" min="0" value={form.stock_qty} onChange={set('stock_qty')} />
            </div>
            <div className="iv-field">
              <label className="iv-label">LOW STOCK THRESHOLD</label>
              <input className="iv-input" type="number" min="0" value={form.threshold} onChange={set('threshold')} />
            </div>
          </div>
          <div className="iv-form-row">
            <div className="iv-field">
              <label className="iv-label">SALE PRICE ($)</label>
              <input className="iv-input" type="number" min="0" step="0.01" value={form.unit_price} onChange={set('unit_price')} placeholder="0.00" />
            </div>
            <div className="iv-field">
              <label className="iv-label">COST PRICE ($)</label>
              <input className="iv-input" type="number" min="0" step="0.01" value={form.cost_price} onChange={set('cost_price')} placeholder="0.00" />
            </div>
          </div>
          <div className="iv-field">
            <label className="iv-label">DESCRIPTION</label>
            <textarea className="iv-input iv-textarea" value={form.description} onChange={set('description')} rows={2} placeholder="Optional notes..." />
          </div>
        </div>
      </div>

      <div className="iv-form-footer">
        <button className="iv-btn iv-btn--ghost" onClick={onCancel} disabled={saving}>CANCEL</button>
        <button className="iv-btn iv-btn--primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'SAVING...' : (saveLabel || '>> SAVE')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Card Component
// ---------------------------------------------------------------------------

function ProductCard({ product, onEdit, onDelete, onGenerateImage, token }) {
  const [showListing, setShowListing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGen = async () => {
    setGenerating(true);
    await onGenerateImage(product);
    setGenerating(false);
  };

  return (
    <div className={`iv-card ${product.stock_qty === 0 ? 'iv-card--out' : product.stock_qty <= product.threshold ? 'iv-card--low' : ''}`}>
      <div className="iv-card-img-wrap">
        {product.image_data
          ? <img src={product.image_data} alt={product.name} className="iv-card-img" />
          : <div className="iv-card-img-placeholder"><span>{product.category?.slice(0,3).toUpperCase() || 'IMG'}</span></div>
        }
        <StockBadge qty={product.stock_qty} threshold={product.threshold} />
      </div>
      <div className="iv-card-body">
        <div className="iv-card-sku">{product.sku}</div>
        <div className="iv-card-name">{product.name}</div>
        <div className="iv-card-meta">
          <span className="iv-card-category">{product.category}</span>
          {product.unit_price != null && <span className="iv-card-price">${Number(product.unit_price).toFixed(2)}</span>}
        </div>
        <div className="iv-card-actions">
          <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={() => onEdit(product)}>Edit</button>
          <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={handleGen} disabled={generating}>
            {generating ? '...' : '✨ Gen'}
          </button>
          <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={() => setShowListing(!showListing)}>
            {showListing ? 'Hide List' : 'List...'}
          </button>
          <button className="iv-btn iv-btn--danger iv-btn--sm" onClick={() => onDelete(product.id)}>Del</button>
        </div>
        {showListing && <ListingBuilder product={product} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Row Component
// ---------------------------------------------------------------------------

function ProductRow({ product, onEdit, onDelete }) {
  return (
    <div className={`iv-row ${product.stock_qty === 0 ? 'iv-row--out' : product.stock_qty <= product.threshold ? 'iv-row--low' : ''}`}>
      <div className="iv-row-img">
        {product.image_data
          ? <img src={product.image_data} alt={product.name} className="iv-row-thumb" />
          : <div className="iv-row-thumb-placeholder">{product.category?.slice(0,3).toUpperCase() || '—'}</div>
        }
      </div>
      <div className="iv-row-main">
        <div className="iv-row-name">{product.name}</div>
        <div className="iv-row-sku">{product.sku} · {product.category}</div>
      </div>
      <div className="iv-row-stock">
        <StockBadge qty={product.stock_qty} threshold={product.threshold} />
        <span className="iv-row-qty">{product.stock_qty} units</span>
      </div>
      <div className="iv-row-price">
        {product.unit_price != null ? `$${Number(product.unit_price).toFixed(2)}` : '—'}
      </div>
      <div className="iv-row-actions">
        <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={() => onEdit(product)}>Edit</button>
        <button className="iv-btn iv-btn--danger iv-btn--sm" onClick={() => onDelete(product.id)}>Del</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function CommercePage() {
  const { token } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError]     = useState('')
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [view, setView]             = useState('grid');
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

  if (wsLoading) return <div className="page-wrap"><div className="cp-state">Loading...</div></div>;
  if (wsError) return <div className="page-wrap"><div className="cp-state cp-state--error">Error: {wsError}</div></div>;

  return (
    <div className="commerce-page page-wrap">
      <div className="page-breadcrumb"><span>◢</span><span>TOOLS</span><span className="page-breadcrumb-sep">/</span><span>INVENTORY</span></div>
      <h1 className="page-title">Inventory {workspace && <span className="cp-ws-badge">{workspace.name}</span>}</h1>

      {!workspace ? (
        <CreateWorkspaceForm token={token} onCreate={setWorkspace} />
      ) : (
        <div className="iv-vault">
          <div className="iv-toolbar">
            <div className="iv-toolbar-left">
              <input className="iv-input iv-search" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="iv-toolbar-right">
              <button className="iv-btn iv-btn--primary" onClick={() => setFormMode('add')}>+ ADD PRODUCT</button>
            </div>
          </div>

          {formMode !== 'none' && (
            <div className="iv-form-section">
              <ProductForm
                initial={editProduct}
                workspaceId={workspace.id}
                token={token}
                onSave={formMode === 'add' ? handleAdd : handleEdit}
                onCancel={() => { setFormMode('none'); setEditProduct(null); }}
                saveLabel={formMode === 'add' ? ">> ADD PRODUCT" : ">> SAVE CHANGES"}
              />
            </div>
          )}

          {loading ? <div className="iv-state">Loading products...</div> : (
            <div className={view === 'grid' ? 'iv-grid' : 'iv-list'}>
              {filtered.map(p => (
                <ProductCard 
                  key={p.id} 
                  product={p} 
                  onEdit={(p) => { setEditProduct(p); setFormMode('edit'); }} 
                  onDelete={handleDelete}
                  onGenerateImage={handleGenerateProductImage}
                  token={token}
                />
              ))}
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
    <div className="cp-create-ws">
      <div className="cp-create-ws-title">CREATE YOUR FIRST WORKSPACE</div>
      {error && <div className="cp-flash cp-flash--err">{error}</div>}
      <div className="cp-form-row">
        <input className="cp-input" placeholder="e.g. My Boutique" value={name} onChange={e => setName(e.target.value)} />
        <button className="cp-btn cp-btn--primary" onClick={handleCreate} disabled={busy}>{busy ? '...' : '>> CREATE'}</button>
      </div>
    </div>
  )
}
