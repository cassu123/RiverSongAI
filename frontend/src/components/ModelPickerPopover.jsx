import React, { useState, useEffect, useMemo } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { providerLabel, PROVIDER_ORDER } from '../utils/providers';

function fmtCost(v) {
  if (v == null) return null;
  return `$${(v * 1000000).toFixed(2)}/M`;
}

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

export default function ModelPickerPopover({
  isOpen,
  onClose,
  pos,
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
  const { isPhone } = useBreakpoint();

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

  // Cloud is grouped by provider rather than served as one flat list, so the
  // sheet reads Cloud → Qwen → its models instead of thirty-odd models from
  // nine vendors in registry order. A provider with nothing usable behind it
  // never appears.
  const cloudGroups = useMemo(() => {
    const byProvider = new Map();
    for (const m of cloudModels) {
      if (!m.available) continue;
      if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
      byProvider.get(m.provider).push(m);
    }
    const order = providerOrder.length ? providerOrder : PROVIDER_ORDER;
    const known = order.filter(p => byProvider.has(p));
    const extra = [...byProvider.keys()].filter(p => !order.includes(p));
    return [...known, ...extra].map(
      p => ({ provider: p, models: byProvider.get(p) }));
  }, [cloudModels, providerOrder]);

  const activeGroup = cloudGroups.find(g => g.provider === cloudProvider);
  const nothingUsable =
    usableLocal.length === 0 && usableNim.length === 0 && cloudGroups.length === 0;

  if (!isOpen) return null;

  // The anchored popover (positioned by the model button's right edge) slides
  // off-screen on phones because the button sits on the left. On phones, render
  // it as a full-width bottom sheet that's always fully on-screen; keep the
  // anchored popover on desktop.
  const panelStyle = isPhone
    ? { left: 12, right: 12, bottom: 12, top: 'auto', width: 'auto' }
    : { bottom: pos.bottom, right: pos.right, top: pos.top, left: pos.left };

  const closeModelPicker = () => {
    setPickerView('home');
    setCloudProvider(null);
    if (onClose) onClose();
  };

  const pick = (provider, modelId) => {
    closeModelPicker();
    onSelect(provider, modelId);
  };

  // The Cloud row used to advertise "Claude · Gemini · GPT" whether or not any
  // of the three were switched on. Name what is actually behind it.
  const cloudSummary = (() => {
    const names = cloudGroups.map(g => providerLabel(g.provider));
    if (names.length <= 3) return names.join(' · ');
    return `${names.slice(0, 3).join(' · ')} +${names.length - 3}`;
  })();

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={closeModelPicker} />
      <div className="rs-mpop" style={panelStyle}>
        {pickerView === 'home' && <>
          {/* With the intent router off, provider="auto" does not route — it
              resolves to the local default. The row claimed automatic model
              choice either way, which is a promise the server was not
              keeping. */}
          <MpopRow icon="auto_awesome" title="River Decides" sub={intentRouterEnabled ? 'Auto-routes to the best model' : 'Routing off · uses your local model'} active={selectedModel?.provider === 'auto'} onClick={() => pick('auto', 'auto')} />
          {usableLocal.length > 0 && <MpopRow icon="memory" title="Local" sub={`${usableLocal.length} ready · Ollama`} active={selectedModel?.provider === 'ollama'} chevron onClick={() => setPickerView('local')} />}
          {usableNim.length > 0 && <MpopRow icon="memory_alt" title="NVIDIA NIM" sub="Free cloud inference" active={selectedModel?.provider === 'nvidia_nim'} chevron onClick={() => setPickerView('nvidia')} />}
          {cloudGroups.length > 0 && <MpopRow icon="cloud" title="Cloud" sub={cloudSummary} active={!!selectedModel && !['auto','ollama','nvidia_nim'].includes(selectedModel?.provider)} chevron onClick={() => setPickerView('cloud')} />}
          {nothingUsable && <p className="rs-mpop-empty">No models are available. Enable a provider in admin settings, or pull a model via Ollama.</p>}
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
          {cloudGroups.map(g => <MpopRow key={g.provider} icon="cloud" title={providerLabel(g.provider)} sub={`${g.models.length} model${g.models.length === 1 ? '' : 's'}`} active={selectedModel?.provider === g.provider} chevron onClick={() => { setCloudProvider(g.provider); setPickerView('cloudModels'); }} />)}
        </>}

        {pickerView === 'cloudModels' && <>
          <MpopBack label={providerLabel(cloudProvider)} onClick={() => { setCloudProvider(null); setPickerView('cloud'); }} />
          {(activeGroup?.models || []).map(m => <MpopRow key={`${m.provider}::${m.model_id}`} icon="cloud" title={m.display_name} sub={m.cost_per_1k_input_usd != null ? fmtCost(m.cost_per_1k_input_usd) : m.notes || null} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === m.provider} disabled={!m.available} onClick={() => pick(m.provider, m.model_id)} />)}
        </>}
      </div>
    </>
  );
}
