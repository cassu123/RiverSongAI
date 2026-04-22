import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import './InventoryVault.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const CATEGORIES = [
  'Apparel', 'Beauty', 'Electronics', 'Food & Beverage',
  'Fragrance', 'Health', 'Home Goods', 'Jewelry',
  'Services', 'Sports & Outdoors', 'Toys & Games', 'Other',
];

async function apiFetch(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StockBadge({ qty, threshold }) {
  if (qty === 0) return <span className="iv-badge iv-badge--out">OUT</span>;
  if (qty <= threshold) return <span className="iv-badge iv-badge--low">LOW</span>;
  return <span className="iv-badge iv-badge--ok">IN STOCK</span>;
}

function ProductImage({ src, name, size = 80 }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="iv-product-img"
        style={{ width: size, height: size }}
        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
      />
    );
  }
  return (
    <div className="iv-product-img-placeholder" style={{ width: size, height: size }}>
      <span>IMG</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product form (add / edit) — inline, no modal
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
  const fileRef = useRef();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
        {/* Image upload */}
        <div className="iv-form-image-col">
          <div
            className="iv-form-image-drop"
            onClick={() => fileRef.current.click()}
            title="Click to upload image"
          >
            {imagePreview
              ? <img src={imagePreview} alt="preview" className="iv-form-image-preview" />
              : <span className="iv-form-image-hint">+ IMAGE</span>
            }
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
          {imagePreview && (
            <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={() => { setImagePreview(null); setImageFile(null); }}>
              Remove
            </button>
          )}
        </div>

        {/* Fields */}
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
// Product card (grid view)
// ---------------------------------------------------------------------------

function ProductCard({ product, onEdit, onDelete }) {
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
        <div className="iv-card-stock">
          <span className={`iv-stock-num ${product.stock_qty === 0 ? 'iv-stock-num--out' : product.stock_qty <= product.threshold ? 'iv-stock-num--low' : ''}`}>
            {product.stock_qty}
          </span>
          <span className="iv-stock-label">in stock</span>
        </div>
      </div>
      <div className="iv-card-actions">
        <button className="iv-btn iv-btn--ghost iv-btn--sm" onClick={() => onEdit(product)}>Edit</button>
        <button className="iv-btn iv-btn--danger iv-btn--sm" onClick={() => onDelete(product.id)}>Del</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product row (list view)
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
// Main component
// ---------------------------------------------------------------------------

export default function InventoryVault({ workspaceId, token: tokenProp }) {
  const auth = useAuth();
  const token = tokenProp || auth?.token;

  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [view, setView]             = useState('grid');   // 'grid' | 'list'
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('ALL');
  const [formMode, setFormMode]     = useState('none');   // 'none' | 'add' | 'edit'
  const [editProduct, setEditProduct] = useState(null);

  const fetchProducts = useCallback(async () => {
    if (!token || !workspaceId) return;
    try {
      const data = await apiFetch(`/api/commerce/workspaces/${workspaceId}/products`, token);
      setProducts(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  const uploadImage = async (productId, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await fetch(`${API}/api/commerce/products/${productId}/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
  };

  const handleAdd = async (payload, imageFile) => {
    const p = await apiFetch(`/api/commerce/workspaces/${workspaceId}/products`, token, {
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

  const openEdit = (product) => {
    setEditProduct(product);
    setFormMode('edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelForm = () => { setFormMode('none'); setEditProduct(null); };

  // -------------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------------

  const allCategories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchCat = filterCat === 'ALL' || p.category === filterCat;
    return matchSearch && matchCat;
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!workspaceId) return null;

  return (
    <div className="iv-vault">
      {/* ── Toolbar ── */}
      <div className="iv-toolbar">
        <div className="iv-toolbar-left">
          <input
            className="iv-input iv-search"
            placeholder="Search name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="iv-filter-pills">
            {['ALL', ...allCategories].map((c) => (
              <button
                key={c}
                className={`iv-pill ${filterCat === c ? 'iv-pill--active' : ''}`}
                onClick={() => setFilterCat(c)}
              >{c}</button>
            ))}
          </div>
        </div>
        <div className="iv-toolbar-right">
          <div className="iv-view-toggle">
            <button className={`iv-view-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="Grid view">
              ⊞
            </button>
            <button className={`iv-view-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="List view">
              ☰
            </button>
          </div>
          {formMode === 'none' && (
            <button className="iv-btn iv-btn--primary" onClick={() => setFormMode('add')}>+ ADD PRODUCT</button>
          )}
        </div>
      </div>

      {/* ── Inline add/edit form ── */}
      {formMode === 'add' && (
        <div className="iv-form-section">
          <div className="iv-form-section-title">ADD PRODUCT</div>
          <ProductForm
            workspaceId={workspaceId}
            token={token}
            onSave={handleAdd}
            onCancel={cancelForm}
            saveLabel=">> ADD PRODUCT"
          />
        </div>
      )}
      {formMode === 'edit' && editProduct && (
        <div className="iv-form-section">
          <div className="iv-form-section-title">EDIT — {editProduct.name}</div>
          <ProductForm
            initial={editProduct}
            workspaceId={workspaceId}
            token={token}
            onSave={handleEdit}
            onCancel={cancelForm}
            saveLabel=">> SAVE CHANGES"
          />
        </div>
      )}

      {/* ── States ── */}
      {loading && <div className="iv-state">Loading products...</div>}
      {error   && <div className="iv-state iv-state--error">Error: {error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="iv-state">
          {products.length === 0 ? 'No products yet. Add your first product above.' : 'No products match your search.'}
        </div>
      )}

      {/* ── Grid view ── */}
      {!loading && view === 'grid' && filtered.length > 0 && (
        <div className="iv-grid">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* ── List view ── */}
      {!loading && view === 'list' && filtered.length > 0 && (
        <div className="iv-list">
          <div className="iv-list-header">
            <div className="iv-row-img" />
            <div className="iv-row-main">PRODUCT</div>
            <div className="iv-row-stock">STOCK</div>
            <div className="iv-row-price">PRICE</div>
            <div className="iv-row-actions" />
          </div>
          {filtered.map((p) => (
            <ProductRow key={p.id} product={p} onEdit={openEdit} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
