import React, { useState, useEffect } from 'react'

async function apiFetch(path, token, opts = {}) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.status === 204 ? null : res.json()
}

export function CommerceMembers({ workspace, token }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('employee')

  const load = () => apiFetch(`/api/commerce/workspaces/${workspace.id}/members`, token).then(setMembers)
  useEffect(() => { load() }, [workspace])

  const addMember = async () => {
    if (!email) return
    await apiFetch(`/api/commerce/workspaces/${workspace.id}/members`, token, {
      method: 'POST', body: JSON.stringify({ email, role })
    })
    setEmail('')
    load()
  }

  const removeMember = async (id) => {
    await apiFetch(`/api/commerce/workspaces/${workspace.id}/members/${id}`, token, { method: 'DELETE' })
    load()
  }

  return (
    <div className="rs-card-flow animate-fade-in">
      <div className="rs-card is-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="rs-input" style={{ flex: 1 }} placeholder="Invite via email..." value={email} onChange={e => setEmail(e.target.value)} />
        <select className="rs-pill" value={role} onChange={e => setRole(e.target.value)}>
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="employee">Employee</option>
        </select>
        <button className="rs-btn-primary" onClick={addMember}>ADD MEMBER</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {members.map(m => (
          <div key={m.id} className="rs-card">
            <div className="rs-card-value">{m.user.username || m.user.email}</div>
            <div className="rs-card-meta">Role: {m.role}</div>
            <button className="rs-pill btn-danger" style={{ marginTop: 12 }} onClick={() => removeMember(m.user.id)}>REMOVE</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CommerceCustomers({ workspace, token }) {
  const [customers, setCustomers] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const load = () => apiFetch(`/api/commerce/workspaces/${workspace.id}/customers`, token).then(setCustomers)
  useEffect(() => { load() }, [workspace])

  const addCustomer = async () => {
    if (!name) return
    await apiFetch(`/api/commerce/workspaces/${workspace.id}/customers`, token, {
      method: 'POST', body: JSON.stringify({ name, email })
    })
    setName(''); setEmail('')
    load()
  }

  const removeCustomer = async (id) => {
    await apiFetch(`/api/commerce/customers/${id}`, token, { method: 'DELETE' })
    load()
  }

  return (
    <div className="rs-card-flow animate-fade-in">
      <div className="rs-card is-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="rs-input" placeholder="Customer Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="rs-input" style={{ flex: 1 }} placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
        <button className="rs-btn-primary" onClick={addCustomer}>ADD CUSTOMER</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {customers.map(c => (
          <div key={c.id} className="rs-card">
            <div className="rs-card-value">{c.name}</div>
            <div className="rs-card-meta">{c.email || 'No email'}</div>
            <button className="rs-pill btn-danger" style={{ marginTop: 12 }} onClick={() => removeCustomer(c.id)}>DELETE</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CommerceSuppliers({ workspace, token }) {
  const [suppliers, setSuppliers] = useState([])
  const [name, setName] = useState('')

  const load = () => apiFetch(`/api/commerce/workspaces/${workspace.id}/suppliers`, token).then(setSuppliers)
  useEffect(() => { load() }, [workspace])

  const addSupplier = async () => {
    if (!name) return
    await apiFetch(`/api/commerce/workspaces/${workspace.id}/suppliers`, token, {
      method: 'POST', body: JSON.stringify({ name })
    })
    setName('')
    load()
  }

  const removeSupplier = async (id) => {
    await apiFetch(`/api/commerce/suppliers/${id}`, token, { method: 'DELETE' })
    load()
  }

  return (
    <div className="rs-card-flow animate-fade-in">
      <div className="rs-card is-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="rs-input" style={{ flex: 1 }} placeholder="Supplier Name" value={name} onChange={e => setName(e.target.value)} />
        <button className="rs-btn-primary" onClick={addSupplier}>ADD SUPPLIER</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suppliers.map(s => (
          <div key={s.id} className="rs-card">
            <div className="rs-card-value">{s.name}</div>
            <button className="rs-pill btn-danger" style={{ marginTop: 12 }} onClick={() => removeSupplier(s.id)}>DELETE</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CommerceSales({ workspace, token }) {
  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  
  // Sale creation form
  const [selectedProductId, setSelectedProductId] = useState('')
  const [qty, setQty] = useState(1)

  const load = async () => {
    const s = await apiFetch(`/api/commerce/workspaces/${workspace.id}/sales`, token)
    setSales(s)
    const p = await apiFetch(`/api/commerce/workspaces/${workspace.id}/products`, token)
    setProducts(p)
  }
  useEffect(() => { load() }, [workspace])

  const addSale = async () => {
    if (!selectedProductId) return
    const payload = {
      lines: [{ product_id: selectedProductId, quantity: Number(qty) }]
    }
    await apiFetch(`/api/commerce/workspaces/${workspace.id}/sales`, token, {
      method: 'POST', body: JSON.stringify(payload)
    })
    load()
  }

  return (
    <div className="rs-card-flow animate-fade-in">
      <div className="rs-card is-wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select className="rs-pill" style={{ flex: 1 }} value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
          <option value="">-- Select Product --</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} (${p.unit_price || 0})</option>)}
        </select>
        <input className="rs-input" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 80 }} />
        <button className="rs-btn-primary" onClick={addSale}>RECORD SALE</button>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {sales.map(s => (
          <div key={s.id} className="rs-card is-wide" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="rs-card-value">Sale #{s.id.slice(0, 8)}</div>
              <div className="rs-card-meta">Items: {s.lines?.reduce((a,b)=>a+b.quantity,0) || 0} | Status: {s.status}</div>
            </div>
            <div style={{ fontSize: '1.2rem', color: 'var(--primary)', fontWeight: 700 }}>
              ${Number(s.total_amount).toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
