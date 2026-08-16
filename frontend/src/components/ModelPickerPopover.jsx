import React, { useState, useEffect, useMemo } from 'react';
import { providerLabel, PROVIDER_ORDER } from '../utils/providers';

/**
 * Formats a per-token cost as a dollar-per-thousand-tokens value.
 * @param {number|null|undefined} v - The cost per token.
 * @return {string|null} The formatted cost per 1K tokens, or `null` when no cost is provided.
 */
function fmtCost(v) {
  if (v == null) return null;
  return `$${(v * 1000).toFixed(2)}/M`;
}

/**
 * Render a selectable picker row with optional status and navigation indicators.
 * @param {Object} props - Row display and interaction properties.
 * @param {string} props.icon - Material Symbols icon name.
 * @param {string} props.title - Primary row label.
 * @param {string} [props.sub] - Secondary descriptive text.
 * @param {boolean} [props.active] - Whether the row represents the current selection.
 * @param {boolean} [props.disabled] - Whether the row is unavailable for selection.
 * @param {boolean} [props.chevron] - Whether to show a navigation chevron.
 * @param {string} [props.badge] - Optional badge text displayed beside the title.
 * @param {Function} [props.onClick] - Callback invoked when the row is selected.
 * @returns {JSX.Element} The picker row element.
 */
function MpopRow({ icon, title, sub, active, disabled, chevron, badge, onClick }) {
  return (
    <button
      className={`rs-mpop-row${active ? ' is-active' : ''}${disabled ? ' is-dimmed' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="material-symbols-rounded rs-mpop-icon">{icon}</span>
      <span className="rs-mpop-body">
        <span className="rs-mpop-title">
          {title}
          {badge && <span className="rs-mpop-badge">{badge}</span>}
        </span>
        {sub && <span className="rs-mpop-sub">{sub}</span>}
      </span>
      {active  && <span className="material-symbols-rounded rs-mpop-check">check</span>}
      {chevron && !active && <span className="material-symbols-rounded rs-mpop-chevron">chevron_right</span>}
    </button>
  );
}

function MpopBack({ label, onClick }) {
  return (
    <button className="rs-mpop-back" onClick={onClick}>
      <span className="material-symbols-rounded">arrow_back</span>
      {label}
    </button>
  );
}

/**
 * Renders the model-selection sheet.
 * @param {Object} props - Component properties.
 * @param {boolean} props.isOpen - Whether the picker is visible.
 * @param {Function} props.onClose - Called when the picker closes.
 * @param {Object} props.selectedModel - Currently selected model.
 * @param {Function} props.onSelect - Called with the selected provider and model ID.
 * @param {Array<Object>} [props.localModels=[]] - Available local models. Defaults to an empty array.
 * @param {Array<Object>} [props.nimModels=[]] - Available NVIDIA NIM models. Defaults to an empty array.
 * @param {Array<Object>} [props.cloudModels=[]] - Available cloud models. Defaults to an empty array.
 * @param {string[]} [props.providerOrder=[]] - Preferred order for cloud providers. Defaults to an empty array.
 * @param {boolean} [props.intentRouterEnabled=false] - Whether automatic model routing is enabled. Defaults to false.
 * @return {JSX.Element|null} The model picker, or null when closed.
 */
export default function ModelPickerPopover({
  isOpen,
  onClose,
  onBackToTools,
  selectedModel,
  onSelect,
  localModels = [],
  nimModels = [],
  cloudModels = [],
  providerOrder = [],
  intentRouterEnabled = false,
}) {
  const [pickerView, setPickerView] = useState('home');
  const [cloudProvider, setCloudProvider] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setPickerView('home');
      setCloudProvider(null);
    }
  }, [isOpen]);

  // Only models that can actually answer a message are offered. /api/models
  // returns the unusable ones too — switched off, no API key, not pulled into
  // Ollama — and the picker used to render them greyed out but still
  // clickable, so selecting one saved fine and failed at send time with
  // "disabled globally by the administrator". A row you cannot use is not
  // worth the tap it costs to find that out.
  const usableLocal = useMemo(
    () => localModels.filter(m => m.available), [localModels]);
  const usableNim = useMemo(
    () => nimModels.filter(m => m.available), [nimModels]);

  // Group all cloud providers so the Cloud section is always discoverable,
  // even when unkeyed/inactive.
  const allCloudGroups = useMemo(() => {
    const byProvider = new Map();
    for (const m of cloudModels) {
      if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
      byProvider.get(m.provider).push(m);
    }
    const order = providerOrder.length ? providerOrder : PROVIDER_ORDER;
    const known = order.filter(p => byProvider.has(p));
    const extra = [...byProvider.keys()].filter(p => !order.includes(p));
    return [...known, ...extra].map(
      p => {
        const models = byProvider.get(p) || [];
        const availableCount = models.filter(m => m.available).length;
        return { provider: p, models, availableCount };
      });
  }, [cloudModels, providerOrder]);

  const activeCloudGroups = useMemo(
    () => allCloudGroups.filter(g => g.availableCount > 0), [allCloudGroups]);

  const activeGroup = allCloudGroups.find(g => g.provider === cloudProvider);
  const nothingUsable =
    usableLocal.length === 0 && usableNim.length === 0 && activeCloudGroups.length === 0;

  // "River Decides" needs something behind it too. With routing on it needs
  // any usable model; with routing off it resolves to the local default, so
  // it needs a usable local one specifically.
  const autoUsable = intentRouterEnabled ? !nothingUsable : usableLocal.length > 0;

  if (!isOpen) return null;

  // One centred bottom sheet on every viewport. The old anchored variant
  // positioned the panel off the model button's right edge, which slid
  // off-screen on phones because the button sits on the left. Sizing lives in
  // .rs-mpop so the class and the inline style cannot disagree about it.
  const panelStyle = { left: 12, right: 12, bottom: 12, top: 'auto', width: 'auto', marginInline: 'auto' };

  const closeModelPicker = () => {
    setPickerView('home');
    setCloudProvider(null);
    if (onClose) onClose();
  };

  const pick = (provider, modelId) => {
    closeModelPicker();
    onSelect(provider, modelId);
  };

  // Summarize available or configured cloud providers
  const cloudSummary = (() => {
    if (activeCloudGroups.length > 0) {
      const names = activeCloudGroups.map(g => providerLabel(g.provider));
      if (names.length <= 3) return names.join(' · ');
      return `${names.slice(0, 3).join(' · ')} +${names.length - 3}`;
    }
    if (allCloudGroups.length > 0) {
      return 'Configure in Settings';
    }
    return 'Cloud AI';
  })();

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={closeModelPicker} />
      <div className="rs-mpop" style={panelStyle}>
        {pickerView === 'home' && <>
          {onBackToTools && (
            <MpopBack label="Tools & Attachments" onClick={onBackToTools} />
          )}
          {autoUsable && <MpopRow icon="auto_awesome" title="River Decides" sub={intentRouterEnabled ? 'Auto-routes to the best model' : 'Routing off · uses your local model'} active={selectedModel?.provider === 'auto'} onClick={() => pick('auto', 'auto')} />}
          {usableLocal.length > 0 && <MpopRow icon="memory" title="Local" sub={`${usableLocal.length} ready · Ollama`} active={selectedModel?.provider === 'ollama'} chevron onClick={() => setPickerView('local')} />}
          {usableNim.length > 0 && <MpopRow icon="memory_alt" title="NVIDIA NIM" sub="Free cloud inference" active={selectedModel?.provider === 'nvidia_nim'} chevron onClick={() => setPickerView('nvidia')} />}
          {allCloudGroups.length > 0 && <MpopRow icon="cloud" title="Cloud" sub={cloudSummary} active={!!selectedModel && !['auto','ollama','nvidia_nim'].includes(selectedModel?.provider)} chevron onClick={() => setPickerView('cloud')} />}
          {nothingUsable && allCloudGroups.length === 0 && <p className="rs-mpop-empty">No models are available. Enable a provider in admin settings, or pull a model via Ollama.</p>}
        </>}

        {pickerView === 'local' && <>
          <MpopBack label="Local Models" onClick={() => setPickerView('home')} />
          {usableLocal.length === 0
            ? <p className="rs-mpop-empty">Pull a model via Ollama first.</p>
            : usableLocal.map(m => <MpopRow key={m.model_id} icon="memory" title={m.display_name} sub={m.notes || (m.vram_gb ? `${m.vram_gb} GB VRAM` : m.model_id)} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'ollama'} disabled={!m.available} onClick={() => pick('ollama', m.model_id)} />)
          }
        </>}

        {pickerView === 'nvidia' && <>
          <MpopBack label="NVIDIA NIM" onClick={() => setPickerView('home')} />
          {usableNim.map(m => <MpopRow key={m.model_id} icon="memory_alt" title={m.display_name} sub={m.notes || 'Free · NIM'} badge="FREE" active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'nvidia_nim'} disabled={!m.available} onClick={() => pick('nvidia_nim', m.model_id)} />)}
        </>}

        {pickerView === 'cloud' && <>
          <MpopBack label="Cloud Providers" onClick={() => setPickerView('home')} />
          {allCloudGroups.map(g => (
            <MpopRow
              key={g.provider}
              icon="cloud"
              title={providerLabel(g.provider)}
              sub={g.availableCount > 0 ? `${g.availableCount} ready` : 'Setup in Settings'}
              badge={g.availableCount === 0 ? 'SETUP' : undefined}
              active={selectedModel?.provider === g.provider}
              chevron
              onClick={() => { setCloudProvider(g.provider); setPickerView('cloudModels'); }}
            />
          ))}
        </>}

        {pickerView === 'cloudModels' && <>
          <MpopBack label={providerLabel(cloudProvider)} onClick={() => { setCloudProvider(null); setPickerView('cloud'); }} />
          {activeGroup?.availableCount === 0 && (
            <div style={{ padding: '10px 14px', margin: '4px 8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.78rem', color: 'var(--md-outline)' }}>
              API key is not configured for {providerLabel(cloudProvider)}. Configure keys in Settings &gt; Admin Settings to enable these models.
            </div>
          )}
          {(activeGroup?.models || []).map(m => (
            <MpopRow
              key={`${m.provider}::${m.model_id}`}
              icon="cloud"
              title={m.display_name}
              sub={m.available ? (m.cost_per_1k_input_usd != null ? fmtCost(m.cost_per_1k_input_usd) : m.notes || null) : 'Not configured (add API key)'}
              active={selectedModel?.model_id === m.model_id && selectedModel?.provider === m.provider}
              disabled={!m.available}
              onClick={() => pick(m.provider, m.model_id)}
            />
          ))}
        </>}
      </div>
    </>
  );
}
