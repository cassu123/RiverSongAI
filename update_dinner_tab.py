import re

with open("frontend/src/pages/CulinaryPage.jsx", "r") as f:
    content = f.read()

# Add state
state_block = """  const [banned, setBanned] = useState([])
  const [newGroceryItem, setNewGroceryItem] = useState("")
  const [mealPlan, setMealPlan] = useState([])"""
content = content.replace('  const [banned, setBanned] = useState([])\n  const [newGroceryItem, setNewGroceryItem] = useState("")', state_block)

# Update fetchData
old_fetch = """      if (tab === 'dinner') setProposals(await api.get('/dinner'))"""
new_fetch = """      if (tab === 'dinner') {
        setProposals(await api.get('/dinner'));
        const d = new Date();
        const d2 = new Date(d);
        d2.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
        const start = d2.toISOString().split('T')[0];
        setMealPlan(await api.get(`/meal-plan?start=${start}`));
      }"""
content = content.replace(old_fetch, new_fetch)

# Add WS meal_plan_updated handler
old_ws = """        if (msg.event === 'grocery_updated') {
          if (activeTab === 'grocery') fetchData('grocery');
        }"""
new_ws = old_ws + """
        if (msg.event === 'meal_plan_updated' || msg.event === 'dinner_updated') {
          if (activeTab === 'dinner') fetchData('dinner');
        }"""
content = content.replace(old_ws, new_ws)

# Replace renderDinner
old_render_dinner = content[content.find("  const renderDinner = () => ("):content.find("  const renderPrep = () => (")]

new_render_dinner = """  const renderDinner = () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Sunday
    
    const week = [];
    for (let i = 0; i < 7; i++) {
       const cd = new Date(d);
       cd.setDate(cd.getDate() + i);
       const dateStr = cd.toISOString().split('T')[0];
       const entry = mealPlan.find(m => m.plan_date.startsWith(dateStr));
       week.push({ dayName: days[i], dateStr, entry });
    }
    
    return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
       <div className="rs-card is-wide is-elev" style={{ border: '1px solid var(--primary)', background: 'color-mix(in srgb, var(--primary) 4%, var(--bg-base))' }}>
          <div className="rs-card-inner">
             <div className="rs-card-head">
                <span className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>THIS WEEK</span>
                <button className="rs-pill" style={{ color: '#0071ce' }} onClick={async () => {
                    await api.post('/meal-plan/shop-this-week');
                    alert('Added missing ingredients to Procurement List!');
                }}><span className="material-symbols-rounded">shopping_cart</span> SHOP THIS WEEK</button>
             </div>
             
             <div style={{ display: 'flex', gap: 12, marginTop: 24, overflowX: 'auto', paddingBottom: 16 }}>
               {week.map(w => (
                 <div key={w.dateStr} style={{ 
                   flex: 1, minWidth: 120, 
                   background: w.entry ? 'var(--md-surface-container-high)' : 'var(--md-surface-container)', 
                   borderRadius: 16, padding: 16, border: '1px solid var(--md-outline-variant)' 
                 }}>
                   <div style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.5, marginBottom: 8 }}>{w.dayName.toUpperCase()}</div>
                   {w.entry ? (
                     <>
                       <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>{w.entry.recipe_title || w.entry.label || 'Planned'}</div>
                       <div style={{ fontSize: '0.7rem', color: w.entry.status === 'cooked' ? '#4ade80' : 'var(--primary)', marginTop: 8, fontWeight: 800 }}>{w.entry.status.toUpperCase()}</div>
                     </>
                   ) : (
                     <div style={{ opacity: 0.3, fontSize: '0.8rem', fontStyle: 'italic' }}>Open</div>
                   )}
                 </div>
               ))}
             </div>
          </div>
       </div>
       
       {proposals.length > 0 && (
         <div className="rs-card-head" style={{ marginTop: 16 }}>
            <span className="rs-card-label" style={{ fontWeight: 900 }}>DINNER PROPOSALS</span>
         </div>
       )}
       
       <div className="rs-card-flow">
          {proposals.map(p => (
            <div key={p.id} className={`rs-card is-wide animate-page-in ${p.status === 'approved' ? 'is-elev' : ''}`} style={{ borderColor: p.status === 'approved' ? 'var(--primary)' : 'var(--md-outline)', animationDuration: '400ms' }}>
               <div className="rs-card-inner">
                  <div className="rs-card-head">
                     <span className="rs-card-label" style={{ color: p.status === 'approved' ? 'var(--primary)' : 'inherit', fontWeight: 900 }}>{p.status.toUpperCase()} PROPOSAL</span>
                     <div style={{ display: 'flex', gap: 8 }}>
                        <span className="rs-pill" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>{p.votes_yes.length} YES</span>
                        <span className="rs-pill" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>{p.votes_no.length} NO</span>
                     </div>
                  </div>
                  <div className="rs-card-value" style={{ fontSize: '1.5rem', marginBottom: 20 }}>{p.recipe?.title}</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                     <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
                        await api.post(`/dinner/${p.id}/vote`, { vote: 'yes' });
                        fetchData('dinner');
                     }}>APPROVE</button>
                     <button className="rs-pill" style={{ flex: 1, color: 'var(--md-error)' }} onClick={async () => {
                        await api.post(`/dinner/${p.id}/vote`, { vote: 'no' });
                        fetchData('dinner');
                     }}>VETO</button>
                     <button className="rs-pill" onClick={async () => {
                        await api.delete(`/dinner/${p.id}`);
                        fetchData('dinner');
                     }}><span className="material-symbols-rounded">close</span></button>
                  </div>
               </div>
            </div>
          ))}
       </div>
    </div>
    )
  }
"""

content = content.replace(old_render_dinner, new_render_dinner + "\n")

with open("frontend/src/pages/CulinaryPage.jsx", "w") as f:
    f.write(content)
