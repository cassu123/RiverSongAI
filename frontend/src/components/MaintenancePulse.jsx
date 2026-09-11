import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@context/AuthContext.jsx';
import { API_BASE } from '@lib/api';
import Sheet from '../chrome/Sheet.jsx';
import ChatInterface from '@components/ChatInterface.jsx';
import './MaintenancePulse.css';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch(path, token, opts = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: authHeaders(token), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'API error');
  }
  return res.status === 204 ? null : res.json();
}

// Vehicle types metered in engine hours rather than road miles.
const HOUR_METERED_TYPES = new Set(['atv', 'mower', 'tractor', 'generator']);
const isHourMetered = (v) => HOUR_METERED_TYPES.has(v?.vehicle_type);

function fmtDays(d) {
  if (!d) return null;
  if (d % 365 === 0) return `${d / 365}yr`;
  if (d % 30 === 0) return `${d / 30}mo`;
  if (d % 7 === 0) return `${d / 7}wk`;
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// CheckPoint Row (Specs Tab)
// ---------------------------------------------------------------------------
const BLANK_CP = {
  description: '',
  service_level: 'inspect',
  interval_miles: '',
  interval_days: '',
  due_at_miles: '',
  expected_spec: '',
  volume: '',
  min_value: '',
  max_value: '',
  unit: '',
  ft_lb: '',
  nm: '',
};

function CheckPointRow({ cp, token, vehicleId, onUpdated, isNonRoad }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    description: cp.description ?? '',
    service_level: cp.service_level ?? 'inspect',
    interval_miles: cp.interval_miles ?? '',
    interval_days: cp.interval_days ?? '',
    due_at_miles: cp.due_at_miles ?? '',
    expected_spec: cp.expected_spec ?? '',
    volume: cp.volume ?? '',
    min_value: cp.min_value ?? '',
    max_value: cp.max_value ?? '',
    unit: cp.unit ?? '',
    ft_lb: cp.ft_lb ?? '',
    nm: cp.nm ?? '',
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
          description: form.description || null,
          service_level: form.service_level,
          interval_miles: n(form.interval_miles),
          interval_days: n(form.interval_days),
          due_at_miles: n(form.due_at_miles),
          expected_spec: form.expected_spec || null,
          volume: form.volume || null,
          min_value: n(form.min_value),
          max_value: n(form.max_value),
          unit: form.unit || null,
          ft_lb: n(form.ft_lb),
          nm: n(form.nm),
        }),
      });
      setEditing(false);
      onUpdated();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!window.confirm(`Delete checkpoint "${cp.description}"?`)) return;
    await apiFetch(`/api/vehicles/${vehicleId}/specs/checkpoints/${cp.id}`, token, { method: 'DELETE' });
    onUpdated();
  };

  const svcColors = {
    inspect: 'var(--primary)',
    service: 'var(--rs-status-warning, #facc15)',
    replace: 'var(--rs-status-critical, #ff8b8b)'
  };
  const svcColor = svcColors[cp.service_level] || 'var(--primary)';

  return (
    <li className="cp-row">
      <div className="cp-row-main">
        <span className="cp-svc-badge" style={{ borderColor: svcColor, color: svcColor }}>
          {cp.service_level ? cp.service_level.toUpperCase() : 'INSPECT'}
        </span>
        <span style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>{cp.description}</span>
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
        {(cp.interval_miles || cp.due_at_miles) && (
          <span className="cp-interval-tag">
            {cp.due_at_miles ? `Due: ${cp.due_at_miles.toLocaleString()} ${isNonRoad ? 'hrs' : 'mi'}` : `Every ${cp.interval_miles.toLocaleString()} ${isNonRoad ? 'hrs' : 'mi'}`}
          </span>
        )}
        {cp.parts && cp.parts.map(p => (
          <span key={p.id} className="cp-interval-tag" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            {p.part_name} {p.oem_part_number || p.part_number ? `(${p.oem_part_number || p.part_number})` : ''}
          </span>
        ))}
        <div className="cp-row-actions">
          <button className="rs-pill" onClick={async () => {
            const partName = window.prompt('Enter Part Name (e.g. Oil Filter, Spark Plug, Brake Pads):');
            if (!partName) return;
            const partNum = window.prompt('Enter OEM Part Number (Optional):');
            await apiFetch(`/api/vehicles/${vehicleId}/parts`, token, {
              method: 'POST',
              body: JSON.stringify({ check_point_id: cp.id, part_name: partName, oem_part_number: partNum || null })
            });
            onUpdated();
          }}>+ PART</button>
          <button className="rs-pill" onClick={() => setEditing(e => !e)}>
            {editing ? 'CLOSE' : 'EDIT'}
          </button>
          <button className="rs-pill" onClick={del}>✕</button>
        </div>
      </div>

      {editing && (
        <div className="cp-edit-panel">
          <div className="cp-edit-grid">
            <div className="cockpit-input-box" style={{ gridColumn: 'span 2' }}>
              <span className="card-metric-label">DESCRIPTION</span>
              <input className="cockpit-input-raw" value={form.description} onChange={set('description')} />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">SERVICE LEVEL</span>
              <select className="cockpit-input-raw" value={form.service_level} onChange={set('service_level')}>
                <option value="inspect">Inspect</option>
                <option value="service">Service</option>
                <option value="replace">Replace</option>
              </select>
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">EXPECTED SPEC</span>
              <input className="cockpit-input-raw" value={form.expected_spec} onChange={set('expected_spec')} placeholder="e.g. SAE 5W-30" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">CAPACITY / VOLUME</span>
              <input className="cockpit-input-raw" value={form.volume} onChange={set('volume')} placeholder="e.g. 4.5 Qt" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">TORQUE (FT-LB)</span>
              <input className="cockpit-input-raw" type="number" value={form.ft_lb} onChange={set('ft_lb')} placeholder="18" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">INTERVAL ({isNonRoad ? 'HOURS' : 'MILES'})</span>
              <input className="cockpit-input-raw" type="number" value={form.interval_miles} onChange={set('interval_miles')} placeholder="5000" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">NEXT DUE ({isNonRoad ? 'HOURS' : 'MILES'})</span>
              <input className="cockpit-input-raw" type="number" value={form.due_at_miles} onChange={set('due_at_miles')} placeholder="5000" />
            </div>
          </div>
          <div className="rs-flex rs-gap-2 rs-mt-4" style={{ justifyContent: 'flex-end' }}>
            <button className="rs-pill" onClick={() => setEditing(false)}>CANCEL</button>
            <button className="rs-btn-primary" onClick={save} disabled={busy}>{busy ? 'SAVING...' : 'SAVE CHANGES'}</button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Specs Editor Component
// ---------------------------------------------------------------------------
function SpecsEditor({ vehicle, token, onUpdated, isNonRoad }) {
  const [newPoint, setNewPoint] = useState(BLANK_CP);
  const [showAdd, setShowAdd] = useState(false);
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
          description: newPoint.description,
          service_level: newPoint.service_level,
          sort_order: (vehicle.check_points || []).length,
          interval_miles: n(newPoint.interval_miles),
          interval_days: n(newPoint.interval_days),
          due_at_miles: n(newPoint.due_at_miles),
          expected_spec: newPoint.expected_spec || null,
          volume: newPoint.volume || null,
          min_value: n(newPoint.min_value),
          max_value: n(newPoint.max_value),
          unit: newPoint.unit || null,
          ft_lb: n(newPoint.ft_lb),
          nm: n(newPoint.nm),
        }),
      });
      setNewPoint(BLANK_CP);
      setShowAdd(false);
      onUpdated();
    } finally { setBusy(false); }
  };

  return (
    <div className="specs-editor">
      <div className="rs-flex rs-justify-between rs-items-center rs-mb-4">
        <span className="card-metric-label" style={{ fontSize: 'var(--rs-fs-micro)', letterSpacing: '0.12em' }}>
          CHECKPOINTS &amp; SPECIFICATIONS MASTER ROSTER ({(vehicle.check_points || []).length})
        </span>
        {(vehicle.check_points || []).length > 0 && (
          <button
            className="rs-pill btn-danger"
            onClick={async () => {
              if (!window.confirm(`Clear all ${vehicle.check_points.length} checkpoints? This cannot be undone.`)) return;
              await apiFetch(`/api/vehicles/${vehicle.id}/specs/checkpoints`, token, { method: 'DELETE' });
              onUpdated();
            }}
          >
            CLEAR ALL
          </button>
        )}
      </div>

      {(vehicle.check_points || []).length === 0 && !showAdd && (
        <div className="mp-empty-specs">
          No checkpoints configured for this vehicle yet. Add items below or import from an owner's manual in Settings.
        </div>
      )}

      <ul className="cp-list rs-mb-4">
        {(vehicle.check_points || []).map((cp) => (
          <CheckPointRow key={cp.id} cp={cp} token={token} vehicleId={vehicle.id} onUpdated={onUpdated} isNonRoad={isNonRoad} />
        ))}
      </ul>

      {!showAdd ? (
        <button className="rs-pill is-active" onClick={() => setShowAdd(true)}>
          <span className="material-symbols-rounded">add</span>
          <span>ADD CHECKPOINT</span>
        </button>
      ) : (
        <div className="rs-card is-wide rs-p-5">
          <h4 style={{ margin: '0 0 14px 0', color: 'var(--primary)', fontSize: 'var(--rs-fs-small)' }}>&gt; CREATE NEW CHECKPOINT</h4>
          <div className="cp-edit-grid">
            <div className="cockpit-input-box" style={{ gridColumn: 'span 2' }}>
              <span className="card-metric-label">DESCRIPTION *</span>
              <input className="cockpit-input-raw" value={newPoint.description} onChange={setNp('description')} placeholder="e.g. Engine Oil & Filter" required />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">SERVICE LEVEL</span>
              <select className="cockpit-input-raw" value={newPoint.service_level} onChange={setNp('service_level')}>
                <option value="inspect">Inspect</option>
                <option value="service">Service</option>
                <option value="replace">Replace</option>
              </select>
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">EXPECTED SPEC</span>
              <input className="cockpit-input-raw" value={newPoint.expected_spec} onChange={setNp('expected_spec')} placeholder="e.g. Dexos1 5W-30" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">CAPACITY / VOLUME</span>
              <input className="cockpit-input-raw" value={newPoint.volume} onChange={setNp('volume')} placeholder="e.g. 5.0 Qt" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">UNIT</span>
              <input className="cockpit-input-raw" value={newPoint.unit} onChange={setNp('unit')} placeholder="PSI / mm" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">TORQUE (FT-LB)</span>
              <input className="cockpit-input-raw" type="number" value={newPoint.ft_lb} onChange={setNp('ft_lb')} placeholder="18" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">INTERVAL ({isNonRoad ? 'HOURS' : 'MILES'})</span>
              <input className="cockpit-input-raw" type="number" value={newPoint.interval_miles} onChange={setNp('interval_miles')} placeholder="5000" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">NEXT DUE ({isNonRoad ? 'HOURS' : 'MILES'})</span>
              <input className="cockpit-input-raw" type="number" value={newPoint.due_at_miles} onChange={setNp('due_at_miles')} placeholder="5000" />
            </div>
          </div>
          <div className="rs-flex rs-gap-3 rs-mt-4" style={{ justifyContent: 'flex-end' }}>
            <button className="rs-pill" onClick={() => { setShowAdd(false); setNewPoint(BLANK_CP); }}>CANCEL</button>
            <button className="rs-btn-primary" onClick={addPoint} disabled={busy || !newPoint.description.trim()}>
              {busy ? 'SAVING...' : 'CREATE ITEM'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People Settings Subsystem
// ---------------------------------------------------------------------------
function PeopleSettings({ token, people, onRefresh }) {
  const [emailInput, setEmailInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const flash = (ok, text) => {
    if (ok) setMsg(text); else setError(text);
    setTimeout(() => { setMsg(''); setError(''); }, 4000);
  };

  const handleAdd = async () => {
    if (!emailInput.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/api/vehicles/people', token, {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.trim().toLowerCase() })
      });
      setEmailInput('');
      flash(true, 'Member added to roster.');
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
      flash(true, `${person.display_name || person.email} removed.`);
      onRefresh();
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rs-card is-wide rs-p-5">
      <div className="rs-card-head rs-mb-4">
        <span className="rs-card-label">&gt; MAINTENANCE CREW ROSTER</span>
      </div>
      <p className="rs-mb-4" style={{ color: 'var(--md-on-surface-variant)', fontSize: 'var(--rs-fs-small)', marginTop: 0 }}>
        Add authorized crew members by email. Assigned crew will appear in the "Performed By" selector when logging maintenance.
      </p>

      {msg && <div className="mp-flash--ok rs-mb-4">{msg}</div>}
      {error && <div className="mp-error rs-mb-4">{error}</div>}

      <div className="rs-flex rs-gap-3 rs-mb-5">
        <input
          className="cockpit-input-raw rs-grow"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}
          placeholder="member@example.com"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className="rs-btn-primary" onClick={handleAdd} disabled={busy || !emailInput.trim()}>
          {busy ? 'ADDING...' : '+ ADD MEMBER'}
        </button>
      </div>

      {people.length === 0 ? (
        <div className="mp-empty-specs">No crew members registered yet.</div>
      ) : (
        <ul className="cp-list">
          {people.map(p => (
            <li key={p.id} className="cp-row rs-flex rs-flex-row rs-items-center rs-justify-between">
              <div>
                <strong style={{ fontSize: 'var(--rs-fs-body)', color: 'var(--fg)' }}>{p.display_name || p.email}</strong>
                {p.display_name && <div style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--md-on-surface-variant)' }}>{p.email}</div>}
              </div>
              <div className="rs-flex rs-items-center rs-gap-3">
                {p.vehicle_ids?.length > 0 && (
                  <span className="cp-spec-tag">{p.vehicle_ids.length} vehicle(s)</span>
                )}
                <button className="rs-pill" onClick={() => handleRemove(p)} title="Remove person">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments Settings Subsystem
// ---------------------------------------------------------------------------
function AssignmentsSettings({ token, vehicles, people, selectedVehicleId, onPeopleRefresh }) {
  const [vehicleId, setVehicleId] = useState(selectedVehicleId || vehicles[0]?.id || '');
  const [assignments, setAssignments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const flash = (ok, text) => {
    if (ok) setMsg(text); else setError(text);
    setTimeout(() => { setMsg(''); setError(''); }, 3000);
  };

  const fetchAssignments = useCallback(async () => {
    if (!vehicleId || !token) return;
    try {
      const data = await apiFetch(`/api/vehicles/${vehicleId}/assignments`, token);
      setAssignments(data || []);
    } catch { setAssignments([]); }
  }, [vehicleId, token]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const assignedPersonIds = new Set(assignments.map(a => a.person_id));
  const unassigned = people.filter(p => !assignedPersonIds.has(p.id));

  const handleAssign = async (personId) => {
    setBusy(true);
    try {
      await apiFetch(`/api/vehicles/${vehicleId}/assignments`, token, {
        method: 'POST',
        body: JSON.stringify({ person_id: personId })
      });
      flash(true, 'Assigned to vehicle.');
      fetchAssignments();
      onPeopleRefresh();
    } catch (e) { flash(false, e.message); }
    finally { setBusy(false); }
  };

  const handleUnassign = async (personId) => {
    setBusy(true);
    try {
      await apiFetch(`/api/vehicles/${vehicleId}/assignments/${personId}`, token, { method: 'DELETE' });
      flash(true, 'Unassigned.');
      fetchAssignments();
      onPeopleRefresh();
    } catch (e) { flash(false, e.message); }
    finally { setBusy(false); }
  };

  const currentV = vehicles.find(v => String(v.id) === String(vehicleId));

  return (
    <div className="rs-card is-wide rs-p-5">
      <div className="rs-card-head rs-mb-4">
        <span className="rs-card-label">&gt; VEHICLE ASSIGNMENTS &amp; OPERATORS</span>
      </div>

      {msg && <div className="mp-flash--ok rs-mb-4">{msg}</div>}
      {error && <div className="mp-error rs-mb-4">{error}</div>}

      <div className="cockpit-input-box rs-mb-5" style={{ maxWidth: 360 }}>
        <span className="card-metric-label">TARGET VEHICLE</span>
        <select className="cockpit-input-raw" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
          {vehicles.map(v => (
            <option key={v.id} value={v.id} style={{ background: 'var(--bg-base)' }}>
              {v.nickname || `${v.year || ''} ${v.make} ${v.model}`}
            </option>
          ))}
        </select>
      </div>

      <div className="rs-gap-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* Assigned */}
        <div className="rs-p-4" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="card-metric-label rs-mb-3">
            ASSIGNED TO {currentV?.nickname?.toUpperCase() || currentV?.model?.toUpperCase() || 'VEHICLE'}
          </div>
          {assignments.length === 0 ? (
            <div className="mp-empty-specs rs-p-4">No crew assigned to this vehicle yet.</div>
          ) : (
            <ul className="cp-list">
              {assignments.map(a => (
                <li key={a.person_id} className="cp-row rs-flex rs-flex-row rs-items-center rs-justify-between" style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 'var(--rs-fs-small)', color: 'var(--fg)' }}>{a.person_display_name || a.person_email}</span>
                  <button className="rs-pill btn-danger" onClick={() => handleUnassign(a.person_id)} disabled={busy}>
                    UNASSIGN
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Unassigned */}
        <div className="rs-p-4" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="card-metric-label rs-mb-3">AVAILABLE ROSTER MEMBERS</div>
          {unassigned.length === 0 ? (
            <div className="mp-empty-specs rs-p-4">All registered members are assigned.</div>
          ) : (
            <ul className="cp-list">
              {unassigned.map(p => (
                <li key={p.id} className="cp-row rs-flex rs-flex-row rs-items-center rs-justify-between" style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 'var(--rs-fs-small)', color: 'var(--fg)' }}>{p.display_name || p.email}</span>
                  <button className="rs-pill is-active" onClick={() => handleAssign(p.id)} disabled={busy}>
                    + ASSIGN
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual Upload Subsystem
// ---------------------------------------------------------------------------
function ManualUpload({ token, vehicleId, onUpdated }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
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
    setBusy(true); setBusyLabel('Parsing manual text and detecting intervals…'); setError(''); setPreview(null); setResult(null);
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
    setBusy(true); setBusyLabel('Extracting specs and committing checkpoints…'); setError(''); setResult(null);
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

  return (
    <div className="rs-card is-wide rs-p-5">
      <div className="rs-card-head rs-mb-4">
        <span className="rs-card-label">&gt; AUTOMATED MANUAL IMPORT &amp; SPECS EXTRACTION</span>
      </div>
      <p className="rs-mb-4" style={{ color: 'var(--md-on-surface-variant)', fontSize: 'var(--rs-fs-small)', marginTop: 0 }}>
        Upload a factory service manual or owner's handbook (PDF). Maintenance schedules, fluid capacities, torque specs, and intervals will be parsed and staged.
      </p>

      {result && (
        <div className="mp-flash--ok rs-mb-4">
          Successfully applied! {result.updated} updated, {result.created} new checkpoints configured ({result.total} total found).
        </div>
      )}
      {error && <div className="mp-error rs-mb-4">{error}</div>}

      <div className="rs-flex rs-gap-3 rs-items-center rs-flex-wrap rs-mb-5">
        <input ref={fileRef} type="file" accept="application/pdf" className="rs-hidden" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }} />
        <button className="rs-pill" onClick={() => fileRef.current?.click()}>
          <span className="material-symbols-rounded">upload_file</span>
          <span>{file ? file.name : 'SELECT PDF MANUAL'}</span>
        </button>
        {file && (
          <>
            <button className="rs-pill" onClick={handlePreview} disabled={busy}>PREVIEW DETECTED ITEMS</button>
            <button className="rs-btn-primary" onClick={handleApply} disabled={busy}>EXTRACT &amp; APPLY</button>
            <button className="rs-pill" onClick={() => { setFile(null); setPreview(null); }}>✕</button>
          </>
        )}
        {busy && <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{busyLabel}</span>}
      </div>

      {preview && (
        <div className="rs-mt-4 rs-p-4" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
          <div className="card-metric-label rs-mb-3">PREVIEW — {preview.length} ITEMS DETECTED</div>
          {preview.length === 0 ? (
            <div className="mp-empty-specs">No structured maintenance items detected in this document.</div>
          ) : (
            <ul className="cp-list">
              {preview.map((item, i) => (
                <li key={i} className="cp-row" style={{ padding: '10px 14px' }}>
                  <div className="rs-flex rs-items-center rs-gap-3 rs-flex-wrap">
                    <span className="cp-svc-badge">{item.service_level || 'INSPECT'}</span>
                    <strong style={{ color: 'var(--fg)' }}>{item.description}</strong>
                    {item.expected_spec && <span className="cp-spec-tag">{item.expected_spec}</span>}
                    {item.interval_miles && <span className="cp-interval-tag">{item.interval_miles.toLocaleString()} mi</span>}
                    {item.ft_lb && <span className="cp-torque-tag">{item.ft_lb} ft-lb</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Panel Container
// ---------------------------------------------------------------------------
function SettingsPanel({ token, vehicles, people, selectedVehicleId, onPeopleRefresh, onVehicleRefresh }) {
  const [section, setSection] = useState('people');

  return (
    <div className="mp-settings-panel">
      <div className="mp-settings-tabs">
        <button className={`mp-settings-tab ${section === 'people' ? 'active' : ''}`} onClick={() => setSection('people')}>
          PEOPLE ROSTER
        </button>
        <button className={`mp-settings-tab ${section === 'assignments' ? 'active' : ''}`} onClick={() => setSection('assignments')}>
          VEHICLE ASSIGNMENTS
        </button>
        <button className={`mp-settings-tab ${section === 'manual' ? 'active' : ''}`} onClick={() => setSection('manual')}>
          MANUAL IMPORT
        </button>
      </div>

      {section === 'people' && (
        <PeopleSettings token={token} people={people} onRefresh={onPeopleRefresh} />
      )}
      {section === 'assignments' && (
        <AssignmentsSettings token={token} vehicles={vehicles} people={people} selectedVehicleId={selectedVehicleId} onPeopleRefresh={onPeopleRefresh} />
      )}
      {section === 'manual' && (
        <ManualUpload token={token} vehicleId={selectedVehicleId} onUpdated={onVehicleRefresh} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vehicle RAG Subsystem (Documents Tab)
// ---------------------------------------------------------------------------
function VehicleRAG({ token, vehicleId, currentOdometer, onUpdated }) {
  const [file, setFile] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleIngest = async () => {
    if (!file) return;
    setIngesting(true); setError(''); setNotice('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/vehicles/${vehicleId}/manual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Ingestion failed');
      }
      const data = await res.json().catch(() => null);
      setNotice(
        data && data.total != null
          ? `Indexed. ${data.created ?? 0} new and ${data.updated ?? 0} updated checkpoints extracted from ${data.total} detected items.`
          : 'Document indexed into this vehicle\'s knowledgebase.'
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      if (onUpdated) onUpdated();
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
        body: JSON.stringify({ question: question.trim(), current_odometer: isNaN(odo) ? null : odo })
      });
      if (!res.ok) throw new Error('AI query failed');
      const data = await res.json();
      setAnswer(data);
      setQuestion('');
    } catch (e) { setError(e.message); }
    finally { setAsking(false); }
  };

  return (
    <div className="rs-card is-wide rs-p-5">
      <div className="rs-card-head rs-mb-4">
        <span className="rs-card-label">&gt; CONVERSATIONAL TECHNICAL DOSSIER</span>
      </div>
      <p className="rs-mb-4" style={{ color: 'var(--md-on-surface-variant)', fontSize: 'var(--rs-fs-small)', marginTop: 0 }}>
        Ask River Song about fluid capacities, torque specs, part numbers, or upcoming service schedules grounded in your vehicle's technical manual.
      </p>

      {notice && <div className="mp-flash--ok rs-mb-4">{notice}</div>}
      {error && <div className="mp-error rs-mb-4">{error}</div>}

      <div className="rs-flex rs-gap-3 rs-items-center rs-mb-5">
        <input ref={fileRef} type="file" accept=".pdf,.txt" className="rs-hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button className="rs-pill" onClick={() => fileRef.current?.click()}>
          <span className="material-symbols-rounded">upload_file</span>
          <span>{file ? file.name : 'UPLOAD MANUAL / DOSSIER'}</span>
        </button>
        {file && (
          <button className="rs-btn-primary" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? 'INGESTING...' : 'INGEST FILE'}
          </button>
        )}
      </div>

      <form onSubmit={handleAsk} className="rs-flex rs-gap-3">
        <input
          className="cockpit-input-raw rs-grow"
          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}
          placeholder="e.g. 'What oil viscosity is recommended?' or 'What is the torque for the oil drain plug?'"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={asking}
        />
        <button className="rs-btn-primary" type="submit" disabled={asking || !question.trim()}>
          {asking ? 'THINKING...' : 'QUERY'}
        </button>
      </form>

      {answer && (
        <div className="mp-rag-answer animate-fade-in rs-mt-5">
          <div style={{ fontSize: 'var(--rs-fs-small)', lineHeight: 1.6, color: 'var(--fg)' }}>
            {answer.response}
          </div>
          {answer.chunks?.length > 0 && (
            <details className="rs-mt-4" style={{ opacity: 0.8, fontSize: 'var(--rs-fs-tiny)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--primary)' }}>View Citations ({answer.chunks.length})</summary>
              <div className="rs-mt-2 rs-flex rs-flex-col rs-gap-2">
                {answer.chunks.map((c, idx) => (
                  <div key={idx} style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
                    {c.text}
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
// Main MaintenancePulse Cockpit Component
// ---------------------------------------------------------------------------
export default function MaintenancePulse({
  preselectedId,
  onBack,
  onVehicleChange,
  vehicles = [],
  onRefreshVehicles = () => {},
  setAction = () => {}
}) {
  const { token } = useAuth();
  const [selectedId, setSelectedId] = useState(preselectedId || (vehicles[0]?.id ?? null));
  const [activeTab, setActiveTab] = useState('walkthrough');
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [showAskRiver, setShowAskRiver] = useState(false);

  // Active Vehicle Data
  const currentVehicle = useMemo(() => {
    return vehicles.find(v => String(v.id) === String(selectedId)) || null;
  }, [vehicles, selectedId]);

  // Current Odometer & Inline update
  const currentOdometer = useMemo(() => {
    if (!currentVehicle) return 0;
    return currentVehicle.current_odometer ?? (currentVehicle.usage_readings?.[0]?.value ?? 0);
  }, [currentVehicle]);

  const isNonRoad = isHourMetered(currentVehicle);
  const unitLabel = isNonRoad ? 'HRS' : 'MI';
  const usageUnit = isNonRoad ? 'hours' : 'miles';

  const [isUpdatingOdo, setIsUpdatingOdo] = useState(false);
  const [newOdoInput, setNewOdoInput] = useState('');
  const [odoSaving, setOdoSaving] = useState(false);

  // Edit Vehicle Details Form state
  const [editForm, setEditForm] = useState({
    make: '', model: '', year: '', trim: '', nickname: '',
    vehicle_type: 'auto', color: '', vin: ''
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Service Log Form state
  const [logForm, setLogForm] = useState({
    service_date: new Date().toISOString().split('T')[0],
    service_type: '',
    odometer: '',
    performed_by_id: '',
    service_center: 'Personal Hangar',
    cost: '',
    notes: '',
    is_pro_service: false,
    receipt_file: null
  });
  const [logCheckedPoints, setLogCheckedPoints] = useState({});
  const [logActualValues, setLogActualValues] = useState({});
  const [submittingLog, setSubmittingLog] = useState(false);

  // Roster & Assignments & History
  const [people, setPeople] = useState([]);
  const [vehicleAssignments, setVehicleAssignments] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Fetch People & Assignments
  const fetchPeople = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch('/api/vehicles/people', token);
      setPeople(data || []);
    } catch { setPeople([]); }
  }, [token]);

  const fetchVehicleAssignments = useCallback(async () => {
    if (!token || !selectedId) {
      setVehicleAssignments([]);
      return;
    }
    try {
      const data = await apiFetch(`/api/vehicles/${selectedId}/assignments`, token);
      setVehicleAssignments(data || []);
    } catch { setVehicleAssignments([]); }
  }, [token, selectedId]);

  const fetchLogs = useCallback(async () => {
    if (!token || !selectedId) return;
    setLoadingLogs(true);
    try {
      const data = await apiFetch(`/api/vehicles/${selectedId}/logs`, token);
      setLogs(data || []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [token, selectedId]);

  useEffect(() => {
    fetchPeople();
  }, [fetchPeople]);

  useEffect(() => {
    fetchVehicleAssignments();
  }, [fetchVehicleAssignments]);

  useEffect(() => {
    if (activeTab === 'history') fetchLogs();
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (currentVehicle) {
      setEditForm({
        make: currentVehicle.make || '',
        model: currentVehicle.model || '',
        year: currentVehicle.year || '',
        trim: currentVehicle.trim || '',
        nickname: currentVehicle.nickname || '',
        vehicle_type: currentVehicle.vehicle_type || 'auto',
        color: currentVehicle.color || '',
        vin: currentVehicle.vin || ''
      });
      const odo = currentVehicle.current_odometer ?? (currentVehicle.usage_readings?.[0]?.value ?? '');
      setNewOdoInput(odo ? String(odo) : '');
      setLogForm(prev => ({
        ...prev,
        odometer: odo ? String(odo) : ''
      }));
    }
  }, [currentVehicle]);

  // Milestone Walkthrough state
  const [selectedMilestone, setSelectedMilestone] = useState(null);
  const [checkStatuses, setCheckStatuses] = useState({});
  const [actualValues, setActualValues] = useState({});

  // Auto-compute available milestones from checkpoints
  const { milestones, currentMilestone, activeProcedures, futureProcedures, stagedProvisions, fastenerTorques } = useMemo(() => {
    const checkPoints = currentVehicle?.check_points || [];
    const setMiles = new Set();

    checkPoints.forEach(cp => {
      if (cp.due_at_miles) setMiles.add(cp.due_at_miles);
      if (cp.interval_miles) {
        setMiles.add(cp.interval_miles);
        if (currentOdometer > cp.interval_miles) {
          const nextMult = Math.ceil(currentOdometer / cp.interval_miles) * cp.interval_miles;
          setMiles.add(nextMult);
        }
      }
    });

    const sortedMiles = Array.from(setMiles).sort((a, b) => a - b);

    const dueMilestone = sortedMiles.find(m => m >= currentOdometer)
      ?? sortedMiles[sortedMiles.length - 1]
      ?? null;
    const activeM = selectedMilestone ?? dueMilestone;

    const active = [];
    const future = [];

    checkPoints.forEach(cp => {
      const due = cp.due_at_miles || cp.interval_miles || 0;
      const matchesInterval =
        typeof activeM === 'number' && cp.interval_miles && activeM % cp.interval_miles === 0;
      if (activeM === 'all' || (activeM != null && due === activeM) || matchesInterval) {
        active.push(cp);
      } else {
        future.push(cp);
      }
    });

    const provs = [];
    active.forEach(cp => {
      if (cp.parts && cp.parts.length > 0) {
        cp.parts.forEach(p => provs.push(`${p.part_name} ${p.oem_part_number || p.part_number ? `(${p.oem_part_number || p.part_number})` : ''}`));
      } else if (cp.volume && cp.expected_spec) {
        provs.push(`${cp.volume} ${cp.expected_spec}`);
      } else if (cp.expected_spec) {
        provs.push(cp.expected_spec);
      }
    });

    const torques = [];
    checkPoints.forEach(cp => {
      if (cp.ft_lb || cp.nm) {
        torques.push({ item: cp.description, ft_lb: cp.ft_lb, nm: cp.nm });
      }
    });
    if (currentVehicle?.torque_specs) {
      currentVehicle.torque_specs.forEach(ts => {
        torques.push({ item: ts.name, ft_lb: ts.ft_lb, nm: ts.nm });
      });
    }

    return {
      milestones: sortedMiles,
      currentMilestone: dueMilestone,
      activeProcedures: active,
      futureProcedures: future,
      stagedProvisions: Array.from(new Set(provs)),
      fastenerTorques: torques
    };
  }, [currentVehicle, currentOdometer, selectedMilestone]);

  // Handle Odometer Update
  const handleSaveOdometer = async () => {
    const val = parseInt(newOdoInput, 10);
    if (isNaN(val) || val < 0) return;
    setOdoSaving(true);
    try {
      await apiFetch(`/api/vehicles/${selectedId}/usage`, token, {
        method: 'POST',
        body: JSON.stringify({ value: val, unit: usageUnit, source: 'manual' })
      });
      setIsUpdatingOdo(false);
      onRefreshVehicles();
    } catch (e) {
      alert(`Failed to update odometer: ${e.message}`);
    } finally {
      setOdoSaving(false);
    }
  };

  // Handle Edit Vehicle Details
  const handleSaveVehicleDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      await apiFetch(`/api/vehicles/${selectedId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editForm,
          year: editForm.year ? Number(editForm.year) : null
        })
      });
      setShowDetailsDrawer(false);
      onRefreshVehicles();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSavingDetails(false);
    }
  };

  // Handle Delete Vehicle
  const handleDeleteVehicle = async () => {
    if (!window.confirm(`Permanently remove ${currentVehicle?.nickname || currentVehicle?.model} from the hangar?`)) return;
    try {
      await apiFetch(`/api/vehicles/${selectedId}`, token, { method: 'DELETE' });
      onBack();
      onRefreshVehicles();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // Quick Start Interval from Walkthrough
  const handleStartIntervalInLog = () => {
    const milestoneNum = selectedMilestone ?? currentMilestone;
    const mLabel = typeof milestoneNum === 'number'
      ? `${milestoneNum.toLocaleString()}-${unitLabel === 'HRS' ? 'Hour' : 'Mile'} Scheduled Maintenance`
      : 'Scheduled Maintenance';

    // Only procedures the operator left staged (not skipped) carry over, along
    // with any values they actually measured. Nothing is marked done for them.
    const carried = {};
    activeProcedures.forEach(cp => {
      if ((checkStatuses[cp.id] || 'nominal') !== 'skip') carried[cp.id] = 'done';
    });
    setLogCheckedPoints(carried);
    setLogActualValues(prev => ({ ...prev, ...actualValues }));

    setLogForm(prev => ({
      ...prev,
      service_type: mLabel,
      odometer: currentOdometer > 0 ? String(currentOdometer) : '',
      notes: prev.notes || ''
    }));
    setActiveTab('log');
  };

  // Handle Service Log Submission
  const handleSubmitServiceLog = async (e) => {
    if (e) e.preventDefault();
    if (!currentVehicle) return;
    setSubmittingLog(true);

    const checkResults = (currentVehicle.check_points || [])
      .filter(cp => logForm.is_pro_service || logCheckedPoints[cp.id] === 'done')
      .map(cp => {
        const raw = logActualValues[cp.id];
        const measured = raw !== undefined && raw !== '' ? Number(raw) : null;
        const inRange = measured === null || Number.isNaN(measured)
          ? true
          : (cp.min_value == null || measured >= cp.min_value)
            && (cp.max_value == null || measured <= cp.max_value);
        return {
          description: cp.description,
          check_point_id: cp.id,
          actual_value: raw || null,
          status: inRange ? 'pass' : 'fail',
          passed: inRange,
        };
      });

    const odoNum = logForm.odometer ? parseInt(logForm.odometer, 10) : null;

    try {
      const log = await apiFetch(`/api/vehicles/${selectedId}/logs`, token, {
        method: 'POST',
        body: JSON.stringify({
          service_date: logForm.service_date ? new Date(logForm.service_date).toISOString() : new Date().toISOString(),
          odometer: isNaN(odoNum) ? null : odoNum,
          service_type: logForm.service_type || 'General Maintenance',
          service_center: logForm.is_pro_service ? logForm.service_center : 'Personal Hangar',
          cost: logForm.cost ? parseFloat(logForm.cost) : null,
          notes: logForm.notes || '',
          is_pro_service: logForm.is_pro_service,
          performed_by_id: logForm.performed_by_id || null,
          check_results: checkResults
        })
      });

      if (logForm.receipt_file && log?.id) {
        const fd = new FormData();
        fd.append('file', logForm.receipt_file);
        await fetch(`/api/vehicles/logs/${log.id}/receipt`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      }

      alert('Maintenance successfully recorded!');
      onRefreshVehicles();
      fetchLogs();
      setActiveTab('history');
    } catch (err) {
      alert(`Logging failed: ${err.message}`);
    } finally {
      setSubmittingLog(false);
    }
  };

  // Contextual Action Bar in Cockpit
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls rs-w-full rs-justify-center">
        <div className="rs-flex rs-gap-3 rs-items-center rs-flex-wrap">
          <button className="rs-btn-primary" onClick={() => setActiveTab('log')}>
            <span className="material-symbols-rounded">edit_note</span>
            <span className="rs-speak-actions-label">LOG SERVICE</span>
          </button>
          <button className="rs-pill" onClick={() => setIsUpdatingOdo(true)}>
            <span className="material-symbols-rounded">speed</span>
            <span className="rs-speak-actions-label">UPDATE ODOMETER</span>
          </button>
          <button className="rs-pill is-active" onClick={() => setShowAskRiver(true)}>
            <span className="material-symbols-rounded">psychology</span>
            <span className="rs-speak-actions-label">ASK RIVER</span>
          </button>
        </div>
      </div>
    );
    return () => setAction(null);
  }, [setAction]);

  if (!currentVehicle) {
    return (
      <div className="rs-foyer rs-mode-workshop">
        <button className="rs-pill" onClick={onBack}>
          <span className="material-symbols-rounded">arrow_back</span>
          <span>HANGAR</span>
        </button>
        <div className="mp-empty-specs rs-mt-6">No vehicle telemetry detected.</div>
      </div>
    );
  }

  const hasSchedule = typeof currentMilestone === 'number';
  const odoDelta = hasSchedule ? currentOdometer - currentMilestone : 0;
  const isOverdue = hasSchedule && currentOdometer > 0 && odoDelta >= 0;

  const TABS = [
    { id: 'walkthrough', icon: 'route', label: 'WALKTHROUGH' },
    { id: 'log', icon: 'add_task', label: 'LOG SERVICE' },
    { id: 'specs', icon: 'tune', label: 'SPECS & CHECKPOINTS' },
    { id: 'history', icon: 'history', label: 'HISTORY' },
    { id: 'dossier', icon: 'description', label: 'DOCUMENTS' },
    { id: 'settings', icon: 'group', label: 'SETTINGS & CREW' },
  ];

  return (
    <div className="rs-foyer rs-mode-workshop animate-page-in">
      {/* Cockpit Header: Back to Hangar + Vehicle Title + Dropdown Switcher + Details Button */}
      <div className="rs-foyer-head rs-flex rs-justify-between rs-items-center rs-flex-wrap rs-gap-4 rs-mb-5">
        <div className="rs-flex rs-items-center rs-gap-3">
          <button className="rs-pill" onClick={onBack} title="Back to Hangar Overview">
            <span className="material-symbols-rounded">arrow_back</span>
            <span>HANGAR</span>
          </button>
          <span className="rs-header-sep" style={{ opacity: 0.3 }}>/</span>
          <h1 className="rs-greeting rs-m-0" style={{ fontSize: 'clamp(1.4rem, 2.5vw, 1.85rem)' }}>
            {currentVehicle.nickname || `${currentVehicle.make} ${currentVehicle.model}`}
          </h1>
        </div>

        {/* Quick Vehicle Switcher & Details Drawer Toggle */}
        <div className="rs-flex rs-items-center rs-gap-3 rs-flex-wrap">
          <div className="rs-vehicle-select-box">
            <select
              className="rs-vehicle-select-dropdown"
              value={currentVehicle.id}
              onChange={(e) => {
                setSelectedId(e.target.value);
                if (onVehicleChange) onVehicleChange(e.target.value);
              }}
            >
              {vehicles.map(v => (
                <option key={v.id} value={v.id} style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>
                  {v.nickname || `${v.year || ''} ${v.make} ${v.model}`}
                </option>
              ))}
            </select>
            <span className="material-symbols-rounded" style={{ position: 'absolute', right: 12, pointerEvents: 'none', color: 'var(--primary)' }}>
              arrow_drop_down
            </span>
          </div>

          <button
            className={`rs-pill ${showDetailsDrawer ? 'is-active' : ''}`}
            onClick={() => setShowDetailsDrawer(!showDetailsDrawer)}
            title="Edit vehicle specifications, trim, and VIN"
          >
            <span className="material-symbols-rounded">edit</span>
            <span className="rs-speak-actions-label">DETAILS</span>
          </button>
        </div>
      </div>

      {/* Inline Vehicle Details Drawer (toggled by DETAILS button) */}
      {showDetailsDrawer && (
        <div className="rs-card is-wide is-elev rs-mb-5" style={{ borderTop: '2px solid var(--primary)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-head rs-mb-4 rs-flex rs-justify-between rs-items-center">
              <span className="rs-card-label" style={{ color: 'var(--primary)' }}>&gt; VEHICLE SPECIFICATIONS &amp; HARDWARE TELEMETRY</span>
              <button className="rs-pill" onClick={() => setShowDetailsDrawer(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveVehicleDetails}>
              <div className="rs-gap-4 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">MAKE</span>
                  <input className="cockpit-input-raw" value={editForm.make} onChange={e => setEditForm({ ...editForm, make: e.target.value })} required />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">MODEL</span>
                  <input className="cockpit-input-raw" value={editForm.model} onChange={e => setEditForm({ ...editForm, model: e.target.value })} required />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">YEAR</span>
                  <input className="cockpit-input-raw" type="number" value={editForm.year} onChange={e => setEditForm({ ...editForm, year: e.target.value })} />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">TRIM</span>
                  <input className="cockpit-input-raw" value={editForm.trim} onChange={e => setEditForm({ ...editForm, trim: e.target.value })} />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">NICKNAME</span>
                  <input className="cockpit-input-raw" value={editForm.nickname} onChange={e => setEditForm({ ...editForm, nickname: e.target.value })} />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">TYPE</span>
                  <select
                    className="cockpit-input-raw"
                    value={editForm.vehicle_type}
                    onChange={e => setEditForm({ ...editForm, vehicle_type: e.target.value })}
                  >
                    <option value="moto" style={{ background: 'var(--bg-base)' }}>Motorcycle</option>
                    <option value="auto" style={{ background: 'var(--bg-base)' }}>Automobile</option>
                    <option value="truck" style={{ background: 'var(--bg-base)' }}>Truck</option>
                    <option value="atv" style={{ background: 'var(--bg-base)' }}>ATV / UTV</option>
                    <option value="other" style={{ background: 'var(--bg-base)' }}>Other</option>
                  </select>
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">COLORWAY</span>
                  <input className="cockpit-input-raw" value={editForm.color} onChange={e => setEditForm({ ...editForm, color: e.target.value })} />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">VIN</span>
                  <input className="cockpit-input-raw" value={editForm.vin} onChange={e => setEditForm({ ...editForm, vin: e.target.value })} />
                </div>
              </div>

              <div className="rs-flex rs-justify-between rs-items-center" style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button type="button" className="rs-pill btn-danger" onClick={handleDeleteVehicle}>
                  DELETE VEHICLE
                </button>
                <div className="rs-flex rs-gap-3">
                  <button type="button" className="rs-pill" onClick={() => setShowDetailsDrawer(false)}>CANCEL</button>
                  <button type="submit" className="rs-btn-primary" disabled={savingDetails}>
                    {savingDetails ? 'SAVING...' : 'SAVE CHANGES'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Odometer Telemetry Banner */}
      <div className="cockpit-odometer-banner">
        <div className="odometer-left-block">
          <div className="vehicle-icon-badge" style={{ width: 64, height: 64 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2.4rem' }}>
              {currentVehicle.vehicle_type === 'moto' ? 'motorcycle' : 'directions_car'}
            </span>
          </div>
          <div className="odometer-stat-display">
            <span className="card-metric-label">CERTIFIED ODOMETER</span>
            <div className="odometer-stat-num">
              {currentOdometer > 0 ? currentOdometer.toLocaleString() : '0'}
              <span className="odometer-stat-unit">{unitLabel}</span>
            </div>
          </div>
        </div>

        {/* Delta & Inline Update */}
        <div className="rs-flex rs-items-center rs-gap-4 rs-flex-wrap">
          <div className={`odometer-delta-badge ${isOverdue ? 'is-due' : 'is-nominal'}`}>
            <span className="rs-status-dot" style={{ background: isOverdue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }} />
            <span>
              {currentOdometer === 0
                ? 'ODOMETER NOT INITIALIZED'
                : !hasSchedule
                  ? 'NO SERVICE SCHEDULE SET'
                  : isOverdue
                    ? `${Math.abs(odoDelta).toLocaleString()} ${unitLabel} OVERDUE`
                    : `${Math.abs(odoDelta).toLocaleString()} ${unitLabel} TO NEXT INTERVAL`}
            </span>
          </div>

          {!isUpdatingOdo ? (
            <button className="rs-pill" onClick={() => setIsUpdatingOdo(true)}>
              <span className="material-symbols-rounded">speed</span>
              <span>UPDATE ODOMETER</span>
            </button>
          ) : (
            <div className="rs-flex rs-items-center rs-gap-2">
              <input
                className="cockpit-input-raw"
                type="number"
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--primary)',
                  borderRadius: 8,
                  padding: '6px 12px',
                  width: 120
                }}
                value={newOdoInput}
                onChange={e => setNewOdoInput(e.target.value)}
                placeholder="miles"
                autoFocus
              />
              <button className="rs-btn-primary" onClick={handleSaveOdometer} disabled={odoSaving}>
                {odoSaving ? '...' : 'SAVE'}
              </button>
              <button className="rs-pill" onClick={() => setIsUpdatingOdo(false)}>✕</button>
            </div>
          )}
        </div>
      </div>

      {/* Pill Navigation Tabs Deck */}
      <div className="hangar-tabs-deck">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`hangar-tab-pill ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="material-symbols-rounded">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* =====================================================================
          TAB 1: INTELLIGENT MILEAGE WALKTHROUGH
          ===================================================================== */}
      {activeTab === 'walkthrough' && (
        <div className="animate-page-in">
          {/* Active Service Scope Header */}
          <div className="service-scope-card">
            <div className="service-scope-header">
              <div className="service-scope-title">
                <span className="material-symbols-rounded" style={{ color: 'var(--primary)' }}>precision_manufacturing</span>
                <span>
                  {selectedMilestone === 'all'
                    ? 'ALL CONFIGURED PROCEDURES'
                    : hasSchedule || typeof selectedMilestone === 'number'
                      ? `${(selectedMilestone ?? currentMilestone).toLocaleString()}-${unitLabel === 'HRS' ? 'HOUR' : 'MILE'} SCHEDULED INTERVAL`
                      : 'NO SCHEDULED INTERVAL'}
                </span>
              </div>
              <span
                className="rs-status-strip"
                style={isOverdue ? {
                  color: 'var(--rs-status-critical, #ff8b8b)',
                  borderColor: 'rgba(255,139,139,0.3)',
                  background: 'rgba(255,139,139,0.1)'
                } : {
                  color: 'var(--rs-status-nominal, #4ade80)',
                  borderColor: 'rgba(74,222,128,0.3)',
                  background: 'rgba(74,222,128,0.1)'
                }}
              >
                <span className="rs-status-dot" style={{ background: isOverdue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }} />
                <span>{isOverdue ? `ACTION REQUIRED (${Math.abs(odoDelta).toLocaleString()} ${unitLabel} OVERDUE)` : 'UPCOMING'}</span>
              </span>
            </div>
            <div className="service-scope-desc">
              Triage scoped specifically for current vehicle wear. Only mandatory checks for this interval are staged below. Long-term checkpoints are automatically deferred.
            </div>

            {/* Interval Milestones Filter Chips */}
            <div className="interval-chips-bar">
              {milestones.map(m => (
                <button
                  key={m}
                  className={`interval-chip ${(selectedMilestone || currentMilestone) === m ? 'is-active' : ''} ${currentOdometer > 0 && currentOdometer >= m ? 'is-overdue' : ''}`}
                  onClick={() => setSelectedMilestone(m)}
                >
                  {m.toLocaleString()} {unitLabel}
                </button>
              ))}
              <button
                className={`interval-chip ${selectedMilestone === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedMilestone('all')}
              >
                VIEW ALL ({(currentVehicle?.check_points || []).length})
              </button>
            </div>
          </div>

          {/* Staged Required Supplies & Torque Specs */}
          <div className="rs-gap-4 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {/* Required Fluids & Parts */}
            <div className="staging-card">
              <div className="staging-card-head">
                <span className="material-symbols-rounded" style={{ color: 'var(--primary)' }}>inventory_2</span>
                <span className="card-metric-label">STAGED SUPPLIES &amp; PARTS</span>
              </div>
              {stagedProvisions.length === 0 ? (
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--md-on-surface-variant)', fontStyle: 'italic' }}>
                  No replacement fluids or parts specified for this interval.
                </div>
              ) : (
                <div className="staging-tags-flow">
                  {stagedProvisions.map((item, idx) => (
                    <span key={idx} className="staging-chip">
                      <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>check</span>
                      <span>{item}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Torque Values */}
            <div className="staging-card">
              <div className="staging-card-head">
                <span className="material-symbols-rounded" style={{ color: 'var(--rs-status-warning, #facc15)' }}>settings_suggest</span>
                <span className="card-metric-label">FASTENER TORQUE SPECS</span>
              </div>
              {fastenerTorques.length === 0 ? (
                <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--md-on-surface-variant)', fontStyle: 'italic' }}>
                  No fastener torque requirements specified.
                </div>
              ) : (
                <div className="staging-tags-flow">
                  {fastenerTorques.map((t, idx) => (
                    <span key={idx} className="staging-chip" style={{ color: 'var(--rs-status-warning, #facc15)', borderColor: 'rgba(250, 204, 21, 0.3)' }}>
                      <strong>{t.item}:</strong> {t.ft_lb ? `${t.ft_lb} ft-lb` : ''}{t.ft_lb && t.nm ? ' / ' : ''}{t.nm ? `${t.nm} N·m` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active Maintenance Checkpoints */}
          <div className="rs-flex rs-justify-between rs-items-center rs-mb-3">
            <span className="card-metric-label" style={{ fontSize: 'var(--rs-fs-micro)', letterSpacing: '0.12em' }}>
              ACTIVE PROCEDURES FOR THIS INTERVAL ({activeProcedures.length})
            </span>
            <button className="rs-btn-primary" onClick={handleStartIntervalInLog}>
              <span className="material-symbols-rounded">edit_calendar</span>
              <span>START / LOG THIS INTERVAL</span>
            </button>
          </div>

          {activeProcedures.length === 0 ? (
            <div className="mp-empty-specs">No procedures scheduled for this interval.</div>
          ) : (
            <div className="checklist-cards-grid">
              {activeProcedures.map(cp => {
                const st = checkStatuses[cp.id] || 'nominal';
                return (
                  <div key={cp.id} className="cockpit-item-card">
                    <div className="rs-flex rs-justify-between rs-items-start rs-gap-3">
                      <div className="rs-flex rs-items-center rs-gap-3">
                        <button
                          className="rs-pill is-active rs-flex rs-items-center rs-justify-center"
                          style={{ minWidth: 32, height: 32, padding: 0 }}
                          onClick={() => {
                            setCheckStatuses(prev => ({
                              ...prev,
                              [cp.id]: prev[cp.id] === 'nominal' ? 'skip' : 'nominal'
                            }));
                          }}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>
                            {st === 'nominal' ? 'check' : 'close'}
                          </span>
                        </button>
                        <div>
                          <div style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)' }}>{cp.description}</div>
                          <div style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--md-on-surface-variant)', marginTop: 2 }}>
                            {cp.expected_spec ? `Spec: ${cp.expected_spec}` : ''} {cp.volume ? `· ${cp.volume}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="cp-svc-badge">{cp.service_level || 'INSPECT'}</span>
                    </div>

                    {(cp.min_value != null || cp.unit) && (
                      <div className="rs-mt-3 rs-flex rs-items-center rs-gap-2">
                        <span style={{ fontSize: 'var(--rs-fs-micro)', color: 'var(--md-on-surface-variant)' }}>Measured:</span>
                        <input
                          className="cockpit-input-raw"
                          style={{ maxWidth: 140, padding: '4px 8px', fontSize: 'var(--rs-fs-tiny)', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}
                          placeholder={cp.unit ? `e.g. 32 ${cp.unit}` : 'Actual value'}
                          value={actualValues[cp.id] || ''}
                          onChange={e => setActualValues({ ...actualValues, [cp.id]: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 2: LOG SERVICE (Clean, Dynamic, Editable Odometer, DIY/Pro)
          ===================================================================== */}
      {activeTab === 'log' && (
        <div className="mp-log-form animate-page-in">
          <div className="rs-flex rs-justify-between rs-items-center rs-mb-5">
            <h3 className="rs-m-0 rs-flex rs-items-center rs-gap-3" style={{ color: 'var(--primary)' }}>
              <span className="material-symbols-rounded">edit_calendar</span>
              <span>LOG VEHICLE MAINTENANCE</span>
            </h3>
            {/* Mode Switcher */}
            <div className="rs-flex rs-gap-2">
              <button
                type="button"
                className={`rs-pill ${!logForm.is_pro_service ? 'is-active' : ''}`}
                onClick={() => setLogForm({ ...logForm, is_pro_service: false })}
              >
                DIY / WORKSHOP
              </button>
              <button
                type="button"
                className={`rs-pill ${logForm.is_pro_service ? 'is-active' : ''}`}
                onClick={() => setLogForm({ ...logForm, is_pro_service: true })}
              >
                PRO SERVICE
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmitServiceLog}>
            <div className="rs-gap-4 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div className="cockpit-input-box">
                <span className="card-metric-label">SERVICE TYPE / PROCEDURE *</span>
                <input
                  className="cockpit-input-raw"
                  placeholder="e.g. Engine Oil & Filter Change"
                  value={logForm.service_type}
                  onChange={e => setLogForm({ ...logForm, service_type: e.target.value })}
                  required
                />
              </div>
              <div className="cockpit-input-box">
                <span className="card-metric-label">ODOMETER ({isNonRoad ? 'HOURS' : 'MILES'}) *</span>
                <input
                  className="cockpit-input-raw"
                  type="number"
                  placeholder="e.g. 4000"
                  value={logForm.odometer}
                  onChange={e => setLogForm({ ...logForm, odometer: e.target.value })}
                  required
                />
              </div>
              <div className="cockpit-input-box">
                <span className="card-metric-label">SERVICE DATE</span>
                <input
                  className="cockpit-input-raw"
                  type="date"
                  value={logForm.service_date}
                  onChange={e => setLogForm({ ...logForm, service_date: e.target.value })}
                />
              </div>
              <div className="cockpit-input-box">
                <span className="card-metric-label">PERFORMED BY</span>
                <select
                  className="cockpit-input-raw"
                  value={logForm.performed_by_id}
                  onChange={e => setLogForm({ ...logForm, performed_by_id: e.target.value })}
                >
                  <option value="">— Primary Owner / Self —</option>
                  {vehicleAssignments.map(a => (
                    <option key={a.person_id} value={a.person_id} style={{ background: 'var(--bg-base)' }}>
                      {a.person_display_name || a.person_email}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Pro Service Specific Fields */}
            {logForm.is_pro_service && (
              <div className="rs-gap-4 rs-mb-5 rs-p-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">SERVICE FACILITY / DEALER</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. Certified Dealership, Local Shop"
                    value={logForm.service_center}
                    onChange={e => setLogForm({ ...logForm, service_center: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">TOTAL COST ($)</span>
                  <input
                    className="cockpit-input-raw"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={logForm.cost}
                    onChange={e => setLogForm({ ...logForm, cost: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">RECEIPT / INVOICE ATTACHMENT</span>
                  <input
                    className="cockpit-input-raw"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setLogForm({ ...logForm, receipt_file: e.target.files?.[0] || null })}
                  />
                </div>
              </div>
            )}

            {/* DIY Mode: Checkpoints Checklist */}
            {!logForm.is_pro_service && (currentVehicle?.check_points || []).length > 0 && (
              <div className="rs-mb-5">
                <div className="rs-flex rs-justify-between rs-items-center rs-mb-3">
                  <span className="card-metric-label">CHECKPOINTS COMPLETED IN THIS EVENT</span>
                  <button
                    type="button"
                    className="rs-pill"
                    onClick={() => {
                      const allDone = {};
                      (currentVehicle.check_points || []).forEach(cp => { allDone[cp.id] = 'done'; });
                      setLogCheckedPoints(allDone);
                    }}
                  >
                    SELECT ALL
                  </button>
                </div>
                <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {(currentVehicle.check_points || []).map(cp => {
                    const isDone = logCheckedPoints[cp.id] === 'done';
                    return (
                      <div
                        key={cp.id}
                        className={`cockpit-item-card ${isDone ? 'is-selected' : ''}`}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderColor: isDone ? 'var(--primary)' : 'rgba(255,255,255,0.08)' }}
                        onClick={() => {
                          setLogCheckedPoints(prev => ({
                            ...prev,
                            [cp.id]: prev[cp.id] === 'done' ? undefined : 'done'
                          }));
                        }}
                      >
                        <div className="rs-flex rs-items-center rs-gap-3">
                          <span className="material-symbols-rounded" style={{ color: isDone ? 'var(--primary)' : 'var(--md-on-surface-variant)' }}>
                            {isDone ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                          <span style={{ fontSize: 'var(--rs-fs-small)', color: 'var(--fg)', fontWeight: isDone ? 700 : 500 }}>{cp.description}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Generic Observations and Notes */}
            <div className="cockpit-input-box rs-mb-5">
              <span className="card-metric-label">PROCEDURAL NOTES / OBSERVATIONS</span>
              <textarea
                className="cockpit-input-raw"
                rows="3"
                placeholder="Service notes, parts replaced, torque verified, observations..."
                value={logForm.notes}
                onChange={e => setLogForm({ ...logForm, notes: e.target.value })}
              />
            </div>

            <div className="rs-flex rs-gap-3" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="rs-pill" onClick={() => setActiveTab('walkthrough')}>CANCEL</button>
              <button type="submit" className="rs-btn-primary" disabled={submittingLog}>
                <span className="material-symbols-rounded">save</span>
                <span>{submittingLog ? 'SAVING RECORD...' : 'COMMIT SERVICE ENTRY'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          TAB 3: SPECS & CHECKPOINTS MASTER ROSTER
          ===================================================================== */}
      {activeTab === 'specs' && (
        <div className="animate-page-in">
          <SpecsEditor
            vehicle={currentVehicle}
            token={token}
            onUpdated={onRefreshVehicles}
            isNonRoad={isNonRoad}
          />
        </div>
      )}

      {/* =====================================================================
          TAB 4: SERVICE HISTORY ARCHIVE
          ===================================================================== */}
      {activeTab === 'history' && (
        <div className="animate-page-in">
          {loadingLogs ? (
            <div className="mp-empty-specs">FETCHING SERVICE ARCHIVES...</div>
          ) : logs.length === 0 ? (
            <div className="mp-empty-specs">No previous service logs recorded for this vehicle.</div>
          ) : (
            <div className="mp-history-list">
              {logs.map(log => (
                <div key={log.id} className="mp-history-card">
                  <div className="rs-flex rs-justify-between rs-items-center">
                    <span style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 800, color: 'var(--fg)' }}>{log.service_type || 'Maintenance'}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-tiny)', color: 'var(--primary)' }}>
                      {log.service_date ? new Date(log.service_date).toLocaleDateString() : ''}
                    </span>
                  </div>

                  <div className="rs-flex rs-gap-4 rs-flex-wrap" style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--md-on-surface-variant)' }}>
                    <span>Odometer: <strong>{log.odometer != null ? `${log.odometer.toLocaleString()} ${unitLabel.toLowerCase()}` : '—'}</strong></span>
                    <span>Facility: <strong>{log.service_center || 'Personal Hangar'}</strong></span>
                    {log.cost != null && <span>Cost: <strong>${Number(log.cost).toFixed(2)}</strong></span>}
                    {log.performed_by && <span>By: <strong>{log.performed_by.display_name || log.performed_by.email}</strong></span>}
                  </div>

                  {log.notes && (
                    <div style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--fg)', opacity: 0.9 }}>
                      {log.notes}
                    </div>
                  )}

                  {log.check_results?.length > 0 && (
                    <div className="rs-flex rs-gap-2 rs-flex-wrap rs-mt-2">
                      {log.check_results.map(cr => {
                        const failed = cr.passed === false || cr.status === 'fail';
                        return (
                          <span
                            key={cr.id}
                            className="cp-spec-tag"
                            style={failed ? { color: 'var(--rs-status-critical, #ff8b8b)', borderColor: 'rgba(255,139,139,0.35)' } : undefined}
                          >
                            {failed ? '✕' : '✓'} {cr.description} {cr.actual_value ? `(${cr.actual_value})` : ''}
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

      {/* =====================================================================
          TAB 5: DOCUMENTS & DOSSIER (RAG)
          ===================================================================== */}
      {activeTab === 'dossier' && (
        <div className="animate-page-in">
          <VehicleRAG
            token={token}
            vehicleId={currentVehicle.id}
            currentOdometer={currentOdometer}
            onUpdated={onRefreshVehicles}
          />
        </div>
      )}

      {/* =====================================================================
          TAB 6: CREW ROSTER & SETTINGS
          ===================================================================== */}
      {activeTab === 'settings' && (
        <div className="animate-page-in">
          <SettingsPanel
            token={token}
            vehicles={vehicles}
            people={people}
            selectedVehicleId={currentVehicle.id}
            onPeopleRefresh={() => { fetchPeople(); fetchVehicleAssignments(); }}
            onVehicleRefresh={onRefreshVehicles}
          />
        </div>
      )}

      {/* RAG Ask River Sheet */}
      {showAskRiver && (
        <Sheet open={showAskRiver} onClose={() => setShowAskRiver(false)} title={`River Song // ${currentVehicle.nickname || currentVehicle.model}`}>
          <div className="rs-flex rs-flex-col" style={{ height: '70vh' }}>
            <ChatInterface
              embedded={true}
              onClose={() => setShowAskRiver(false)}
              vehicleId={String(currentVehicle.id)}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}
