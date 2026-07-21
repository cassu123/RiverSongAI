import re

with open("frontend/src/pages/CulinaryPage.jsx", "r") as f:
    content = f.read()

btn_target = """<button className="rs-pill" style={{ color: '#0071ce' }} onClick={async () => {
                    await api.post('/meal-plan/shop-this-week');
                    alert('Added missing ingredients to Procurement List!');
                }}><span className="material-symbols-rounded">shopping_cart</span> SHOP THIS WEEK</button>"""
                
new_btns = btn_target + """
                <button className="rs-pill" onClick={async () => {
                    const entryIds = mealPlan.filter(e => e.status === 'planned' && e.recipe_id).map(e => e.id);
                    if (entryIds.length === 0) return alert('No planned recipes this week.');
                    const res = await api.post('/meal-plan/create-prep-session', { entry_ids: entryIds });
                    if (res.status === 'ok') {
                        fetchData('prep');
                        setActiveTab('prep');
                    }
                }}><span className="material-symbols-rounded">kitchen</span> BATCH PREP</button>
"""

content = content.replace(btn_target, new_btns)

with open("frontend/src/pages/CulinaryPage.jsx", "w") as f:
    f.write(content)
