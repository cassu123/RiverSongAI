import re

with open("frontend/src/components/MaintenancePulse.jsx", "r") as f:
    content = f.read()

effect = """  useEffect(() => {
    const handleStartJob = (e) => {
      setActiveJob(e.detail);
      setFormMode('job-guide');
    };
    window.addEventListener('start-guided-job', handleStartJob);
    return () => window.removeEventListener('start-guided-job', handleStartJob);
  }, []);
"""

content = re.sub(
    r'(const \[view, setView\]\s*=\s*useState\([^)]+\);\s*// [^\n]+)',
    r'\1\n' + effect,
    content
)

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
                    // Simulated finding guide
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

content = content.replace(
    "{formMode === 'add' && (",
    panel + "\n        {formMode === 'add' && ("
)

with open("frontend/src/components/MaintenancePulse.jsx", "w") as f:
    f.write(content)
