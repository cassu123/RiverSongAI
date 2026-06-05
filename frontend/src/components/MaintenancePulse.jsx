import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import './MaintenancePulse.css';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch(path, token, opts = {}) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error(`Blocked absolute URL in apiFetch: ${path}`);
  }
  const res = await fetch(path, { headers: authHeaders(token), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------------------
// Vehicle form
// ---------------------------------------------------------------------------

const BLANK_VEHICLE = { make: '', model: '', year: '', trim: '', nickname: '', vehicle_type: 'auto', color: '', vin: '' };

function VehicleForm({ initial, onSave, onCancel, saveLabel }) {
  const [form, setForm]   = useState(initial || BLANK_VEHICLE);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = () => {
    if (!form.make.trim() || !form.model.trim()) { setError('Make and model are required.'); return; }
    onSave({ ...form, year: form.year ? Number(form.year) : null });
  };

  return (
    <div className="vehicle-form-panel">
      {error && <div className="mp-error">{error}</div>}
      <div className="form-grid">
        <div className="pulse-field">
          <label className="rs-card-label">MAKE *</label>
          <input className="cyber-input" value={form.make} onChange={set('make')} placeholder="e.g. Honda" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">MODEL *</label>
          <input className="cyber-input" value={form.model} onChange={set('model')} placeholder="e.g. Rebel 500" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">YEAR</label>
          <input className="cyber-input num-input" type="number" value={form.year} onChange={set('year')} placeholder="2026" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">TRIM</label>
          <input className="cyber-input" value={form.trim} onChange={set('trim')} placeholder="e.g. SE" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">NICKNAME</label>
          <input className="cyber-input" value={form.nickname} onChange={set('nickname')} placeholder="e.g. The Rebel" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">TYPE</label>
          <select className="pulse-select cyber-input" value={form.vehicle_type} onChange={set('vehicle_type')}>
            <option value="auto">Automobile</option>
            <option value="moto">Motorcycle</option>
            <option value="truck">Truck</option>
            <option value="atv">ATV / UTV</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">COLOR</label>
          <input className="cyber-input" value={form.color} onChange={set('color')} placeholder="e.g. Matte Black" />
        </div>
        <div className="pulse-field">
          <label className="rs-card-label">VIN</label>
          <input className="cyber-input" value={form.vin} onChange={set('vin')} placeholder="Optional" />
        </div>
      </div>
      <div className="vehicle-form-footer">
        <button className="rs-pill" onClick={onCancel}>CANCEL</button>
        <button className="rs-pill is-active" onClick={handleSubmit}>{saveLabel || '>> SAVE'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specs editor — unified single list
// ---------------------------------------------------------------------------

const BLANK_CP = {
  description: '', service_level: 'inspect',
  interval_miles: '', interval_days: '', due_at_miles: '',
  expected_spec: '', volume: '', min_value: '', max_value: '', unit: '',
  ft_lb: '', nm: '',
};

const SVC_LEVEL_LABELS = { inspect: 'INSPECT', service: 'SERVICE', replace: 'REPLACE' };
const SVC_LEVEL_COLORS = { inspect: 'var(--primary)', service: 'var(--rs-status-warning)', replace: 'var(--rs-status-critical)' };

function fmtDays(d) {
  if (!d) return null;
  if (d % 365 === 0) return `${d / 365}yr`;
  if (d % 30  === 0) return `${d / 30}mo`;
  if (d % 7   === 0) return `${d / 7}wk`;
  return `${d}d`;
}

function CheckPointRow({ cp, token, vehicleId, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    description:    cp.description    ?? '',
    service_level:  cp.service_level  ?? 'inspect',
    interval_miles: cp.interval_miles ?? '',
    interval_days:  cp.interval_days  ?? '',
    due_at_miles:   cp.due_at_miles   ?? '',
    expected_spec:  cp.expected_spec  ?? '',
    volume:         cp.volume         ?? '',
    min_value:      cp.min_value      ?? '',
    max_value:      cp.max_value      ?? '',
    unit:           cp.unit           ?? '',
    ft_lb:          cp.ft_lb          ?? '',
    nm:             cp.nm             ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const n = (v) => v !== '' ? Number(v) : null;
      await apiFetch(`/api/vehicles/${vehicleId}/specs/checkpoints/${cp.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          description:    form.description   || null,
          service_level:  form.service_level,
          interval_miles: n(form.interval_miles),
          interval_days:  n(form.interval_days),
          due_at_miles:   n(form.due_at_miles),
          expected_spec:  form.expected_spec || null,
          volume:         form.volume        || null,
          min_value:      n(form.min_value),
          max_value:      n(form.max_value),
          unit:           form.unit          || null,
          ft_lb:          n(form.ft_lb),
          nm:             n(form.nm),
        }),
      });
      setEditing(false);
      onUpdated();
    } finally { setBusy(false); }
  };

  const del = async () => {
    await apiFetch(`/api/vehicles/${vehicleId}/specs/checkpoints/${cp.id}`, token, { method: 'DELETE' });
    onUpdated();
  };

  const intervalLabel = () => {
    const parts = [];
    if (cp.due_at_miles && !cp.interval_miles) {
      parts.push(`Due at ${cp.due_at_miles.toLocaleString()} mi`);
    } else {
      if (cp.due_at_miles) parts.push(`Next: ${cp.due_at_miles.toLocaleString()} mi`);
      else if (cp.interval_miles) parts.push(`Every ${cp.interval_miles.toLocaleString()} mi`);
    }
    if (cp.interval_days) parts.push(`/ ${fmtDays(cp.interval_days)}`);
    return parts.join(' ') || null;
  };

  const svcColor = SVC_LEVEL_COLORS[cp.service_level] || 'var(--text-dim)';

  return (
    <li className="cp-row">
      <div className="cp-row-main">
        <span className="cp-svc-badge" style={{ borderColor: svcColor, color: svcColor }}>
          {SVC_LEVEL_LABELS[cp.service_level] || 'INSPECT'}
        </span>
        <span className="rs-card-value" style={{ fontSize: "1.1rem" }}>{cp.description}</span>
        {cp.expected_spec && (
          <span className="cp-spec-tag">
            {cp.expected_spec}
            {cp.unit && !cp.expected_spec.toLowerCase().includes(cp.unit.toLowerCase()) ? ` ${cp.unit}` : ''}
            {cp.volume ? ` · ${cp.volume}` : ''}
          </span>
        )}
        {(cp.ft_lb || cp.nm) && (
          <span className="cp-torque-tag">
            {cp.ft_lb ? `${cp.ft_lb} ft-lb` : ''}{cp.ft_lb && cp.nm ? ' / ' : ''}{cp.nm ? `${cp.nm} N·m` : ''}
          </span>
        )}
        {intervalLabel() && <span className="cp-interval-tag">{intervalLabel()}</span>}
        {cp.last_service_odometer && (
          <span className="cp-last-svc">last: {cp.last_service_odometer.toLocaleString()} mi</span>
        )}
        <button className="rs-pill" style={{marginLeft: '8px'}} onClick={async () => {
          const partName = window.prompt('Enter Part Name (e.g. Oil Filter, 10W-40, Spark Plug):');
          if (!partName) return;
          const partNum = window.prompt('Enter Part Number (Optional):');
          await apiFetch(`/api/vehicles/${vehicleId}/parts`, token, {
            method: 'POST',
            body: JSON.stringify({
              check_point_id: cp.id,
              part_name: partName,
              part_number: partNum || null
            })
          });
          onUpdated();
        }}>+ PART</button>
        <button className="rs-pill" style={{marginLeft: '4px', color: 'var(--primary)'}} onClick={async () => {
          const q = window.prompt(`Describe the part to look up for ${cp.description}:`);
          if (!q) return;
          try {
             const res = await apiFetch(`/api/vehicles/${vehicleId}/parts/lookup`, token, {
               method: 'POST',
               body: JSON.stringify({ checkpoint_id: cp.id, query: q })
             });
             if (res.oem || res.alternatives) {
               const pn = res.oem && res.oem !== 'Unknown' ? res.oem : (res.alternatives?.[0]?.part_number || null);
               const pbrand = res.alternatives?.[0]?.brand || 'OEM';
               await apiFetch(`/api/vehicles/${vehicleId}/parts`, token, {
                 method: 'POST',
                 body: JSON.stringify({
                   check_point_id: cp.id,
                   part_name: `${pbrand} Part - ${q}`,
                   part_number: pn
                 })
               });
               onUpdated();
               alert(`Found and added: ${pbrand} ${pn}`);
             } else {
               alert('No matching parts found.');
             }
          } catch(e) {
             alert('Lookup failed: ' + e.message);
          }
        }}><span className="material-symbols-rounded" style={{fontSize: '1rem'}}>psychology</span> AI LOOKUP</button>
        {cp.parts && cp.parts.map(p => (
           <span key={p.id} className="cp-interval-tag" style={{borderColor: 'var(--primary)', color: 'var(--primary)', marginLeft: '4px'}}>
             {p.part_name} {p.part_number ? `(${p.part_number})` : ''}
             <span style={{cursor: 'pointer', marginLeft: '4px'}} onClick={async () => {
               if(window.confirm('Remove this part?')) {
                 await apiFetch(`/api/vehicles/${vehicleId}/parts/${p.id}`, token, { method: 'DELETE' });
                 onUpdated();
               }
             }}>✕</span>
           </span>
        ))}
      </div>
      <div className="cp-row-actions">
        <button className="rs-pill" onClick={() => setEditing(e => !e)}>{editing ? 'CLOSE' : 'EDIT'}</button>
        <button className="rs-pill" onClick={del}>✕</button>
      </div>
      {editing && (
        <div className="cp-edit-panel">
          <div className="cp-edit-grid">
            <div className="pulse-field" style={{ gridColumn: 'span 2' }}>
              <label className="rs-card-label">DESCRIPTION</label>
              <input className="cyber-input" value={form.description} onChange={set('description')} />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">SERVICE LEVEL</label>
              <select className="cyber-input" value={form.service_level} onChange={set('service_level')}>
                <option value="inspect">Inspect</option>
                <option value="service">Service</option>
                <option value="replace">Replace</option>
              </select>
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">UNIT</label>
              <input className="cyber-input" value={form.unit} onChange={set('unit')} placeholder="mm / PSI / °C" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">EXPECTED SPEC</label>
              <input className="cyber-input" value={form.expected_spec} onChange={set('expected_spec')} placeholder="e.g. SAE 0W-20" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">VOLUME / CAPACITY</label>
              <input className="cyber-input" value={form.volume} onChange={set('volume')} placeholder="e.g. 4.2 qt" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">MIN VALUE</label>
              <input className="cyber-input num-input" type="number" value={form.min_value} onChange={set('min_value')} placeholder="20" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">MAX VALUE</label>
              <input className="cyber-input num-input" type="number" value={form.max_value} onChange={set('max_value')} placeholder="30" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">TORQUE (FT-LB)</label>
              <input className="cyber-input num-input" type="number" value={form.ft_lb} onChange={set('ft_lb')} placeholder="18" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">TORQUE (N·m)</label>
              <input className="cyber-input num-input" type="number" value={form.nm} onChange={set('nm')} placeholder="24" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">INTERVAL (MILES)</label>
              <input className="cyber-input num-input" type="number" value={form.interval_miles} onChange={set('interval_miles')} placeholder="5000" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">INTERVAL (DAYS)</label>
              <input className="cyber-input num-input" type="number" value={form.interval_days} onChange={set('interval_days')} placeholder="365" />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">NEXT DUE (MILES)</label>
              <input className="cyber-input num-input" type="number" value={form.due_at_miles} onChange={set('due_at_miles')} placeholder="600" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button className="rs-pill" onClick={() => setEditing(false)}>CANCEL</button>
            <button className="rs-pill btn-save" onClick={save} disabled={busy}>{busy ? '...' : 'SAVE'}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function SpecsEditor({ vehicle, token, onUpdated }) {
  const [newPoint, setNewPoint] = useState(BLANK_CP);
  const [showAdd,  setShowAdd]  = useState(false);
  const [busy, setBusy] = useState(false);
  const setNp = (k) => (e) => setNewPoint(f => ({ ...f, [k]: e.target.value }));

  const addPoint = async () => {
    if (!newPoint.description.trim()) return;
    setBusy(true);
    try {
      const n = (v) => v !== '' ? Number(v) : null;
      await apiFetch(`/api/vehicles/${vehicle.id}/specs/checkpoints`, token, {
        method: 'POST',
        body: JSON.stringify({
          description:    newPoint.description,
          service_level:  newPoint.service_level,
          sort_order:     vehicle.check_points.length,
          interval_miles: n(newPoint.interval_miles),
          interval_days:  n(newPoint.interval_days),
          due_at_miles:   n(newPoint.due_at_miles),
          expected_spec:  newPoint.expected_spec || null,
          volume:         newPoint.volume        || null,
          min_value:      n(newPoint.min_value),
          max_value:      n(newPoint.max_value),
          unit:           newPoint.unit          || null,
          ft_lb:          n(newPoint.ft_lb),
          nm:             n(newPoint.nm),
        }),
      });
      setNewPoint(BLANK_CP);
      setShowAdd(false);
      onUpdated();
    } finally { setBusy(false); }
  };

  return (
    <div className="specs-editor">
      <div className="spec-section">
        <div className="cp-editor-header">
          <h4 style={{ margin: 0 }}>[ SERVICE ITEMS ]</h4>
          {vehicle.check_points.length > 0 && (
            <button
              className="rs-pill btn-danger"
              onClick={async () => {
                if (!window.confirm(`Clear all ${vehicle.check_points.length} items? This cannot be undone.`)) return;
                await apiFetch(`/api/vehicles/${vehicle.id}/specs/checkpoints`, token, { method: 'DELETE' });
                onUpdated();
              }}
            >CLEAR ALL</button>
          )}
        </div>

        {vehicle.check_points.length === 0 && !showAdd && (
          <div className="mp-empty-specs">
            No service items yet. Upload an owner's manual in <strong>SETTINGS → MANUAL IMPORT</strong>, or add items manually.
          </div>
        )}

        <ul className="spec-edit-list cp-list">
          {(vehicle.check_points || []).map((cp) => (
            <CheckPointRow key={cp.id} cp={cp} token={token} vehicleId={vehicle.id} onUpdated={onUpdated} />
          ))}
        </ul>

        {!showAdd ? (
          <button className="rs-pill" style={{ marginTop: 8 }} onClick={() => setShowAdd(true)}>+ ADD ITEM</button>
        ) : (
          <div className="cp-edit-panel" style={{ marginTop: 8 }}>
            <div className="cp-edit-grid">
              <div className="pulse-field" style={{ gridColumn: 'span 2' }}>
                <label className="rs-card-label">DESCRIPTION *</label>
                <input className="cyber-input" value={newPoint.description} onChange={setNp('description')} placeholder="e.g. Engine Oil Change" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">SERVICE LEVEL</label>
                <select className="cyber-input" value={newPoint.service_level} onChange={setNp('service_level')}>
                  <option value="inspect">Inspect</option>
                  <option value="service">Service</option>
                  <option value="replace">Replace</option>
                </select>
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">UNIT</label>
                <input className="cyber-input" value={newPoint.unit} onChange={setNp('unit')} placeholder="mm / PSI" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">EXPECTED SPEC</label>
                <input className="cyber-input" value={newPoint.expected_spec} onChange={setNp('expected_spec')} placeholder="SAE 0W-20" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">VOLUME</label>
                <input className="cyber-input" value={newPoint.volume} onChange={setNp('volume')} placeholder="4.2 qt" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">MIN VALUE</label>
                <input className="cyber-input num-input" type="number" value={newPoint.min_value} onChange={setNp('min_value')} placeholder="20" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">MAX VALUE</label>
                <input className="cyber-input num-input" type="number" value={newPoint.max_value} onChange={setNp('max_value')} placeholder="30" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">TORQUE (FT-LB)</label>
                <input className="cyber-input num-input" type="number" value={newPoint.ft_lb} onChange={setNp('ft_lb')} placeholder="18" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">TORQUE (N·m)</label>
                <input className="cyber-input num-input" type="number" value={newPoint.nm} onChange={setNp('nm')} placeholder="24" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">INTERVAL (MILES)</label>
                <input className="cyber-input num-input" type="number" value={newPoint.interval_miles} onChange={setNp('interval_miles')} placeholder="5000" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">INTERVAL (DAYS)</label>
                <input className="cyber-input num-input" type="number" value={newPoint.interval_days} onChange={setNp('interval_days')} placeholder="365" />
              </div>
              <div className="pulse-field">
                <label className="rs-card-label">NEXT DUE (MILES)</label>
                <input className="cyber-input num-input" type="number" value={newPoint.due_at_miles} onChange={setNp('due_at_miles')} placeholder="600" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button className="rs-pill" onClick={() => { setShowAdd(false); setNewPoint(BLANK_CP); }}>CANCEL</button>
              <button className="rs-pill btn-save" onClick={addPoint} disabled={busy || !newPoint.description.trim()}>
                {busy ? '...' : '+ ADD'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual upload (PDF → Claude → intervals)
// ---------------------------------------------------------------------------

function ManualUpload({ token, vehicleId, onUpdated }) {
  const [file, setFile]           = useState(null);
  const [busy, setBusy]           = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [result, setResult]       = useState(null);   // applied result
  const [preview, setPreview]     = useState(null);   // preview items array
  const [error, setError]         = useState('');
  const fileRef = useRef();

  const postFile = async (endpoint) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');
    return data;
  };

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true); setBusyLabel('Reading and parsing manual…'); setError(''); setPreview(null); setResult(null);
    try {
      const data = await postFile(`/api/vehicles/${vehicleId}/manual/preview`);
      setPreview(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false); setBusyLabel('');
    }
  };

  const handleApply = async () => {
    if (!file) return;
    setBusy(true); setBusyLabel('Applying to vehicle…'); setError(''); setResult(null);
    try {
      const data = await postFile(`/api/vehicles/${vehicleId}/manual`);
      setResult(data);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onUpdated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false); setBusyLabel('');
    }
  };

  const clearFile = () => { setFile(null); setPreview(null); setResult(null); setError(''); if (fileRef.current) fileRef.current.value = ''; };

  return (
    <div className="mp-settings-section">
      <div className="mp-settings-label">IMPORT FROM OWNER'S MANUAL</div>
      <p className="mp-settings-hint">
        Upload a PDF owner's manual. Intervals, specs, fluid capacities, and torque values are
        extracted locally — no internet required. Use <strong>PREVIEW</strong> first to verify what
        was found, then <strong>APPLY</strong> to write it to this vehicle.
      </p>

      {result && (
        <div className="mp-flash mp-flash--ok">
          Applied — {result.updated} item{result.updated !== 1 ? 's' : ''} updated,{' '}
          {result.created} new item{result.created !== 1 ? 's' : ''} added ({result.total} total found).
        </div>
      )}
      {error && <div className="mp-flash mp-flash--err">{error}</div>}

      {busy ? (
        <div className="mp-manual-busy">
          <div className="mp-manual-spinner" />
          <span>{busyLabel}</span>
        </div>
      ) : (
        <div className="mp-manual-upload-row">
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { setFile(e.target.files[0] || null); setPreview(null); setResult(null); }} />
          <button className="rs-pill" onClick={() => fileRef.current.click()}>
            {file ? `[ ${file.name} ]` : 'SELECT PDF'}
          </button>
          {file && <>
            <button className="rs-pill" onClick={handlePreview}>PREVIEW</button>
            <button className="rs-pill btn-save" onClick={handleApply}>EXTRACT &amp; APPLY</button>
            <button className="rs-pill" onClick={clearFile}>✕</button>
          </>}
        </div>
      )}

      {/* Preview table */}
      {preview && (
        <div className="mp-preview-wrap">
          <div className="mp-preview-header">
            PREVIEW — {preview.length} items found
            <span className="mp-preview-hint"> (nothing written yet — click EXTRACT &amp; APPLY to confirm)</span>
          </div>
          {preview.length === 0 ? (
            <div className="mp-empty-specs">No maintenance items detected in this PDF.</div>
          ) : (
            <table className="mp-preview-table">
              <thead>
                <tr>
                  <th>ITEM</th>
                  <th>LEVEL</th>
                  <th>EXPECTED</th>
                  <th>INTERVAL</th>
                  <th>TORQUE</th>
                </tr>
              </thead>
              <tbody>
                {(preview || []).map((item, i) => {
                  const interval = [
                    item.interval_miles ? `${item.interval_miles.toLocaleString()} mi` : '',
                    item.interval_days  ? fmtDays(item.interval_days) : '',
                    item.due_at_miles   ? `due @ ${item.due_at_miles.toLocaleString()} mi` : '',
                  ].filter(Boolean).join(' / ');
                  const torque = [
                    item.ft_lb ? `${item.ft_lb} ft-lb` : '',
                    item.nm    ? `${item.nm} N·m`     : '',
                  ].filter(Boolean).join(' / ');
                  const spec = [item.expected_spec, item.volume].filter(Boolean).join(' · ');
                  return (
                    <tr key={i}>
                      <td className="mp-prev-name">{item.description}</td>
                      <td><span className="mp-prev-level" data-level={item.service_level}>{item.service_level}</span></td>
                      <td className="mp-prev-spec">{spec || '—'}</td>
                      <td className="mp-prev-interval">{interval || '—'}</td>
                      <td className="mp-prev-torque">{torque || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — People management
// ---------------------------------------------------------------------------

function PeopleSettings({ token, people, onRefresh }) {
  const [emailInput, setEmailInput] = useState('');
  const [busy, setBusy]             = useState(false);
  const [msg, setMsg]               = useState('');
  const [error, setError]           = useState('');
  const [search, setSearch]         = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // person id

  const flash = (ok, text) => {
    if (ok) setMsg(text); else setError(text);
    setTimeout(() => { setMsg(''); setError(''); }, 4000);
  };

  const handleAdd = async () => {
    if (!emailInput.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/api/vehicles/people', token, { method: 'POST', body: JSON.stringify({ email: emailInput.trim().toLowerCase() }) });
      setEmailInput('');
      flash(true, 'Person added to roster.');
      onRefresh();
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (person, force = false) => {
    setBusy(true);
    try {
      const path = force ? `/api/vehicles/people/${person.id}/force` : `/api/vehicles/people/${person.id}`;
      await apiFetch(path, token, { method: 'DELETE' });
      setConfirmDelete(null);
      flash(true, `${person.display_name || person.email} removed.`);
      onRefresh();
    } catch (e) {
      if (e.message.includes('still assigned')) {
        setConfirmDelete(person);
      } else {
        flash(false, e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const filtered = people.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.email.toLowerCase().includes(q) || (p.display_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="mp-settings-section">
      <div className="mp-settings-label">PEOPLE ROSTER</div>
      <p className="mp-settings-hint">Add app users by email. They must have accepted an invitation before being added.</p>

      {msg   && <div className="mp-flash mp-flash--ok">{msg}</div>}
      {error && <div className="mp-flash mp-flash--err">{error}</div>}

      {/* Confirm force-delete dialog */}
      {confirmDelete && (
        <div className="mp-confirm-box">
          <div className="mp-confirm-msg">
            <strong>{confirmDelete.display_name || confirmDelete.email}</strong> is still assigned to{' '}
            {confirmDelete.vehicle_ids?.length || 'some'} vehicle(s).<br />
            Force delete will unassign them from all vehicles. Service history will be preserved.
          </div>
          <div className="mp-confirm-actions">
            <button className="rs-pill" onClick={() => setConfirmDelete(null)}>CANCEL</button>
            <button className="rs-pill btn-danger" onClick={() => handleRemove(confirmDelete, true)} disabled={busy}>
              FORCE DELETE
            </button>
          </div>
        </div>
      )}

      {/* Add row */}
      <div className="mp-add-person-row">
        <input
          className="cyber-input"
          placeholder="user@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          style={{ flex: 1 }}
        />
        <button className="rs-pill btn-save" onClick={handleAdd} disabled={busy || !emailInput.trim()}>
          {busy ? '...' : '+ ADD'}
        </button>
      </div>

      {/* Search */}
      {people.length > 3 && (
        <input
          className="cyber-input"
          placeholder="Filter roster..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
      )}

      {/* People list */}
      {filtered.length === 0 ? (
        <div className="mp-empty-specs">
          {people.length === 0 ? 'No people on roster yet.' : 'No matches.'}
        </div>
      ) : (
        <ul className="mp-person-list">
          {(filtered || []).map((p) => (
            <li key={p.id} className="mp-person-item">
              <div className="mp-person-info">
                <span className="mp-person-name">{p.display_name || p.email}</span>
                <span className="mp-person-email">{p.display_name ? p.email : ''}</span>
                {p.vehicle_ids?.length > 0 && (
                  <span className="mp-person-tag">{p.vehicle_ids.length} vehicle{p.vehicle_ids.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              <button
                className="rs-pill"
                onClick={() => handleRemove(p)}
                disabled={busy}
                title="Remove from roster"
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — Vehicle assignments
// ---------------------------------------------------------------------------

function AssignmentsSettings({ token, vehicles, people, onPeopleRefresh }) {
  const [selectedVehicleId, setSelectedVehicleId] = useState(vehicles[0]?.id || '');
  const [assignments, setAssignments]               = useState([]);
  const [busy, setBusy]                             = useState(false);
  const [msg, setMsg]                               = useState('');
  const [error, setError]                           = useState('');

  const flash = (ok, text) => {
    if (ok) setMsg(text); else setError(text);
    setTimeout(() => { setMsg(''); setError(''); }, 3000);
  };

  const fetchAssignments = useCallback(async () => {
    if (!selectedVehicleId || !token) return;
    try {
      const data = await apiFetch(`/api/vehicles/${selectedVehicleId}/assignments`, token);
      setAssignments(data);
    } catch { setAssignments([]); }
  }, [selectedVehicleId, token]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const assignedPersonIds = new Set((assignments || []).map((a) => a.person_id));
  const unassigned = people.filter((p) => !assignedPersonIds.has(p.id));

  const handleAssign = async (personId) => {
    setBusy(true);
    try {
      await apiFetch(`/api/vehicles/${selectedVehicleId}/assignments`, token, {
        method: 'POST', body: JSON.stringify({ person_id: personId }),
      });
      flash(true, 'Assigned.');
      fetchAssignments();
      onPeopleRefresh();
    } catch (e) { flash(false, e.message); }
    finally { setBusy(false); }
  };

  const handleUnassign = async (personId) => {
    setBusy(true);
    try {
      await apiFetch(`/api/vehicles/${selectedVehicleId}/assignments/${personId}`, token, { method: 'DELETE' });
      flash(true, 'Unassigned.');
      fetchAssignments();
      onPeopleRefresh();
    } catch (e) { flash(false, e.message); }
    finally { setBusy(false); }
  };

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const vehicleLabel = (v) => `${v.year ? v.year + ' ' : ''}${v.make} ${v.model}${v.nickname ? ` "${v.nickname}"` : ''}`;

  return (
    <div className="mp-settings-section">
      <div className="mp-settings-label">VEHICLE ASSIGNMENTS</div>
      <p className="mp-settings-hint">Assign people to specific vehicles. They will appear in the performer dropdown when logging maintenance.</p>

      {msg   && <div className="mp-flash mp-flash--ok">{msg}</div>}
      {error && <div className="mp-flash mp-flash--err">{error}</div>}

      {vehicles.length === 0 ? (
        <div className="mp-empty-specs">No vehicles in garage yet.</div>
      ) : (
        <>
          <div className="pulse-field" style={{ marginBottom: 12 }}>
            <label className="rs-card-label">SELECT VEHICLE</label>
            <select
              className="pulse-select cyber-input"
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
            >
              {(vehicles || []).map((v) => (
                <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
              ))}
            </select>
          </div>

          {people.length === 0 ? (
            <div className="mp-empty-specs">Add people to the roster first (see People section above).</div>
          ) : (
            <div className="mp-assignment-grid">
              {/* Assigned column */}
              <div className="mp-assign-col">
                <div className="mp-assign-col-label">ASSIGNED TO {selectedVehicle?.make.toUpperCase()}</div>
                {assignments.length === 0 ? (
                  <div className="mp-assign-empty">No one assigned yet.</div>
                ) : (
                  <ul className="mp-person-list">
                    {(assignments || []).map((a) => (
                      <li key={a.person_id} className="mp-person-item mp-person-item--assigned">
                        <div className="mp-person-info">
                          <span className="mp-person-name">{a.person_display_name || a.person_email}</span>
                          <span className="mp-person-email">{a.person_display_name ? a.person_email : ''}</span>
                        </div>
                        <button
                          className="rs-pill btn-danger"
                          onClick={() => handleUnassign(a.person_id)}
                          disabled={busy}
                        >REMOVE</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Unassigned column */}
              {unassigned.length > 0 && (
                <div className="mp-assign-col">
                  <div className="mp-assign-col-label">AVAILABLE TO ASSIGN</div>
                  <ul className="mp-person-list">
                    {(unassigned || []).map((p) => (
                      <li key={p.id} className="mp-person-item">
                        <div className="mp-person-info">
                          <span className="mp-person-name">{p.display_name || p.email}</span>
                          <span className="mp-person-email">{p.display_name ? p.email : ''}</span>
                        </div>
                        <button
                          className="rs-pill btn-save"
                          onClick={() => handleAssign(p.id)}
                          disabled={busy}
                        >+ ASSIGN</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab — container
// ---------------------------------------------------------------------------

function SettingsPanel({ token, vehicles, people, selectedVehicleId, onPeopleRefresh, onVehicleRefresh }) {
  const [section, setSection] = useState('people');

  return (
    <div className="mp-settings-panel">
      <div className="mp-settings-tabs">
        <button className={`mp-settings-tab ${section === 'people' ? 'active' : ''}`} onClick={() => setSection('people')}>
          PEOPLE
        </button>
        <button className={`mp-settings-tab ${section === 'assignments' ? 'active' : ''}`} onClick={() => setSection('assignments')}>
          ASSIGNMENTS
        </button>
        <button className={`mp-settings-tab ${section === 'manual' ? 'active' : ''}`} onClick={() => setSection('manual')}>
          MANUAL IMPORT
        </button>
      </div>

      {section === 'people' && (
        <PeopleSettings token={token} people={people} onRefresh={onPeopleRefresh} />
      )}
      {section === 'assignments' && (
        <AssignmentsSettings token={token} vehicles={vehicles} people={people} onPeopleRefresh={onPeopleRefresh} />
      )}
      {section === 'manual' && (
        <ManualUpload token={token} vehicleId={selectedVehicleId} onUpdated={onVehicleRefresh} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RAG Documents Q&A
// ---------------------------------------------------------------------------

function VehicleRAG({ token, vehicleId, currentOdometer }) {
  const [file, setFile] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleIngest = async () => {
    if (!file) return;
    setIngesting(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/vehicles/${vehicleId}/manual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) throw new Error('Ingestion failed');
      alert('Document ingested successfully!');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setError(e.message); }
    finally { setIngesting(false); }
  };

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true); setError(''); setAnswer(null);
    try {
      const odo = currentOdometer ? parseInt(currentOdometer, 10) : null;
      const res = await fetch(`/api/vehicles/${vehicleId}/maintenance-ai`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question.trim(), current_odometer: isNaN(odo) ? null : odo })
      });
      if (!res.ok) throw new Error('Query failed');
      const data = await res.json();
      setAnswer(data);
      setQuestion('');
    } catch (e) { setError(e.message); }
    finally { setAsking(false); }
  };

  return (
    <div className="rs-card is-wide">
      <div className="mp-settings-label" style={{ display: 'flex', alignItems: 'center' }}>
        CONVERSATIONAL MAINTENANCE ADVISOR
        <span style={{ marginLeft: 8, fontSize: '0.7em', padding: '2px 6px', background: 'var(--primary)', color: '#000', borderRadius: '4px' }}>AI GROUNDED</span>
      </div>
      <p className="mp-settings-hint">
        Ask about upcoming maintenance, request parts info, or log service directly (e.g., "I just changed the oil at 50,000 miles").
      </p>

      {error && <div className="mp-flash mp-flash--err">{error}</div>}

      <div className="mp-rag-upload">
        <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files[0])} />
        <button className="rs-pill" onClick={() => fileRef.current.click()}>
          {file ? `[ ${file.name} ]` : 'SELECT MANUAL/RECORD'}
        </button>
        {file && (
          <button className="rs-pill btn-save" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? 'INGESTING...' : 'INGEST DOCUMENT'}
          </button>
        )}
      </div>

      <form className="mp-rag-query" onSubmit={handleAsk}>
        <input 
          className="cyber-input" 
          placeholder="e.g. 'What parts do I need for my next service?' or 'Log an oil change'" 
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={asking}
        />
        <button className="rs-pill btn-save" type="submit" disabled={asking || !question.trim()}>
          {asking ? 'THINKING...' : 'ASK'}
        </button>
      </form>

      {answer && (
        <div className="mp-rag-answer animate-fade-in" style={{ marginTop: '1rem' }}>
          <div className="mp-answer-text" style={{ padding: '1rem', background: 'var(--bg-lighter)', borderRadius: '4px', borderLeft: '3px solid var(--primary)' }}>
            {answer.response}
          </div>
          {answer.tool_result && answer.tool_result.status === 'success' && (
            <div className="rs-card-inner" style={{ borderColor: 'var(--rs-status-nominal)', color: 'var(--rs-status-nominal)' }}>
              <strong style={{ color: 'var(--rs-status-nominal)' }}>✓ Action Confirmed:</strong> {answer.tool_result.details}
            </div>
          )}
          {answer.chunks?.length > 0 && (
            <details className="mp-answer-sources" style={{ marginTop: '1rem' }}>
              <summary>View Sources ▸</summary>
              <div className="mp-sources-list">
                {(answer.chunks || []).map((c, i) => (
                  <div key={i} className="mp-source-item" style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    <span className="mp-source-meta" style={{ color: 'var(--text-dim)', fontSize: '0.8em' }}>Source: {c.source}</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9em' }}>{c.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Predictive Timeline
// ---------------------------------------------------------------------------

function PredictiveTimeline({ token, vehicleId, currentOdometer }) {
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentOdometer) {
      setTimeline(null);
      return;
    }
    const odo = parseInt(currentOdometer, 10);
    if (isNaN(odo)) return;

    let cancel = false;
    const fetchTimeline = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(`/api/vehicles/${vehicleId}/maintenance-timeline?current_odometer=${odo}`, token);
        if (!cancel) setTimeline(data);
      } catch (err) {
        if (!cancel) setError(err.message);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    
    const t = setTimeout(fetchTimeline, 500);
    return () => { cancel = true; clearTimeout(t); };
  }, [token, vehicleId, currentOdometer]);

  if (!currentOdometer) {
    return <div className="mp-empty-specs" style={{ margin: '2rem 0' }}>Enter your current odometer to see what's next.</div>;
  }

  if (loading) return <div className="mp-empty-specs" style={{ margin: '2rem 0' }}>CALCULATING TIMELINE...</div>;
  if (error) return <div className="mp-error">ERROR: {error}</div>;
  if (!timeline) return null;

  return (
    <div className="predictive-timeline">
      {timeline.next_up && timeline.next_up.length > 0 ? (
        <div className="rs-card is-wide" style={{ borderColor: 'var(--rs-status-warning)', marginBottom: '24px' }}>
          <h4 style={{ color: 'var(--rs-status-warning)', marginTop: 0 }}>[ NEXT UP - ACTION REQUIRED ]</h4>
          {timeline.next_up.map(item => (
            <div key={item.id} className="rs-card-inner" style={{ display: 'flex', flexDirection: 'column', padding: '0.75rem', marginBottom: '0.5rem', borderRadius: '4px' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                 <span className="cp-svc-badge" style={{ borderColor: 'var(--rs-status-warning)', color: 'var(--rs-status-warning)' }}>{item.service_level.toUpperCase()}</span>
                 <strong style={{ fontSize: '1.1rem' }}>{item.description}</strong>
               </div>
               <div style={{ marginTop: '0.25rem', color: 'var(--text-dim)' }}>
                 Due {item.miles_remaining <= 0 ? <span style={{color: 'var(--rs-status-critical)'}}>NOW (Overdue by {Math.abs(item.miles_remaining)} mi)</span> : `in ${item.miles_remaining} miles`}
               </div>
               {item.parts && item.parts.length > 0 && (
                 <div className="parts-list" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    <strong style={{color: 'var(--primary)'}}>Parts:</strong> {item.parts.map(p => p.part_name).join(', ')}
                 </div>
               )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mp-flash mp-flash--ok" style={{ marginBottom: '1.5rem' }}>[ OK ] You're all caught up on immediate maintenance.</div>
      )}

      {timeline.upcoming && timeline.upcoming.length > 0 && (
        <div className="upcoming-list">
          <h4 style={{ color: 'var(--text-dim)' }}>[ UPCOMING ]</h4>
          {timeline.upcoming.map(item => (
            <div key={item.id} className="rs-card-inner" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem' }}>
               <span className="cp-svc-badge">{item.service_level.toUpperCase()}</span>
               <span>{item.description}</span>
               <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>in {item.miles_remaining} mi</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MaintenancePulse({ preselectedId, onBack }) {
  const { token } = useAuth();

  const [vehicles, setVehicles]     = useState([]);
  const [people, setPeople]         = useState([]);
  const [selectedId, setSelectedId] = useState(preselectedId && preselectedId !== 'NEW' ? preselectedId : null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  const [formMode, setFormMode]     = useState(preselectedId === 'NEW' ? 'add' : 'none'); // 'none' | 'add' | 'edit'
  const [view, setView]             = useState('log');  // 'log' | 'specs' | 'history' | 'settings'

  // log form state
  const [isProService, setIsProService]     = useState(false);
  const [serviceCenter, setServiceCenter]   = useState('');
  const [serviceType, setServiceType]       = useState('');
  const [mileage, setMileage]               = useState('');
  const [serviceDate, setServiceDate]       = useState(new Date().toISOString().split('T')[0]);
  const [performedById, setPerformedById]   = useState('');
  const [cost, setCost]                     = useState('');
  const [receiptFile, setReceiptFile]       = useState(null);
  const [checkedPoints, setCheckedPoints]   = useState({});   // idx → bool
  const [actualValues, setActualValues]     = useState({});   // idx → string
  const [saveStatus, setSaveStatus]         = useState('');

  // assignments for currently selected vehicle (used in log dropdown)
  const [vehicleAssignments, setVehicleAssignments] = useState([]);

  // history
  const [logs, setLogs] = useState([]);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchVehicles = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch('/api/vehicles/', token);
      setVehicles(data);
      setSelectedId((prev) => {
        if (prev && data.find((v) => v.id === prev)) return prev;
        return data.length > 0 ? data[0].id : null;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchPeople = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch('/api/vehicles/people', token);
      setPeople(data);
    } catch { setPeople([]); }
  }, [token]);

  const fetchVehicleAssignments = useCallback(async () => {
    if (!token || !selectedId) { setVehicleAssignments([]); return; }
    try {
      const data = await apiFetch(`/api/vehicles/${selectedId}/assignments`, token);
      setVehicleAssignments(data);
    } catch { setVehicleAssignments([]); }
  }, [token, selectedId]);

  useEffect(() => { fetchVehicles(); fetchPeople(); }, [fetchVehicles, fetchPeople]);
  useEffect(() => { fetchVehicleAssignments(); }, [fetchVehicleAssignments]);

  const fetchLogs = useCallback(async () => {
    if (!token || !selectedId) return;
    try {
      const data = await apiFetch(`/api/vehicles/${selectedId}/logs`, token);
      setLogs(data);
    } catch { setLogs([]); }
  }, [token, selectedId]);

  useEffect(() => {
    if (view === 'history') fetchLogs();
  }, [view, fetchLogs]);

  // reset performer when vehicle changes
  useEffect(() => { setPerformedById(''); }, [selectedId]);

  // -------------------------------------------------------------------------
  // Vehicle CRUD
  // -------------------------------------------------------------------------

  const handleAddVehicle = async (form) => {
    const v = await apiFetch('/api/vehicles/', token, { method: 'POST', body: JSON.stringify(form) });
    setFormMode('none');
    await fetchVehicles();
    setSelectedId(v.id);
  };

  const handleEditVehicle = async (form) => {
    await apiFetch(`/api/vehicles/${selectedId}`, token, { method: 'PATCH', body: JSON.stringify(form) });
    setFormMode('none');
    await fetchVehicles();
  };

  const handleDeleteVehicle = async () => {
    if (!window.confirm('Delete this vehicle and all its service logs?')) return;
    await apiFetch(`/api/vehicles/${selectedId}`, token, { method: 'DELETE' });
    setSelectedId(null);
    setFormMode('none');
    await fetchVehicles();
  };

  // -------------------------------------------------------------------------
  // Log submission
  // -------------------------------------------------------------------------

  const currentVehicle = vehicles.find((v) => v.id === selectedId);

  // Cycle: pending → done → skip → pending
  const handlePointToggle = (idx) =>
    setCheckedPoints((prev) => {
      const cur = prev[idx];
      if (!cur)          return { ...prev, [idx]: 'done' };
      if (cur === 'done') return { ...prev, [idx]: 'skip' };
      return { ...prev, [idx]: undefined };
    });

  const handleMarkAll = (state) =>
    setCheckedPoints(
      Object.fromEntries((currentVehicle.check_points || []).map((_, i) => [i, state]))
    );

  const handleActualValue = (idx, val) =>
    setActualValues((prev) => ({ ...prev, [idx]: val }));

  const handleSave = async () => {
    if (!currentVehicle) return;
    // Only include items that were actually serviced (done), not skipped or pending
    const checkResults = (currentVehicle.check_points || [])
      .map((cp, idx) => ({ cp, idx }))
      .filter(({ idx }) => isProService || checkedPoints[idx] === 'done')
      .map(({ cp, idx }) => ({
        description:    cp.description,
        check_point_id: cp.id,
        actual_value:   actualValues[idx] || null,
        passed:         true,
        // status auto-calculated server-side from actual_value + cp min/max
      }));
    const payload = {
      service_date:    new Date(serviceDate).toISOString(),
      odometer:        mileage ? Number(mileage) : null,
      is_pro_service:  isProService,
      service_center:  isProService ? serviceCenter : null,
      service_type:    serviceType || null,
      cost:            cost !== '' ? Number(cost) : null,
      notes:           '',
      performed_by_id: performedById || null,
      check_results:   checkResults,
    };
    try {
      const log = await apiFetch(`/api/vehicles/${selectedId}/logs`, token, {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (receiptFile && isProService) {
        const fd = new FormData();
        fd.append('file', receiptFile);
        await fetch(`/api/vehicles/logs/${log.id}/receipt`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }
      setSaveStatus('PULSE LOGGED // SYSTEM UPDATED');
      setTimeout(() => {
        setSaveStatus('');
        setCheckedPoints({});
        setActualValues({});
        setMileage('');
        setServiceCenter('');
        setServiceType('');
        setCost('');
        setPerformedById('');
        setReceiptFile(null);
      }, 3000);
    } catch (e) {
      setSaveStatus(`ERROR: ${e.message}`);
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="rs-foyer">
        <div className="rs-foyer-head"><h2 className="rs-greeting">MAINTENANCE PULSE</h2></div>
        <div className="mp-empty"><span style={{ color: 'var(--text-dim)' }}>LOADING GARAGE...</span></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rs-foyer">
        <div className="rs-foyer-head"><h2 className="rs-greeting">MAINTENANCE PULSE</h2></div>
        <div className="mp-error" style={{ margin: '20px 0' }}>BACKEND ERROR: {error}</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Empty garage
  // -------------------------------------------------------------------------

  if (vehicles.length === 0) {
    return (
      <div className="rs-foyer">
        <div className="rs-foyer-head">
          <h2 className="rs-greeting">MAINTENANCE PULSE</h2>
          <div className="pulse-status-indicator" data-status="idle" />
        </div>
        {formMode === 'add' ? (
          <>
            <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; ADD FIRST VEHICLE</h3>
            <VehicleForm onSave={handleAddVehicle} onCancel={() => setFormMode('none')} saveLabel=">> ADD VEHICLE" />
          </>
        ) : (
          <div className="mp-empty">
            <p style={{ color: 'var(--text-dim)', marginBottom: 4 }}>No vehicles in garage.</p>
            <button className="rs-pill" onClick={() => setFormMode('add')}>+ ADD FIRST VEHICLE</button>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main view
  // -------------------------------------------------------------------------

  const vehicleLabel = currentVehicle
    ? `${currentVehicle.year ? currentVehicle.year + ' ' : ''}${currentVehicle.make} ${currentVehicle.model}${currentVehicle.nickname ? ` "${currentVehicle.nickname}"` : ''}`
    : '';

  const VIEW_TABS = [
    { key: 'log',      label: 'LOG SERVICE' },
    { key: 'specs',    label: 'EDIT SPECS' },
    { key: 'history',  label: 'HISTORY' },
    { key: 'documents',label: 'DOCUMENTS' },
    { key: 'settings', label: 'SETTINGS' },
  ];

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {onBack && (
            <button className="rs-pill" onClick={onBack} title="Back to Garage">
              BACK
            </button>
          )}
          <h2 className="rs-greeting">MAINTENANCE PULSE</h2>
        </div>
        <div className="pulse-header-actions">
          {formMode === 'none' && (
            <button className="rs-pill" onClick={() => setFormMode('add')}>+ VEHICLE</button>
          )}
          <div className="pulse-status-indicator" data-status={saveStatus ? 'active' : 'idle'} />
        </div>
      </div>

      {/* ── Inline add form ── */}
      {formMode === 'add' && (
        <div className="rs-card is-wide" style={{ marginBottom: 24 }}>
          <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; ADD VEHICLE</h3>
          <VehicleForm onSave={handleAddVehicle} onCancel={() => setFormMode('none')} saveLabel=">> ADD VEHICLE" />
        </div>
      )}

      {/* ── Vehicle selector ── */}
      {formMode !== 'add' && (
        <div className="pulse-controls">
          <div className="pulse-field">
            <label className="rs-card-label">TARGET VEHICLE</label>
            <div className="vehicle-selector-row">
              <select
                className="pulse-select cyber-input"
                value={selectedId || ''}
                onChange={(e) => { setSelectedId(e.target.value); setCheckedPoints({}); setFormMode('none'); }}
              >
                {(vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.year ? `${v.year} ` : ''}{v.make} {v.model}{v.nickname ? ` "${v.nickname}"` : ''}
                  </option>
                ))}
              </select>
              <button className="rs-pill" onClick={() => setFormMode(formMode === 'edit' ? 'none' : 'edit')}>
                {formMode === 'edit' ? 'CANCEL' : 'EDIT'}
              </button>
              <button className="rs-pill btn-danger" onClick={handleDeleteVehicle}>DEL</button>
            </div>
          </div>

          {formMode === 'edit' && currentVehicle && (
            <div className="rs-card is-wide" style={{ marginBottom: 24 }}>
              <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; EDIT VEHICLE</h3>
              <VehicleForm
                initial={{
                  make: currentVehicle.make || '', model: currentVehicle.model || '',
                  year: currentVehicle.year || '', trim: currentVehicle.trim || '',
                  nickname: currentVehicle.nickname || '', vehicle_type: currentVehicle.vehicle_type || 'auto',
                  color: currentVehicle.color || '', vin: currentVehicle.vin || '',
                }}
                onSave={handleEditVehicle}
                onCancel={() => setFormMode('none')}
                saveLabel=">> SAVE CHANGES"
              />
            </div>
          )}

          {formMode !== 'edit' && (
            <div className="pulse-view-tabs">
              {(VIEW_TABS || []).map((t) => (
                <button
                  key={t.key}
                  className={`pulse-tab-btn ${view === t.key ? 'active' : ''}`}
                  onClick={() => setView(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LOG VIEW ── */}
      {formMode === 'none' && view === 'log' && currentVehicle && (
        <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 24 }}>

          {/* Performer selector */}
          {vehicleAssignments.length > 0 && (
            <div className="pulse-field" style={{ marginBottom: 14 }}>
              <label className="rs-card-label">PERFORMED BY</label>
              <select
                className="pulse-select cyber-input"
                value={performedById}
                onChange={(e) => setPerformedById(e.target.value)}
              >
                <option value="">— Select person —</option>
                {(vehicleAssignments || []).map((a) => (
                  <option key={a.person_id} value={a.person_id}>
                    {a.person_display_name || a.person_email}
                  </option>
                ))}
              </select>
            </div>
          )}
          {vehicleAssignments.length === 0 && people.length > 0 && (
            <div className="mp-assignment-warn">
              ⚠ No people assigned to this vehicle. Go to <strong>SETTINGS → VEHICLE ASSIGNMENTS</strong> to assign someone.
            </div>
          )}

          {/* Always-visible log fields */}
          <div className="log-header-fields">
            <div className="pulse-field">
              <label className="rs-card-label">SERVICE TYPE</label>
              <input
                className="cyber-input"
                placeholder="Oil Change, Brake Service…"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
              />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">ODOMETER</label>
              <input
                type="number"
                className="cyber-input num-input"
                placeholder="miles"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
              />
            </div>
            <div className="pulse-field">
              <label className="rs-card-label">SERVICE DATE</label>
              <input
                type="date"
                className="cyber-input"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
              />
            </div>
          </div>

          <label className="pulse-toggle" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={isProService} onChange={(e) => setIsProService(e.target.checked)} />
            <span className="toggle-slider"></span>
            <span className="toggle-text">PROFESSIONAL SERVICE PERFORMED</span>
          </label>

          {!isProService ? (
            <div className="inspection-mode animate-fade-in">
              <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; INSPECTION MODE // DIY</h3>
              {(currentVehicle.fluid_specs.length > 0 || currentVehicle.torque_specs.length > 0) && (
                <div className="specs-grid">
                  {currentVehicle.fluid_specs.length > 0 && (
                    <div className="spec-card">
                      <h4>[ FLUID SPECS ]</h4>
                      <ul>
                        {(currentVehicle.fluid_specs || []).map((f) => (
                          <li key={f.id}>
                            <span className="rs-card-value" style={{ fontSize: "1.1rem" }}>{f.name}</span>
                            <span className="spec-val">{f.spec}{f.volume ? ` (${f.volume})` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {currentVehicle.torque_specs.length > 0 && (
                    <div className="spec-card">
                      <h4>[ TORQUE VALUES ]</h4>
                      <ul>
                        {(currentVehicle.torque_specs || []).map((t) => (
                          <li key={t.id}>
                            <span className="rs-card-value" style={{ fontSize: "1.1rem" }}>{t.name}</span>
                            <span className="spec-val hl-warn">{t.ft_lb} Ft-Lb // {t.nm} N·m</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {currentVehicle.check_points.length > 0 ? (
                <PredictiveTimeline token={token} vehicleId={currentVehicle.id} currentOdometer={mileage} />
              ) : (
                <div className="mp-empty-specs">
                  No inspection items yet. Go to <strong>EDIT SPECS</strong> to add them, or upload an owner's manual in <strong>SETTINGS → MANUAL IMPORT</strong>.
                </div>
              )}
            </div>
          ) : (
            <div className="logging-mode animate-fade-in">
              <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; LOGGING MODE // PRO SERVICE</h3>
              <div className="form-grid">
                <div className="pulse-field">
                  <label className="rs-card-label">SERVICE CENTER NAME</label>
                  <input type="text" className="cyber-input" placeholder="e.g. Honda Powersports"
                    value={serviceCenter} onChange={(e) => setServiceCenter(e.target.value)} />
                </div>
                <div className="pulse-field">
                  <label className="rs-card-label">COST ($)</label>
                  <input type="number" className="cyber-input num-input" placeholder="0.00" step="0.01"
                    value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
                <div className="pulse-field full-width">
                  <label className="rs-card-label">RECEIPT UPLOAD (PDF/IMG)</label>
                  <div className="file-upload-wrapper">
                    <input type="file" id="receipt" className="file-input-hidden"
                      accept="image/*,application/pdf"
                      onChange={(e) => setReceiptFile(e.target.files[0])} />
                    <label htmlFor="receipt" className="file-upload-btn">
                      {receiptFile ? `[ ${receiptFile.name} ]` : '+ SELECT FILE'}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SPECS VIEW ── */}
      {formMode === 'none' && view === 'specs' && currentVehicle && (
        <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 24 }}>
          <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; SPECS EDITOR // {vehicleLabel.toUpperCase()}</h3>
          <SpecsEditor vehicle={currentVehicle} token={token} onUpdated={fetchVehicles} />
        </div>
      )}

      {/* ── HISTORY VIEW ── */}
      {formMode === 'none' && view === 'history' && (
        <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 24 }}>
          <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; SERVICE HISTORY</h3>
          {logs.length === 0 ? (
            <div className="mp-empty-specs">No service logs yet for this vehicle.</div>
          ) : (
            <div className="history-list">
              {(logs || []).map((log) => (
                <div key={log.id} className="rs-card-inner">
                  <div className="history-row">
                    <span className="history-date">{new Date(log.service_date).toLocaleDateString()}</span>
                    <span className={`history-type ${log.is_pro_service ? 'pro' : 'diy'}`}>
                      {log.is_pro_service ? 'PRO SERVICE' : 'DIY'}
                    </span>
                    {log.service_type && (
                      <span className="history-service-type">{log.service_type}</span>
                    )}
                    {log.odometer != null && (
                      <span className="history-odo">{log.odometer.toLocaleString()} mi</span>
                    )}
                  </div>
                  {log.performed_by && (
                    <div className="history-performer">
                      performed by <strong>{log.performed_by.display_name || log.performed_by.email}</strong>
                    </div>
                  )}
                  {log.service_center && <div className="history-center">{log.service_center}</div>}
                  {log.check_results.length > 0 && (
                    <div className="history-checks">
                      {(log.check_results || []).map((cr) => {
                        const st = cr.status || (cr.passed ? 'pass' : 'fail');
                        const icon = st === 'pass' ? '✓' : st === 'warn' ? '⚠' : '✗';
                        return (
                          <span key={cr.id} className={`history-check ${st}`}>
                            {icon} {cr.description}
                            {cr.actual_value && <em className="history-actual"> — {cr.actual_value}</em>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENTS VIEW ── */}
      {formMode === 'none' && view === 'documents' && currentVehicle && (
        <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 24 }}>
          <h3 className="rs-card-label" style={{ marginBottom: 16 }}>&gt; VEHICLE DOCUMENTS (RAG) // {vehicleLabel.toUpperCase()}</h3>
          <VehicleRAG token={token} vehicleId={selectedId} currentOdometer={mileage} />
        </div>
      )}

      {/* ── SETTINGS VIEW ── */}
      {formMode === 'none' && view === 'settings' && (
        <div className="rs-card is-wide animate-fade-in" style={{ marginBottom: 24 }}>
          <SettingsPanel
            token={token}
            vehicles={vehicles}
            people={people}
            selectedVehicleId={selectedId}
            onPeopleRefresh={() => { fetchPeople(); fetchVehicleAssignments(); }}
            onVehicleRefresh={fetchVehicles}
          />
        </div>
      )}

      {/* ── Footer / Save (log view only) ── */}
      {formMode === 'none' && view === 'log' && (
        <div className="pulse-footer">
          <button
            className={`rs-pill is-active ${saveStatus.startsWith('ERROR') ? 'btn-error' : saveStatus ? 'btn-success' : ''}`}
            onClick={handleSave}
            disabled={!!saveStatus || !currentVehicle}
          >
            {saveStatus ? `[ ${saveStatus} ]` : '>> COMMIT LOG ENTRY'}
          </button>
        </div>
      )}
    </div>
  );
}
