import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import './MaintenancePulse.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: authHeaders(token), ...opts });
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
          <label className="pulse-label">MAKE *</label>
          <input className="cyber-input" value={form.make} onChange={set('make')} placeholder="e.g. Honda" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">MODEL *</label>
          <input className="cyber-input" value={form.model} onChange={set('model')} placeholder="e.g. Rebel 500" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">YEAR</label>
          <input className="cyber-input num-input" type="number" value={form.year} onChange={set('year')} placeholder="2026" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">TRIM</label>
          <input className="cyber-input" value={form.trim} onChange={set('trim')} placeholder="e.g. SE" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">NICKNAME</label>
          <input className="cyber-input" value={form.nickname} onChange={set('nickname')} placeholder="e.g. The Rebel" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">TYPE</label>
          <select className="pulse-select cyber-input" value={form.vehicle_type} onChange={set('vehicle_type')}>
            <option value="auto">Automobile</option>
            <option value="moto">Motorcycle</option>
            <option value="truck">Truck</option>
            <option value="atv">ATV / UTV</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="pulse-field">
          <label className="pulse-label">COLOR</label>
          <input className="cyber-input" value={form.color} onChange={set('color')} placeholder="e.g. Matte Black" />
        </div>
        <div className="pulse-field">
          <label className="pulse-label">VIN</label>
          <input className="cyber-input" value={form.vin} onChange={set('vin')} placeholder="Optional" />
        </div>
      </div>
      <div className="vehicle-form-footer">
        <button className="cyber-btn" onClick={onCancel}>CANCEL</button>
        <button className="cyber-btn btn-save" onClick={handleSubmit}>{saveLabel || '>> SAVE'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Specs editor
// ---------------------------------------------------------------------------

function SpecsEditor({ vehicle, token, onUpdated }) {
  const [newFluid,  setNewFluid]  = useState({ name: '', spec: '', volume: '' });
  const [newTorque, setNewTorque] = useState({ name: '', ft_lb: '', nm: '' });
  const [newPoint,  setNewPoint]  = useState('');
  const [busy, setBusy] = useState(false);

  const withBusy = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  const addFluid = () => withBusy(async () => {
    if (!newFluid.name.trim()) return;
    await apiFetch(`/api/vehicles/${vehicle.id}/specs/fluids`, token, { method: 'POST', body: JSON.stringify(newFluid) });
    setNewFluid({ name: '', spec: '', volume: '' });
    onUpdated();
  });
  const delFluid = async (id) => { await apiFetch(`/api/vehicles/${vehicle.id}/specs/fluids/${id}`, token, { method: 'DELETE' }); onUpdated(); };

  const addTorque = () => withBusy(async () => {
    if (!newTorque.name.trim()) return;
    await apiFetch(`/api/vehicles/${vehicle.id}/specs/torques`, token, {
      method: 'POST',
      body: JSON.stringify({ name: newTorque.name, ft_lb: newTorque.ft_lb ? Number(newTorque.ft_lb) : null, nm: newTorque.nm ? Number(newTorque.nm) : null }),
    });
    setNewTorque({ name: '', ft_lb: '', nm: '' });
    onUpdated();
  });
  const delTorque = async (id) => { await apiFetch(`/api/vehicles/${vehicle.id}/specs/torques/${id}`, token, { method: 'DELETE' }); onUpdated(); };

  const addPoint = () => withBusy(async () => {
    if (!newPoint.trim()) return;
    await apiFetch(`/api/vehicles/${vehicle.id}/specs/checkpoints`, token, {
      method: 'POST',
      body: JSON.stringify({ description: newPoint, sort_order: vehicle.check_points.length }),
    });
    setNewPoint('');
    onUpdated();
  });
  const delPoint = async (id) => { await apiFetch(`/api/vehicles/${vehicle.id}/specs/checkpoints/${id}`, token, { method: 'DELETE' }); onUpdated(); };

  return (
    <div className="specs-editor">
      <div className="spec-section">
        <h4>[ FLUID SPECS ]</h4>
        <ul className="spec-edit-list">
          {vehicle.fluid_specs.map((f) => (
            <li key={f.id}>
              <span className="spec-name">{f.name}</span>
              <span className="spec-val">{f.spec}{f.volume ? ` (${f.volume})` : ''}</span>
              <button className="del-spec-btn" onClick={() => delFluid(f.id)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="spec-add-row">
          <input className="cyber-input" placeholder="Name" value={newFluid.name} onChange={(e) => setNewFluid(f => ({ ...f, name: e.target.value }))} />
          <input className="cyber-input" placeholder="Spec" value={newFluid.spec} onChange={(e) => setNewFluid(f => ({ ...f, spec: e.target.value }))} />
          <input className="cyber-input" placeholder="Volume" value={newFluid.volume} onChange={(e) => setNewFluid(f => ({ ...f, volume: e.target.value }))} />
          <button className="cyber-btn btn-xs" onClick={addFluid} disabled={busy}>+</button>
        </div>
      </div>

      <div className="spec-section">
        <h4>[ TORQUE VALUES ]</h4>
        <ul className="spec-edit-list">
          {vehicle.torque_specs.map((t) => (
            <li key={t.id}>
              <span className="spec-name">{t.name}</span>
              <span className="spec-val hl-warn">{t.ft_lb} Ft-Lb // {t.nm} N·m</span>
              <button className="del-spec-btn" onClick={() => delTorque(t.id)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="spec-add-row">
          <input className="cyber-input" placeholder="Name" value={newTorque.name} onChange={(e) => setNewTorque(f => ({ ...f, name: e.target.value }))} />
          <input className="cyber-input num-input" placeholder="Ft-Lb" value={newTorque.ft_lb} onChange={(e) => setNewTorque(f => ({ ...f, ft_lb: e.target.value }))} />
          <input className="cyber-input num-input" placeholder="N·m" value={newTorque.nm} onChange={(e) => setNewTorque(f => ({ ...f, nm: e.target.value }))} />
          <button className="cyber-btn btn-xs" onClick={addTorque} disabled={busy}>+</button>
        </div>
      </div>

      <div className="spec-section">
        <h4>[ INSPECTION POINTS ]</h4>
        <ul className="spec-edit-list">
          {vehicle.check_points.map((cp) => (
            <li key={cp.id}>
              <span className="spec-name" style={{ flex: 1 }}>{cp.description}</span>
              <button className="del-spec-btn" onClick={() => delPoint(cp.id)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="spec-add-row">
          <input className="cyber-input" style={{ flex: 1 }} placeholder="e.g. Tire Pressure (29F/29R PSI)"
            value={newPoint} onChange={(e) => setNewPoint(e.target.value)} />
          <button className="cyber-btn btn-xs" onClick={addPoint} disabled={busy}>+</button>
        </div>
      </div>
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
            <button className="cyber-btn btn-xs" onClick={() => setConfirmDelete(null)}>CANCEL</button>
            <button className="cyber-btn btn-xs btn-danger" onClick={() => handleRemove(confirmDelete, true)} disabled={busy}>
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
        <button className="cyber-btn btn-xs btn-save" onClick={handleAdd} disabled={busy || !emailInput.trim()}>
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
          {filtered.map((p) => (
            <li key={p.id} className="mp-person-item">
              <div className="mp-person-info">
                <span className="mp-person-name">{p.display_name || p.email}</span>
                <span className="mp-person-email">{p.display_name ? p.email : ''}</span>
                {p.vehicle_ids?.length > 0 && (
                  <span className="mp-person-tag">{p.vehicle_ids.length} vehicle{p.vehicle_ids.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              <button
                className="del-spec-btn"
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

  const assignedPersonIds = new Set(assignments.map((a) => a.person_id));
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
            <label className="pulse-label">SELECT VEHICLE</label>
            <select
              className="pulse-select cyber-input"
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
            >
              {vehicles.map((v) => (
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
                    {assignments.map((a) => (
                      <li key={a.person_id} className="mp-person-item mp-person-item--assigned">
                        <div className="mp-person-info">
                          <span className="mp-person-name">{a.person_display_name || a.person_email}</span>
                          <span className="mp-person-email">{a.person_display_name ? a.person_email : ''}</span>
                        </div>
                        <button
                          className="cyber-btn btn-xs btn-danger"
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
                    {unassigned.map((p) => (
                      <li key={p.id} className="mp-person-item">
                        <div className="mp-person-info">
                          <span className="mp-person-name">{p.display_name || p.email}</span>
                          <span className="mp-person-email">{p.display_name ? p.email : ''}</span>
                        </div>
                        <button
                          className="cyber-btn btn-xs btn-save"
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

function SettingsPanel({ token, vehicles, people, onPeopleRefresh }) {
  const [section, setSection] = useState('people');

  return (
    <div className="mp-settings-panel">
      <div className="mp-settings-tabs">
        <button
          className={`mp-settings-tab ${section === 'people' ? 'active' : ''}`}
          onClick={() => setSection('people')}
        >PEOPLE</button>
        <button
          className={`mp-settings-tab ${section === 'assignments' ? 'active' : ''}`}
          onClick={() => setSection('assignments')}
        >VEHICLE ASSIGNMENTS</button>
      </div>

      {section === 'people' && (
        <PeopleSettings token={token} people={people} onRefresh={onPeopleRefresh} />
      )}
      {section === 'assignments' && (
        <AssignmentsSettings
          token={token}
          vehicles={vehicles}
          people={people}
          onPeopleRefresh={onPeopleRefresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MaintenancePulse() {
  const { token } = useAuth();

  const [vehicles, setVehicles]     = useState([]);
  const [people, setPeople]         = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  const [formMode, setFormMode]     = useState('none'); // 'none' | 'add' | 'edit'
  const [view, setView]             = useState('log');  // 'log' | 'specs' | 'history' | 'settings'

  // log form state
  const [isProService, setIsProService]     = useState(false);
  const [serviceCenter, setServiceCenter]   = useState('');
  const [serviceType, setServiceType]       = useState('');
  const [mileage, setMileage]               = useState('');
  const [serviceDate, setServiceDate]       = useState(new Date().toISOString().split('T')[0]);
  const [performedById, setPerformedById]   = useState('');
  const [receiptFile, setReceiptFile]       = useState(null);
  const [checkedPoints, setCheckedPoints]   = useState({});
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

  const handlePointToggle = (idx) =>
    setCheckedPoints((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const handleSave = async () => {
    if (!currentVehicle) return;
    const checkResults = currentVehicle.check_points.map((cp, idx) => ({
      description: cp.description,
      passed: isProService ? true : !!checkedPoints[idx],
    }));
    const payload = {
      service_date:    new Date(serviceDate).toISOString(),
      odometer:        mileage ? Number(mileage) : null,
      is_pro_service:  isProService,
      service_center:  isProService ? serviceCenter : null,
      service_type:    serviceType || null,
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
        await fetch(`${API}/api/vehicles/logs/${log.id}/receipt`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }
      setSaveStatus('PULSE LOGGED // SYSTEM UPDATED');
      setTimeout(() => {
        setSaveStatus('');
        setCheckedPoints({});
        setMileage('');
        setServiceCenter('');
        setServiceType('');
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
      <div className="pulse-container glass-panel">
        <div className="pulse-header"><h2 className="pulse-title">MAINTENANCE PULSE</h2></div>
        <div className="mp-empty"><span style={{ color: 'var(--text-dim)' }}>LOADING GARAGE...</span></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pulse-container glass-panel">
        <div className="pulse-header"><h2 className="pulse-title">MAINTENANCE PULSE</h2></div>
        <div className="mp-error" style={{ margin: '20px 0' }}>BACKEND ERROR: {error}</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Empty garage
  // -------------------------------------------------------------------------

  if (vehicles.length === 0) {
    return (
      <div className="pulse-container glass-panel">
        <div className="pulse-header">
          <h2 className="pulse-title">MAINTENANCE PULSE</h2>
          <div className="pulse-status-indicator" data-status="idle" />
        </div>
        {formMode === 'add' ? (
          <>
            <h3 className="section-subtitle">&gt; ADD FIRST VEHICLE</h3>
            <VehicleForm onSave={handleAddVehicle} onCancel={() => setFormMode('none')} saveLabel=">> ADD VEHICLE" />
          </>
        ) : (
          <div className="mp-empty">
            <p style={{ color: 'var(--text-dim)', marginBottom: 4 }}>No vehicles in garage.</p>
            <button className="cyber-btn" onClick={() => setFormMode('add')}>+ ADD FIRST VEHICLE</button>
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
    { key: 'settings', label: 'SETTINGS' },
  ];

  return (
    <div className="pulse-container glass-panel">
      <div className="pulse-header">
        <h2 className="pulse-title">MAINTENANCE PULSE</h2>
        <div className="pulse-header-actions">
          {formMode === 'none' && (
            <button className="cyber-btn btn-xs" onClick={() => setFormMode('add')}>+ VEHICLE</button>
          )}
          <div className="pulse-status-indicator" data-status={saveStatus ? 'active' : 'idle'} />
        </div>
      </div>

      {/* ── Inline add form ── */}
      {formMode === 'add' && (
        <div className="pulse-inline-section">
          <h3 className="section-subtitle">&gt; ADD VEHICLE</h3>
          <VehicleForm onSave={handleAddVehicle} onCancel={() => setFormMode('none')} saveLabel=">> ADD VEHICLE" />
        </div>
      )}

      {/* ── Vehicle selector ── */}
      {formMode !== 'add' && (
        <div className="pulse-controls">
          <div className="pulse-field">
            <label className="pulse-label">TARGET VEHICLE</label>
            <div className="vehicle-selector-row">
              <select
                className="pulse-select cyber-input"
                value={selectedId || ''}
                onChange={(e) => { setSelectedId(e.target.value); setCheckedPoints({}); setFormMode('none'); }}
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.year ? `${v.year} ` : ''}{v.make} {v.model}{v.nickname ? ` "${v.nickname}"` : ''}
                  </option>
                ))}
              </select>
              <button className="cyber-btn btn-xs" onClick={() => setFormMode(formMode === 'edit' ? 'none' : 'edit')}>
                {formMode === 'edit' ? 'CANCEL' : 'EDIT'}
              </button>
              <button className="cyber-btn btn-xs btn-danger" onClick={handleDeleteVehicle}>DEL</button>
            </div>
          </div>

          {formMode === 'edit' && currentVehicle && (
            <div className="pulse-inline-section">
              <h3 className="section-subtitle">&gt; EDIT VEHICLE</h3>
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
              {VIEW_TABS.map((t) => (
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
        <div className="pulse-content animate-fade-in">

          {/* Performer selector */}
          {vehicleAssignments.length > 0 && (
            <div className="pulse-field" style={{ marginBottom: 14 }}>
              <label className="pulse-label">PERFORMED BY</label>
              <select
                className="pulse-select cyber-input"
                value={performedById}
                onChange={(e) => setPerformedById(e.target.value)}
              >
                <option value="">— Select person —</option>
                {vehicleAssignments.map((a) => (
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

          {/* Service type */}
          <div className="pulse-field" style={{ marginBottom: 14 }}>
            <label className="pulse-label">SERVICE TYPE</label>
            <input
              className="cyber-input"
              placeholder="e.g. Oil Change, Tire Rotation, Brake Service"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
            />
          </div>

          <label className="pulse-toggle" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={isProService} onChange={(e) => setIsProService(e.target.checked)} />
            <span className="toggle-slider"></span>
            <span className="toggle-text">PROFESSIONAL SERVICE PERFORMED</span>
          </label>

          {!isProService ? (
            <div className="inspection-mode animate-fade-in">
              <h3 className="section-subtitle">&gt; INSPECTION MODE // DIY</h3>
              {(currentVehicle.fluid_specs.length > 0 || currentVehicle.torque_specs.length > 0) && (
                <div className="specs-grid">
                  {currentVehicle.fluid_specs.length > 0 && (
                    <div className="spec-card">
                      <h4>[ FLUID SPECS ]</h4>
                      <ul>
                        {currentVehicle.fluid_specs.map((f) => (
                          <li key={f.id}>
                            <span className="spec-name">{f.name}</span>
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
                        {currentVehicle.torque_specs.map((t) => (
                          <li key={t.id}>
                            <span className="spec-name">{t.name}</span>
                            <span className="spec-val hl-warn">{t.ft_lb} Ft-Lb // {t.nm} N·m</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {currentVehicle.check_points.length > 0 ? (
                <div className="checklist-container">
                  <h4>[ INSPECTION CHECKLIST ]</h4>
                  <div className="checklist">
                    {currentVehicle.check_points.map((cp, idx) => (
                      <label key={cp.id} className="check-item">
                        <input type="checkbox" checked={!!checkedPoints[idx]} onChange={() => handlePointToggle(idx)} />
                        <span className="check-box-custom"></span>
                        <span className="check-label">{cp.description}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mp-empty-specs">
                  No specs configured yet. Go to <strong>EDIT SPECS</strong> to add fluids, torques, and checklist items.
                </div>
              )}
            </div>
          ) : (
            <div className="logging-mode animate-fade-in">
              <h3 className="section-subtitle">&gt; LOGGING MODE // PRO SERVICE</h3>
              <div className="form-grid">
                <div className="pulse-field">
                  <label className="pulse-label">SERVICE CENTER NAME</label>
                  <input type="text" className="cyber-input" placeholder="e.g. Honda Powersports"
                    value={serviceCenter} onChange={(e) => setServiceCenter(e.target.value)} />
                </div>
                <div className="pulse-field">
                  <label className="pulse-label">CURRENT MILEAGE</label>
                  <input type="number" className="cyber-input num-input" placeholder="0"
                    value={mileage} onChange={(e) => setMileage(e.target.value)} />
                </div>
                <div className="pulse-field">
                  <label className="pulse-label">SERVICE DATE</label>
                  <input type="date" className="cyber-input" value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)} />
                </div>
                <div className="pulse-field full-width">
                  <label className="pulse-label">RECEIPT UPLOAD (PDF/IMG)</label>
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
        <div className="pulse-content animate-fade-in">
          <h3 className="section-subtitle">&gt; SPECS EDITOR // {vehicleLabel.toUpperCase()}</h3>
          <SpecsEditor vehicle={currentVehicle} token={token} onUpdated={fetchVehicles} />
        </div>
      )}

      {/* ── HISTORY VIEW ── */}
      {formMode === 'none' && view === 'history' && (
        <div className="pulse-content animate-fade-in">
          <h3 className="section-subtitle">&gt; SERVICE HISTORY</h3>
          {logs.length === 0 ? (
            <div className="mp-empty-specs">No service logs yet for this vehicle.</div>
          ) : (
            <div className="history-list">
              {logs.map((log) => (
                <div key={log.id} className="history-entry">
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
                      {log.check_results.map((cr) => (
                        <span key={cr.id} className={`history-check ${cr.passed ? 'pass' : 'fail'}`}>
                          {cr.passed ? '✓' : '✗'} {cr.description}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS VIEW ── */}
      {formMode === 'none' && view === 'settings' && (
        <div className="pulse-content animate-fade-in">
          <SettingsPanel
            token={token}
            vehicles={vehicles}
            people={people}
            onPeopleRefresh={() => { fetchPeople(); fetchVehicleAssignments(); }}
          />
        </div>
      )}

      {/* ── Footer / Save (log view only) ── */}
      {formMode === 'none' && view === 'log' && (
        <div className="pulse-footer">
          <button
            className={`cyber-btn btn-save ${saveStatus.startsWith('ERROR') ? 'btn-error' : saveStatus ? 'btn-success' : ''}`}
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
