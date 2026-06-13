import re

with open('frontend/src/App.jsx', 'r') as f:
    content = f.read()

# Add PreviewPage lazy import
if 'PreviewRoot' not in content:
    content = content.replace("const SlaePage                 = lazy(() => import('./pages/SlaePage.jsx'))", "const SlaePage                 = lazy(() => import('./pages/SlaePage.jsx'))\nconst PreviewRoot              = lazy(() => import('./preview/PreviewRoot.jsx'))")

# Add to PAGE_TO_PATH
if "preview: '/preview'" not in content:
    content = content.replace("slae:             '/admin/slae',", "slae:             '/admin/slae',\n  preview:          '/preview',")

# Add to route handler
if "currentPage === 'preview'" not in content:
    content = content.replace("{currentPage === 'slae'           && <SlaePage setAction={setPageAction} />}", "{currentPage === 'slae'           && <SlaePage setAction={setPageAction} />}\n              {currentPage === 'preview'        && <PreviewRoot />}")

with open('frontend/src/App.jsx', 'w') as f:
    f.write(content)
print("App.jsx patched with Preview route.")
