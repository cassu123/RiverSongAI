import re

with open("frontend/src/pages/CulinaryPage.jsx", "r") as f:
    content = f.read()

# Add state for new grocery item
state_block = """  const [banned, setBanned] = useState([])
  const [newGroceryItem, setNewGroceryItem] = useState("")"""
content = content.replace("  const [banned, setBanned] = useState([])", state_block)

# Add renderGrocery()
render_grocery_block = """
  const renderGrocery = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
       <div className="rs-card is-wide" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-card-inner">
             <div className="rs-card-head">
                <span className="rs-card-label">QUICK ADD</span>
                <span className="material-symbols-rounded">add_shopping_cart</span>
             </div>
             <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <input
                   className="rs-input"
                   style={{ flex: 1 }}
                   placeholder="Item name..."
                   value={newGroceryItem}
                   onChange={e => setNewGroceryItem(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === 'Enter' && newGroceryItem.trim()) {
                       api.post('/grocery', { name: newGroceryItem.trim() })
                         .then(() => { setNewGroceryItem(""); fetchData('grocery'); });
                     }
                   }}
                />
                <button className="rs-btn-primary" disabled={!newGroceryItem.trim()} onClick={() => {
                   api.post('/grocery', { name: newGroceryItem.trim() })
                     .then(() => { setNewGroceryItem(""); fetchData('grocery'); });
                }}>ADD</button>
             </div>
          </div>
       </div>

       <div className="rs-card is-wide is-elev" style={{ border: '1px solid var(--primary)', background: 'color-mix(in srgb, var(--primary) 4%, var(--bg-base))' }}>
          <div className="rs-card-inner">
            <div className="rs-card-head">
               <span className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>PROCUREMENT LIST</span>
               <div style={{ display: 'flex', gap: 8 }}>
                 <button className="rs-pill" onClick={async () => {
                    if (confirm('Clear checked items?')) {
                      await api.post('/grocery/clear');
                      fetchData('grocery');
                    }
                 }}><span className="material-symbols-rounded">clear_all</span> CLEAR</button>
                 <button className="rs-pill" style={{ color: '#0071ce' }} onClick={async () => {
                    const res = await api.post('/walmart/export');
                    if (res.cart_url) window.open(res.cart_url, '_blank');
                    if (res.unmapped && res.unmapped.length > 0) alert('Unmapped items: ' + res.unmapped.join(', '));
                 }}><span className="material-symbols-rounded">shopping_cart</span> WALMART</button>
               </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
               {grocery.length === 0 ? (
                 <div className="rs-card-meta" style={{ textAlign: 'center', padding: '32px 0' }}>All sectors fully provisioned.</div>
               ) : grocery.map((it, idx) => (
                 <div key={idx} className="rs-pill" style={{ 
                   justifyContent: 'flex-start', 
                   background: it.checked ? 'transparent' : 'rgba(0,0,0,0.2)',
                   opacity: it.checked ? 0.5 : 1,
                   textDecoration: it.checked ? 'line-through' : 'none'
                 }}>
                   <button 
                     style={{ 
                       background: 'transparent', 
                       border: 'none', 
                       cursor: 'pointer', 
                       color: 'inherit',
                       display: 'flex',
                       alignItems: 'center',
                       padding: 0,
                       marginRight: 12
                     }}
                     onClick={async () => {
                       await api.patch(`/grocery/${it.id}`, { checked: !it.checked });
                       fetchData('grocery');
                     }}
                   >
                     <span className="material-symbols-rounded">{it.checked ? 'check_box' : 'check_box_outline_blank'}</span>
                   </button>
                   <span style={{ flex: 1, fontWeight: 700 }}>{it.name} {it.qty ? `(${it.qty})` : ''}</span>
                   <button className="rs-pill" style={{ padding: '4px 8px' }} onClick={async () => {
                      await api.delete(`/grocery/${it.id}`);
                      fetchData('grocery');
                   }}><span className="material-symbols-rounded" style={{ fontSize: 16 }}>delete</span></button>
                 </div>
               ))}
            </div>
          </div>
       </div>
    </div>
  )

  const renderEquipment = () => {"""
content = content.replace("  const renderEquipment = () => {", render_grocery_block)

old_grocery_tab = """          {activeTab === 'grocery' && (
             <div className="rs-card-flow">
               <div className="rs-card is-wide is-elev animate-page-in" style={{ border: '1px solid var(--md-error)', background: 'color-mix(in srgb, var(--md-error) 4%, var(--bg-base))', animationDuration: '400ms' }}>
                  <div className="rs-card-inner">
                    <div className="rs-card-head">
                       <span className="rs-card-label" style={{ color: 'var(--md-error)', fontWeight: 900 }}>PROCUREMENT REQUIRED</span>
                       <span className="material-symbols-rounded" style={{ color: 'var(--md-error)' }}>shopping_cart</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
                       {grocery.length === 0 ? (
                         <div className="rs-card-meta">All sectors fully provisioned.</div>
                       ) : grocery.map((it, idx) => (
                         <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'rgba(0,0,0,0.2)' }}>
                           <span style={{ flex: 1, fontWeight: 700 }}>{it.name}</span>
                           <span className="rs-card-label" style={{ fontSize: '0.6rem', color: 'var(--md-error)' }}>CRITICAL</span>
                         </div>
                       ))}
                    </div>
                  </div>
               </div>
             </div>
          )}"""

content = content.replace(old_grocery_tab, "          {activeTab === 'grocery' && renderGrocery()}")

with open("frontend/src/pages/CulinaryPage.jsx", "w") as f:
    f.write(content)
