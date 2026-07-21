import re

with open("frontend/src/components/MaintenancePulse.jsx", "r") as f:
    content = f.read()

# 1. State hooks
state_hook = """  const [formMode, setFormMode]     = useState(preselectedId === 'NEW' ? 'add' : 'none'); // 'none' | 'add' | 'edit' | 'job-guide'
  const [view, setView]             = useState('log');  // 'log' | 'specs' | 'history' | 'settings'
  const [activeJob, setActiveJob]   = useState(null);
  const [jobGuides, setJobGuides]   = useState([]);
  const [findingGuide, setFindingGuide] = useState(false);"""
content = re.sub(
    r'  const \[formMode, setFormMode\]\s*=\s*useState\(preselectedId === \'NEW\' \? \'add\' : \'none\'\);\s*// \'none\' \| \'add\' \| \'edit\'\n  const \[view, setView\]\s*=\s*useState\(\'log\'\);\s*// \'log\' \| \'specs\' \| \'history\' \| \'settings\'',
    state_hook,
    content
)

# 2. PredictiveTimeline props update
content = re.sub(
    r'function PredictiveTimeline\(\{ token, vehicleId, currentOdometer \}\) \{',
    'function PredictiveTimeline({ token, vehicleId, currentOdometer, isNonRoad, onStartJob }) {',
    content
)

# 3. Add prices and START SERVICE button to PredictiveTimeline
target_parts = """               {item.parts && item.parts.length > 0 && (
                 <div className="parts-list" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    <strong style={{color: 'var(--primary)'}}>Parts:</strong> {item.parts.map(p => p.part_name).join(', ')}
                 </div>
               )}
            </div>"""

replacement_parts = """               {item.parts && item.parts.length > 0 && (
                 <div className="parts-list" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    <strong style={{color: 'var(--primary)'}}>Parts:</strong> {item.parts.map(p => {
                        const price = p.alternatives && p.alternatives[0]?.price ? `$${p.alternatives[0].price}` : '';
                        return `${p.part_name} ${price ? `(${price})` : ''}`;
                    }).join(', ')}
                 </div>
               )}
               <div style={{ marginTop: '0.75rem' }}>
                 <button className="rs-pill is-active" onClick={(e) => {
                     e.stopPropagation();
                     if (onStartJob) onStartJob(item);
                 }}>
                   <span className="material-symbols-rounded">build</span> START SERVICE
                 </button>
               </div>
            </div>"""

content = content.replace(target_parts, replacement_parts)

# 4. Units for mi / hrs inside PredictiveTimeline
content = content.replace(
    'NOW (Overdue by {Math.abs(item.miles_remaining)} mi)',
    'NOW (Overdue by {Math.abs(item.miles_remaining)} {isNonRoad ? "hrs" : "mi"})'
)
content = content.replace(
    ': `in ${item.miles_remaining} miles`}',
    ': `in ${item.miles_remaining} ${isNonRoad ? "hours" : "miles"}`}'
)
content = content.replace(
    'in {item.miles_remaining} mi</span>',
    'in {item.miles_remaining} {isNonRoad ? "hrs" : "mi"}</span>'
)

# 5. Units for INTERVAL and NEXT DUE
content = content.replace('INTERVAL (MILES)', 'INTERVAL ({isNonRoad ? "HOURS" : "MILES"})')
content = content.replace('NEXT DUE (MILES)', 'NEXT DUE ({isNonRoad ? "HOURS" : "MILES"})')

# 6. PredictiveTimeline instance render update
content = content.replace(
    '<PredictiveTimeline token={token} vehicleId={currentVehicle.id} currentOdometer={mileage} />',
    '<PredictiveTimeline token={token} vehicleId={currentVehicle.id} currentOdometer={mileage} isNonRoad={isNonRoad} onStartJob={(job) => { setActiveJob(job); setFormMode(\'job-guide\'); }} />'
)

# 7. Add Guided Job panel right before formMode === 'add'
panel = """        {formMode === 'job-guide' && activeJob && (
          <div className="rs-card mp-log-form">
            <h3 style={{ marginTop: 0, color: 'var(--primary)' }}>GUIDED JOB: {activeJob.description}</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <p><strong>Status:</strong> {activeJob.miles_remaining <= 0 ? 'Overdue' : 'Due soon'}</p>
              {activeJob.parts && activeJob.parts.length > 0 && (
                <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>Required Parts</h4>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {activeJob.parts.map(p => {
                        const price = p.alternatives && p.alternatives[0]?.price ? `$${p.alternatives[0].price}` : '';
                        return <li key={p.id}>{p.part_name} {p.oem_part_number ? `(${p.oem_part_number})` : ''} {price && <strong style={{color: 'var(--rs-status-ok)'}}>{price}</strong>}</li>
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <button className="rs-pill is-active" onClick={async () => {
                  setFindingGuide(true);
                  try {
                    const res = await fetch(`/api/vehicles/${selectedId}/media`, {
                       method: 'POST',
                       headers: { Authorization: `Bearer ${token}` },
                       body: new URLSearchParams({ kind: 'link_archive', title: `Guide: ${activeJob.description}` })
                    });
                    setTimeout(() => { setFindingGuide(false); alert("Agent is looking for guides..."); }, 1000);
                  } catch (e) {
                    setFindingGuide(false);
                  }
              }}>
                <span className="material-symbols-rounded">search</span> {findingGuide ? 'FINDING...' : 'FIND A GUIDE'}
              </button>
            </div>

            <div className="form-actions">
              <button className="rs-pill" onClick={() => { setFormMode('none'); setActiveJob(null); }}>CANCEL</button>
              <button className="rs-pill is-active" onClick={() => {
                 setFormMode('add'); 
                 setServiceType(activeJob.description);
              }}>
                <span className="material-symbols-rounded">check_circle</span> LOG AS COMPLETED
              </button>
            </div>
          </div>
        )}
"""

# Replace ONLY the FIRST occurrence of {formMode === 'add' && ( inside MaintenancePulse return block.
# Actually we can just do a split and join.
parts = content.split("{formMode === 'add' && (")
if len(parts) >= 2:
    # the first occurrence is in the main return statement of MaintenancePulse
    content = parts[0] + panel + "{formMode === 'add' && (" + "{formMode === 'add' && (".join(parts[1:])

with open("frontend/src/components/MaintenancePulse.jsx", "w") as f:
    f.write(content)
