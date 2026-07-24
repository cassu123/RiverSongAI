import React, { useState, useEffect } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';

function fmtCost(v) {
  if (v == null) return null;
  return `$${(v * 1000000).toFixed(2)}/M`;
}

function MpopRow({ icon, title, sub, active, dimmed, chevron, badge, onClick }) {
  return (
    <button
      className={`rs-mpop-row${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
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
  hasNvidia = false,
  hasCloud = false
}) {
  const [pickerView, setPickerView] = useState('home');
  const { isPhone } = useBreakpoint();

  useEffect(() => {
    if (isOpen) {
      setPickerView('home');
    }
  }, [isOpen]);

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
    if (onClose) onClose();
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={closeModelPicker} />
      <div className="rs-mpop" style={panelStyle}>
        {pickerView === 'home' && <>
          <MpopRow icon="auto_awesome" title="River Decides" sub="Auto-routes to the best model" active={selectedModel?.provider === 'auto'} onClick={() => { closeModelPicker(); onSelect('auto', 'auto'); }} />
          <MpopRow icon="memory" title="Local" sub={localModels.filter(m => m.available).length > 0 ? `${localModels.filter(m => m.available).length} ready · Ollama` : 'No models installed'} active={selectedModel?.provider === 'ollama'} chevron onClick={() => setPickerView('local')} />
          {hasNvidia && <MpopRow icon="memory_alt" title="NVIDIA NIM" sub="Free cloud inference" active={selectedModel?.provider === 'nvidia_nim'} chevron onClick={() => setPickerView('nvidia')} />}
          {hasCloud  && <MpopRow icon="cloud" title="Cloud" sub="Claude · Gemini · GPT" active={!!selectedModel && !['auto','ollama','nvidia_nim'].includes(selectedModel?.provider)} chevron onClick={() => setPickerView('cloud')} />}
        </>}

        {pickerView === 'local' && <>
          <MpopBack label="Local Models" onClick={() => setPickerView('home')} />
          {localModels.length === 0
            ? <p className="rs-mpop-empty">Pull a model via Ollama first.</p>
            : localModels.map(m => <MpopRow key={m.model_id} icon="memory" title={m.display_name} sub={m.notes || (m.vram_gb ? `${m.vram_gb} GB VRAM` : m.model_id)} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'ollama'} dimmed={!m.available} onClick={() => { closeModelPicker(); onSelect('ollama', m.model_id); }} />)
          }
        </>}

        {pickerView === 'nvidia' && <>
          <MpopBack label="NVIDIA NIM" onClick={() => setPickerView('home')} />
          {nimModels.map(m => <MpopRow key={m.model_id} icon="memory_alt" title={m.display_name} sub={m.available ? (m.notes || 'Free · NIM') : 'Enable NIM in .env'} badge={m.available ? 'FREE' : null} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'nvidia_nim'} dimmed={!m.available} onClick={() => { closeModelPicker(); onSelect('nvidia_nim', m.model_id); }} />)}
        </>}

        {pickerView === 'cloud' && <>
          <MpopBack label="Cloud Providers" onClick={() => setPickerView('home')} />
          {cloudModels.map(m => <MpopRow key={`${m.provider}::${m.model_id}`} icon="cloud" title={m.display_name} sub={m.available ? (m.cost_per_1k_input_usd != null ? fmtCost(m.cost_per_1k_input_usd) : m.provider) : 'Enable in admin settings'} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === m.provider} dimmed={!m.available} onClick={() => { closeModelPicker(); onSelect(m.provider, m.model_id); }} />)}
        </>}
      </div>
    </>
  );
}
