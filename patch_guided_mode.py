import re

with open("frontend/src/components/MaintenancePulse.jsx", "r") as f:
    content = f.read()

# Add states for Guided Job Mode
state_hook = """  const [activeJob, setActiveJob] = useState(null); // The checkpoint item for the walkthrough
  const [jobGuides, setJobGuides] = useState([]);
  const [findingGuide, setFindingGuide] = useState(false);"""
content = re.sub(r'const \[timeline, setTimeline\] = useState\(null\);', r'const [timeline, setTimeline] = useState(null);\n' + state_hook, content)

# Add "START SERVICE" button in the PredictiveTimeline component.
# Wait, PredictiveTimeline is defined separately. Let's find it.
predictive_timeline_regex = re.compile(
    r'(<strong style=\{\{ fontSize: \'1\.1rem\' \}\}>\{item\.description\}</strong>.*?</div>.*?)(</div>)',
    re.DOTALL
)

def replace_next_up(match):
    return match.group(1) + """
               <div style={{ marginTop: '0.75rem' }}>
                 <button className="rs-pill is-active" onClick={(e) => {
                     e.stopPropagation();
                     // we need to dispatch an event or call a callback because this is inside PredictiveTimeline
                     window.dispatchEvent(new CustomEvent('start-guided-job', { detail: item }));
                 }}>
                   <span className="material-symbols-rounded">build</span> START SERVICE
                 </button>
               </div>
""" + match.group(2)

content = content.replace(
    '<strong style={{ fontSize: \'1.1rem\' }}>{item.description}</strong>\n               </div>\n               <div style={{ marginTop: \'0.25rem\', color: \'var(--text-dim)\' }}>',
    '<strong style={{ fontSize: \'1.1rem\' }}>{item.description}</strong>\n               </div>\n               <div style={{ marginTop: \'0.25rem\', color: \'var(--text-dim)\' }}>'
)
# Using python script to carefully modify PredictiveTimeline since it's hard to target with pure string replace.
