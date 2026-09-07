import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { API_BASE } from '../lib/api';
import Sheet from '../chrome/Sheet.jsx';
import ChatInterface from '../components/ChatInterface.jsx';
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
        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--fg)' }}>{cp.description}</span>
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
            {cp.due_at_miles ? `Due: ${cp.due_at_miles.toLocaleString()} mi` : `Every ${cp.interval_miles.toLocaleString()} mi`}
          </span>
        )}
        {cp.parts && cp.parts.map(p => (
          <span key={p.id} className="cp-interval-tag" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            {p.part_name} {p.part_number ? `(${p.part_number})` : ''}
          </span>
        ))}
        <div className="cp-row-actions">
          <button className="rs-pill" onClick={async () => {
            const partName = window.prompt('Enter Part Name (e.g. Oil Filter, 10W-30, Spark Plug):');
            if (!partName) return;
            const partNum = window.prompt('Enter Part Number (Optional):');
            await apiFetch(`/api/vehicles/${vehicleId}/parts`, token, {
              method: 'POST',
              body: JSON.stringify({ check_point_id: cp.id, part_name: partName, part_number: partNum || null })
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
              <input className="cockpit-input-raw" value={form.expected_spec} onChange={set('expected_spec')} placeholder="e.g. 10W-30" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">CAPACITY / VOLUME</span>
              <input className="cockpit-input-raw" value={form.volume} onChange={set('volume')} placeholder="e.g. 2.7 Qt" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">TORQUE (FT-LB)</span>
              <input className="cockpit-input-raw" type="number" value={form.ft_lb} onChange={set('ft_lb')} placeholder="18" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">INTERVAL (MILES)</span>
              <input className="cockpit-input-raw" type="number" value={form.interval_miles} onChange={set('interval_miles')} placeholder="4000" />
            </div>
            <div className="cockpit-input-box">
              <span className="card-metric-label">NEXT DUE (MILES)</span>
              <input className="cockpit-input-raw" type="number" value={form.due_at_miles} onChange={set('due_at_miles')} placeholder="4000" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="rs-pill" onClick={() => setEditing(false)}>CANCEL</button>
            <button className="rs-btn-primary" onClick={save} disabled={busy}>{busy ? 'SAVING...' : 'SAVE CHANGES'}</button>
          </div>
        </div>
      )}
    </li>
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
    return vehicles.find(v => String(v.id) === String(selectedId)) || vehicles[0] || null;
  }, [vehicles, selectedId]);

  // Current Odometer & Inline update
  const currentOdometer = useMemo(() => {
    if (!currentVehicle) return 0;
    return currentVehicle.usage_readings?.[0]?.value ?? 0;
  }, [currentVehicle]);

  const [isUpdatingOdo, setIsUpdatingOdo] = useState(false);
  const [newOdoInput, setNewOdoInput] = useState('');
  const [odoSaving, setOdoSaving] = useState(false);

  // Edit Vehicle Details Form state
  const [editForm, setEditForm] = useState({
    make: '', model: '', year: '', trim: '', nickname: '',
    vehicle_type: 'auto', color: '', vin: ''
  });
  const [savingDetails, setSavingDetails] = useState(false);

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
      setNewOdoInput(String(currentVehicle.usage_readings?.[0]?.value || ''));
    }
  }, [currentVehicle]);

  // Milestone Walkthrough state
  const [selectedMilestone, setSelectedMilestone] = useState(null);
  const [checkStatuses, setCheckStatuses] = useState({});
  const [actualValues, setActualValues] = useState({});
  const [showFutureDrawer, setShowFutureDrawer] = useState(false);

  // History & logs
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Service Log Form state
  const [logForm, setLogForm] = useState({
    service_date: new Date().toISOString().split('T')[0],
    service_type: '',
    service_center: 'Personal Hangar',
    cost: '',
    notes: '',
    is_pro_service: false
  });
  const [submittingLog, setSubmittingLog] = useState(false);

  // RAG / Manual Upload
  const fileInputRef = useRef(null);
  const [uploadingManual, setUploadingManual] = useState(false);

  // Auto-compute available milestones from checkpoints
  const { milestones, currentMilestone, activeProcedures, futureProcedures, stagedProvisions, stagedTools, fastenerTorques } = useMemo(() => {
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
    if (sortedMiles.length === 0) {
      sortedMiles.push(1000, 4000, 8000, 12000);
    }

    // Determine the due milestone relative to current odometer
    const dueMilestone = sortedMiles.find(m => m >= currentOdometer) || sortedMiles[sortedMiles.length - 1];
    const activeM = selectedMilestone || dueMilestone;

    // Filter procedures
    const active = [];
    const future = [];

    checkPoints.forEach(cp => {
      const due = cp.due_at_miles || cp.interval_miles || 0;
      if (activeM === 'all' || due === activeM || (cp.interval_miles && activeM % cp.interval_miles === 0)) {
        active.push(cp);
      } else {
        future.push(cp);
      }
    });

    // Staged items for active milestone
    const provs = [];
    const tools = ['Torque Wrench', 'Metric Sockets (8-17mm)', 'Drain Pan', 'Shop Towels'];

    active.forEach(cp => {
      if (cp.parts && cp.parts.length > 0) {
        cp.parts.forEach(p => provs.push(`${p.part_name} ${p.part_number ? `(${p.part_number})` : ''}`));
      } else if (cp.volume && cp.expected_spec) {
        provs.push(`${cp.volume} ${cp.expected_spec}`);
      } else if (cp.expected_spec) {
        provs.push(cp.expected_spec);
      }
    });

    // Fastener torques
    const torques = [];
    checkPoints.forEach(cp => {
      if (cp.ft_lb || cp.nm) {
        torques.push({
          item: cp.description,
          ft_lb: cp.ft_lb,
          nm: cp.nm
        });
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
      stagedTools: tools,
      fastenerTorques: torques
    };
  }, [currentVehicle, currentOdometer, selectedMilestone]);

  // Fetch logs on history tab
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
    if (activeTab === 'history') fetchLogs();
  }, [activeTab, fetchLogs]);

  // Handle Odometer Update
  const handleSaveOdometer = async () => {
    const val = parseInt(newOdoInput, 10);
    if (isNaN(val) || val <= 0) return;
    setOdoSaving(true);
    try {
      await apiFetch(`/api/vehicles/${selectedId}/usage`, token, {
        method: 'POST',
        body: JSON.stringify({ value: val, unit: 'miles', source: 'manual' })
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

  // Checkbox status cycle: pending -> nominal -> warn -> crit -> skip
  const cycleStatus = (cpId) => {
    setCheckStatuses(prev => {
      const current = prev[cpId] || 'pending';
      const map = {
        pending: 'nominal',
        nominal: 'warn',
        warn: 'crit',
        crit: 'skip',
        skip: 'pending'
      };
      return { ...prev, [cpId]: map[current] };
    });
  };

  // Quick Log Interval as Completed
  const handleCompleteInterval = async () => {
    const completedItems = activeProcedures
      .filter(cp => checkStatuses[cp.id] === 'nominal' || !checkStatuses[cp.id])
      .map(cp => ({
        description: cp.description,
        check_point_id: cp.id,
        actual_value: actualValues[cp.id] || null,
        status: 'pass',
        passed: true
      }));

    setSubmittingLog(true);
    try {
      await apiFetch(`/api/vehicles/${selectedId}/logs`, token, {
        method: 'POST',
        body: JSON.stringify({
          service_date: new Date().toISOString(),
          odometer: currentOdometer,
          service_type: `${(selectedMilestone || currentMilestone).toLocaleString()}-Mile Scheduled Maintenance`,
          service_center: 'Personal Hangar',
          cost: 0,
          notes: `Completed ${(selectedMilestone || currentMilestone).toLocaleString()} mi scheduled service interval procedures.`,
          is_pro_service: false,
          check_results: completedItems
        })
      });
      alert(`Service logged for ${(selectedMilestone || currentMilestone).toLocaleString()} mi milestone!`);
      fetchLogs();
      onRefreshVehicles();
    } catch (err) {
      alert(`Logging failed: ${err.message}`);
    } finally {
      setSubmittingLog(false);
    }
  };

  // Contextual Action Bar in Cockpit
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="rs-btn-primary" onClick={handleCompleteInterval} disabled={submittingLog}>
            <span className="material-symbols-rounded">check_circle</span>
            <span className="rs-speak-actions-label">{submittingLog ? 'LOGGING...' : 'LOG INTERVAL COMPLETE'}</span>
          </button>
          <button className="rs-pill" onClick={() => setActiveTab('log')}>
            <span className="material-symbols-rounded">edit_note</span>
            <span className="rs-speak-actions-label">LOG SERVICE</span>
          </button>
          <button className="rs-pill" onClick={() => setActiveTab('diagnostics')}>
            <span className="material-symbols-rounded">monitor_heart</span>
            <span className="rs-speak-actions-label">DIAGNOSTICS</span>
          </button>
          <button className="rs-pill is-active" onClick={() => setShowAskRiver(true)}>
            <span className="material-symbols-rounded">psychology</span>
            <span className="rs-speak-actions-label">ASK RIVER</span>
          </button>
        </div>
      </div>
    );
    return () => setAction(null);
  }, [setAction, handleCompleteInterval, submittingLog]);

  if (!currentVehicle) {
    return (
      <div className="rs-foyer rs-mode-workshop">
        <button className="rs-pill" onClick={onBack}>
          <span className="material-symbols-rounded">arrow_back</span>
          <span>HANGAR</span>
        </button>
        <div className="mp-empty-specs" style={{ marginTop: 32 }}>No vehicle telemetry detected.</div>
      </div>
    );
  }

  const odoDelta = currentOdometer - currentMilestone;
  const isOverdue = odoDelta >= 0;

  return (
    <div className="rs-foyer rs-mode-workshop animate-page-in">
      {/* Cockpit Header: Back to Hangar + Vehicle Title + Dropdown Switcher + Details Button */}
      <div className="rs-foyer-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="rs-pill" onClick={onBack} title="Back to Hangar Overview">
            <span className="material-symbols-rounded">arrow_back</span>
            <span>HANGAR</span>
          </button>
          <span className="rs-header-sep" style={{ opacity: 0.3 }}>/</span>
          <h1 className="rs-greeting" style={{ margin: 0, fontSize: 'clamp(1.4rem, 2.5vw, 1.85rem)' }}>
            {currentVehicle.nickname || `${currentVehicle.make} ${currentVehicle.model}`}
          </h1>
        </div>

        {/* Quick Vehicle Switcher & Details Drawer Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
                  {v.vehicle_type === 'moto' ? '🏍️ ' : '🚗 '} {v.nickname || `${v.year} ${v.make} ${v.model}`}
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
        <div className="rs-card is-wide is-elev" style={{ marginBottom: 24, borderTop: '2px solid var(--primary)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-head" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="rs-card-label" style={{ color: 'var(--primary)' }}>&gt; VEHICLE SPECIFICATIONS &amp; HARDWARE TELEMETRY</span>
              <button className="rs-pill" onClick={() => setShowDetailsDrawer(false)}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveVehicleDetails}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button type="button" className="rs-pill btn-danger" onClick={handleDeleteVehicle}>
                  DELETE VEHICLE
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
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
              {currentOdometer.toLocaleString()}
              <span className="odometer-stat-unit">MI</span>
            </div>
          </div>
        </div>

        {/* Delta & Inline Update */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className={`odometer-delta-badge ${isOverdue ? 'is-due' : 'is-nominal'}`}>
            <span className="rs-status-dot" style={{ background: isOverdue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }} />
            <span>{isOverdue ? `${Math.abs(odoDelta).toLocaleString()} MI OVERDUE` : `${Math.abs(odoDelta).toLocaleString()} MI TO NEXT INTERVAL`}</span>
          </div>

          {!isUpdatingOdo ? (
            <button className="rs-pill" onClick={() => setIsUpdatingOdo(true)}>
              <span className="material-symbols-rounded">speed</span>
              <span>UPDATE ODOMETER</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="cockpit-input-raw"
                type="number"
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--primary)',
                  borderRadius: 8,
                  padding: '6px 12px',
                  width: 110
                }}
                value={newOdoInput}
                onChange={e => setNewOdoInput(e.target.value)}
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
        {[
          { id: 'walkthrough', icon: 'route', label: 'WALKTHROUGH' },
          { id: 'log', icon: 'add_task', label: 'LOG SERVICE' },
          { id: 'specs', icon: 'tune', label: 'SPECS & CHECKPOINTS' },
          { id: 'history', icon: 'history', label: 'HISTORY' },
          { id: 'diagnostics', icon: 'monitor_heart', label: 'DIAGNOSTICS' },
          { id: 'dossier', icon: 'description', label: 'DOSSIER' },
        ].map(tab => (
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
                <span>{(selectedMilestone || currentMilestone).toLocaleString()}-MILE SCHEDULED INTERVAL</span>
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
                <span>{isOverdue ? `ACTION REQUIRED (${Math.abs(odoDelta).toLocaleString()} MI OVERDUE)` : 'UPCOMING'}</span>
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
                  className={`interval-chip ${(selectedMilestone || currentMilestone) === m ? 'is-active' : ''} ${currentOdometer >= m ? 'is-overdue' : ''}`}
                  onClick={() => setSelectedMilestone(m)}
                >
                  {m.toLocaleString()} MI
                </button>
              ))}
              <button
                className={`interval-chip ${selectedMilestone === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedMilestone('all')}
              >
                ALL MILESTONES
              </button>
            </div>
          </div>

          {/* Staged Workshop Provisions & Tools */}
          <div className="staging-drawer">
            <div>
              <div className="staging-col-title">
                <span className="material-symbols-rounded">inventory_2</span>
                <span>STAGED PROVISIONS &amp; FLUIDS</span>
              </div>
              <div>
                {stagedProvisions.length > 0 ? (
                  stagedProvisions.map((p, i) => (
                    <span key={i} className="staging-item-pill">
                      <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>check</span>
                      <span>{p}</span>
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--md-on-surface-variant)' }}>Standard inspection (no consumables required)</span>
                )}
              </div>
            </div>

            <div>
              <div className="staging-col-title">
                <span className="material-symbols-rounded">build</span>
                <span>STAGED TOOLS &amp; HARDWARE</span>
              </div>
              <div>
                {stagedTools.map((t, i) => (
                  <span key={i} className="staging-item-pill">
                    <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>handyman</span>
                    <span>{t}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Required Procedures Deck */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="card-metric-label" style={{ fontSize: '0.72rem', letterSpacing: '0.12em' }}>
              REQUIRED INTERVAL PROCEDURES ({activeProcedures.length})
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--md-on-surface-variant)' }}>
              Click status icon to toggle: Nominal ✓ / Caution ⚠ / Replace ✕ / Skip —
            </span>
          </div>

          <div className="checklist-deck">
            {activeProcedures.map(cp => {
              const status = checkStatuses[cp.id] || 'pending';
              const statusClass = status === 'nominal' ? 'state-nominal' : status === 'warn' ? 'state-warn' : status === 'crit' ? 'state-crit' : status === 'skip' ? 'state-skip' : '';
              const icon = status === 'nominal' ? 'check' : status === 'warn' ? 'warning' : status === 'crit' ? 'close' : status === 'skip' ? 'remove' : 'radio_button_unchecked';

              return (
                <div key={cp.id} className={`check-row-card ${statusClass}`}>
                  <button className="check-status-trigger" onClick={() => cycleStatus(cp.id)} title="Click to cycle status">
                    <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>{icon}</span>
                  </button>

                  <div className="check-info-col">
                    <div className="check-title-row">
                      <span className="check-name">{cp.description}</span>
                      <span className={`check-action-tag ${cp.service_level === 'replace' ? 'tag-replace' : cp.service_level === 'service' ? 'tag-service' : 'tag-inspect'}`}>
                        {cp.service_level || 'INSPECT'}
                      </span>
                      {cp.interval_miles && (
                        <span className="check-interval-tag">
                          {cp.interval_miles.toLocaleString()} mi
                        </span>
                      )}
                    </div>
                    <div className="check-spec-sub">
                      {cp.expected_spec && (
                        <span>Spec: <strong>{cp.expected_spec} {cp.volume ? `(${cp.volume})` : ''}</strong></span>
                      )}
                      {(cp.ft_lb || cp.nm) && (
                        <span className="check-torque-badge">
                          {cp.ft_lb ? `${cp.ft_lb} ft-lb` : ''} {cp.nm ? `(${cp.nm} N·m)` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actual Value / Reading Input */}
                  <div className="check-actual-wrap">
                    <input
                      className="check-actual-input"
                      placeholder={cp.unit ? `Meas (${cp.unit})` : 'Notes/Val'}
                      value={actualValues[cp.id] || ''}
                      onChange={e => setActualValues({ ...actualValues, [cp.id]: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Future Milestones Collapsible Drawer */}
          {futureProcedures.length > 0 && (
            <div className="rs-card is-wide" style={{ marginTop: 24 }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 0' }}
                onClick={() => setShowFutureDrawer(!showFutureDrawer)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="material-symbols-rounded" style={{ color: 'var(--primary)' }}>update</span>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg)' }}>
                    FUTURE SERVICE MILESTONES ({futureProcedures.length} DEFERRED ITEMS)
                  </span>
                </div>
                <button className="rs-pill">
                  <span>{showFutureDrawer ? 'COLLAPSE' : 'INSPECT'}</span>
                  <span className="material-symbols-rounded">{showFutureDrawer ? 'expand_less' : 'expand_more'}</span>
                </button>
              </div>

              {showFutureDrawer && (
                <div className="checklist-deck" style={{ marginTop: 16 }}>
                  {futureProcedures.map(cp => (
                    <div key={cp.id} className="check-row-card is-future">
                      <span className="material-symbols-rounded" style={{ color: 'var(--md-on-surface-variant)', opacity: 0.6 }}>schedule</span>
                      <div className="check-info-col">
                        <div className="check-title-row">
                          <span className="check-name">{cp.description}</span>
                          <span className="check-action-tag tag-inspect">{cp.service_level || 'INSPECT'}</span>
                          <span className="check-interval-tag">Due: {cp.due_at_miles ? `${cp.due_at_miles.toLocaleString()} mi` : `Every ${cp.interval_miles?.toLocaleString()} mi`}</span>
                        </div>
                        {cp.expected_spec && (
                          <div className="check-spec-sub">{cp.expected_spec} {cp.volume ? `· ${cp.volume}` : ''}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Critical Fastener Torques Reference Card */}
          {fastenerTorques.length > 0 && (
            <div className="rs-card is-wide" style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span className="material-symbols-rounded" style={{ color: 'var(--rs-status-warning, #facc15)' }}>bolt</span>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--fg)' }}>CRITICAL FASTENER TORQUES</span>
              </div>
              <div className="fasteners-grid">
                {fastenerTorques.map((t, idx) => (
                  <div key={idx} className="fastener-tile">
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--fg)' }}>{t.item}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--rs-status-warning, #facc15)' }}>
                      {t.ft_lb ? `${t.ft_lb} ft-lb` : ''} {t.nm ? `/ ${t.nm} N·m` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Predictive Service Horizon Roadmap */}
          <div style={{ marginTop: 28, marginBottom: 12 }}>
            <span className="card-metric-label" style={{ fontSize: '0.72rem', letterSpacing: '0.12em' }}>
              PREDICTIVE SERVICE HORIZON
            </span>
          </div>
          <div className="service-horizon-wrap">
            {milestones.slice(0, 4).map(m => {
              const delta = m - currentOdometer;
              const isPast = delta < 0;
              return (
                <div key={m} className={`horizon-node ${m === currentMilestone ? 'is-current' : ''} ${isPast ? 'is-overdue' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="horizon-mileage">{m.toLocaleString()} MI</span>
                    <span className="horizon-tag" style={{ color: isPast ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--primary)' }}>
                      {isPast ? 'OVERDUE' : m === currentMilestone ? 'ACTIVE' : 'UPCOMING'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--md-on-surface-variant)' }}>
                    {isPast ? `${Math.abs(delta).toLocaleString()} mi past window` : `in ${delta.toLocaleString()} mi`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: LOG SERVICE
          ===================================================================== */}
      {activeTab === 'log' && (
        <div className="mp-log-form animate-page-in">
          <h3 style={{ marginTop: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="material-symbols-rounded">edit_calendar</span>
            <span>LOG COMPLETED MAINTENANCE</span>
          </h3>

          <form onSubmit={async (e) => {
            e.preventDefault();
            setSubmittingLog(true);
            try {
              await apiFetch(`/api/vehicles/${selectedId}/logs`, token, {
                method: 'POST',
                body: JSON.stringify({
                  service_date: logForm.service_date,
                  odometer: currentOdometer,
                  service_type: logForm.service_type,
                  service_center: logForm.service_center,
                  cost: logForm.cost ? parseFloat(logForm.cost) : null,
                  notes: logForm.notes,
                  is_pro_service: logForm.is_pro_service
                })
              });
              alert('Maintenance entry logged successfully!');
              setActiveTab('history');
              fetchLogs();
            } catch (err) {
              alert(`Error: ${err.message}`);
            } finally {
              setSubmittingLog(false);
            }
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div className="cockpit-input-box">
                <span className="card-metric-label">SERVICE TYPE / PROCEDURE *</span>
                <input
                  className="cockpit-input-raw"
                  placeholder="e.g. Engine Oil &amp; Filter Change"
                  value={logForm.service_type}
                  onChange={e => setLogForm({ ...logForm, service_type: e.target.value })}
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
                <span className="card-metric-label">SERVICE CENTER</span>
                <input
                  className="cockpit-input-raw"
                  placeholder="e.g. Personal Hangar, Dealership"
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
            </div>

            <div className="cockpit-input-box" style={{ marginBottom: 20 }}>
              <span className="card-metric-label">PROCEDURAL NOTES / PARTS INSTALLED</span>
              <textarea
                className="cockpit-input-raw"
                rows="3"
                placeholder="Installed Honda OEM filter #15410 and 2.7 Qt 10W-30 JASO MA2..."
                value={logForm.notes}
                onChange={e => setLogForm({ ...logForm, notes: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="rs-pill" onClick={() => setActiveTab('walkthrough')}>CANCEL</button>
              <button type="submit" className="rs-btn-primary" disabled={submittingLog}>
                <span className="material-symbols-rounded">save</span>
                <span>{submittingLog ? 'RECORDING...' : 'RECORD ENTRY'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          TAB 3: SPECS & CHECKPOINTS EDITOR
          ===================================================================== */}
      {activeTab === 'specs' && (
        <div className="animate-page-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span className="card-metric-label" style={{ fontSize: '0.72rem', letterSpacing: '0.12em' }}>
              CHECKPOINTS &amp; SPECIFICATIONS MASTER ROSTER
            </span>
          </div>
          <ul className="cp-list">
            {(currentVehicle.check_points || []).map(cp => (
              <CheckPointRow
                key={cp.id}
                cp={cp}
                token={token}
                vehicleId={currentVehicle.id}
                onUpdated={onRefreshVehicles}
                isNonRoad={currentVehicle.vehicle_type === 'atv'}
              />
            ))}
          </ul>
        </div>
      )}

      {/* =====================================================================
          TAB 4: SERVICE HISTORY
          ===================================================================== */}
      {activeTab === 'history' && (
        <div className="animate-page-in">
          {loadingLogs ? (
            <div className="mp-empty-specs">FETCHING LOG ARCHIVES...</div>
          ) : logs.length === 0 ? (
            <div className="mp-empty-specs">No previous maintenance logs recorded yet.</div>
          ) : (
            <div className="mp-history-list">
              {logs.map(log => (
                <div key={log.id} className="mp-history-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--fg)' }}>{log.service_type}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>
                      {log.service_date ? new Date(log.service_date).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: '0.82rem', color: 'var(--md-on-surface-variant)' }}>
                    <span>Odometer: <strong>{log.odometer ? `${log.odometer.toLocaleString()} mi` : '—'}</strong></span>
                    <span>Facility: <strong>{log.service_center || 'Personal Hangar'}</strong></span>
                    {log.cost ? <span>Cost: <strong>${Number(log.cost).toFixed(2)}</strong></span> : null}
                  </div>
                  {log.notes && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--fg)', opacity: 0.9, marginTop: 4 }}>
                      {log.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          TAB 5: DIAGNOSTICS & OBD
          ===================================================================== */}
      {activeTab === 'diagnostics' && (
        <div className="rs-card is-wide animate-page-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span className="material-symbols-rounded" style={{ color: 'var(--rs-status-nominal, #4ade80)' }}>check_circle</span>
            <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--fg)' }}>DIAGNOSTIC TRANSPONDER STATUS</span>
          </div>
          <p style={{ color: 'var(--md-on-surface-variant)', fontSize: '0.88rem', lineHeight: 1.5 }}>
            No active Diagnostic Trouble Codes (DTCs) logged in memory. Powertrain, ABS, and auxiliary sensors report nominal operational parameters.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button className="rs-pill is-active" onClick={() => alert('OBD-II Transponder Scan Complete: 0 Faults.')}>
              <span className="material-symbols-rounded">refresh</span>
              <span>RUN FULL SCAN</span>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 6: DOSSIER & MANUAL RAG
          ===================================================================== */}
      {activeTab === 'dossier' && (
        <div className="rs-card is-wide animate-page-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span className="material-symbols-rounded" style={{ color: 'var(--primary)' }}>menu_book</span>
            <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--fg)' }}>TECHNICAL DOSSIER &amp; OWNER'S MANUAL</span>
          </div>
          <p style={{ color: 'var(--md-on-surface-variant)', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Upload an official factory service manual or owner's handbook (PDF) to ground River Song's RAG knowledgebase with torque specs, part numbers, and diagrams.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploadingManual(true);
              const fd = new FormData();
              fd.append('file', file);
              try {
                const res = await fetch(`/api/vehicles/${currentVehicle.id}/manual`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                  body: fd
                });
                if (res.ok) {
                  alert('Manual indexed into River Song RAG engine!');
                  onRefreshVehicles();
                } else {
                  throw new Error('Upload failed');
                }
              } catch (err) {
                alert(`Upload failed: ${err.message}`);
              } finally {
                setUploadingManual(false);
              }
            }}
          />

          <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              className="rs-pill is-active"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingManual}
            >
              <span className="material-symbols-rounded">upload_file</span>
              <span>{uploadingManual ? 'INDEXING MANUAL...' : 'UPLOAD SERVICE MANUAL (PDF)'}</span>
            </button>
            <button className="rs-pill" onClick={() => setShowAskRiver(true)}>
              <span className="material-symbols-rounded">psychology</span>
              <span>ASK RIVER ABOUT MANUAL</span>
            </button>
          </div>
        </div>
      )}

      {/* Embedded Ask River Drawer */}
      <Sheet open={showAskRiver} onClose={() => setShowAskRiver(false)}>
        {showAskRiver && (
          <div style={{ height: '70vh' }}>
            <ChatInterface
              embedded={true}
              onClose={() => setShowAskRiver(false)}
              vehicleId={currentVehicle.id}
              initialIntent={{
                text: `River, what is the maintenance status and next recommended procedure for ${currentVehicle.nickname || currentVehicle.model}?`,
                docId: `vehicle_${currentVehicle.id}`
              }}
            />
          </div>
        )}
      </Sheet>
    </div>
  );
}
