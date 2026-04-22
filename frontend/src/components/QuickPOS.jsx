import React, { useState } from 'react';
import './QuickPOS.css';

const MOCK_PRODUCTS = [
  { id: 'perf_001', sku: 'HBH-MB-001', name: 'Midnight Bloom (Extrait)', price: 85.0, stock: 5 },
  { id: 'app_001', sku: 'APP-OCH-BLK-L', name: 'Cyber Hoodie (Black/L)', price: 65.0, stock: 12 },
  { id: 'perf_002', sku: 'HBH-NC-002', name: 'Neon Citrus (EDP)', price: 75.0, stock: 2 },
  { id: 'app_002', sku: 'APP-TCP-OLV-M', name: 'Cargo Pants (Olive/M)', price: 110.0, stock: 0 }
];

const MOCK_CUSTOMERS = [
  { id: 'gid://shopify/Customer/123', name: 'Aria Vance', email: 'aria@cyber.net' },
  { id: 'gid://shopify/Customer/456', name: 'Kaelen Rhy', email: 'k.rhy@neon.co' }
];

export default function QuickPOS() {
  const [mode, setMode] = useState('OUT'); // 'IN' or 'OUT'
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  
  // Transaction Feedback — null when hidden, { msg, type } when visible
  const [flashMsg, setFlashMsg] = useState(null);

  // Filtering Products
  const filteredProducts = MOCK_PRODUCTS.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const filteredCustomers = MOCK_CUSTOMERS.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
    c.email.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const addToCart = (product) => {
    if (mode === 'OUT' && product.stock <= 0) {
      triggerFlash('ERROR: INSUFFICIENT STOCK', 'error');
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const triggerFlash = (msg, type = 'success') => {
    setFlashMsg({ msg, type });
    setTimeout(() => setFlashMsg(null), 2500);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    
    // Log transaction logic here (API call to backend)
    console.log(`[POS TRANSACTION] Mode: ${mode}`);
    console.log(`Customer: ${selectedCustomer ? selectedCustomer.name : 'GUEST'}`);
    console.log('Items:', cart);
    
    triggerFlash(`TRANSACTION COMPLETE // TOTAL: $${cartTotal.toFixed(2)}`);
    
    // Reset state
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch('');
  };

  return (
    <div className="pos-container glass-panel">
      <div className="pos-header">
        <h2 className="pos-title">QUICK POS // TERMINAL</h2>
        
        <div className="toggle-container">
          <span className={`toggle-label ${mode === 'IN' ? 'active' : ''}`}>STOCK IN</span>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={mode === 'OUT'} 
              onChange={() => {
                setMode(mode === 'IN' ? 'OUT' : 'IN');
                setCart([]); // Clear cart on mode switch
              }} 
            />
            <span className="slider"></span>
          </label>
          <span className={`toggle-label ${mode === 'OUT' ? 'active' : ''}`}>STOCK OUT</span>
        </div>
      </div>

      {flashMsg && (
        <div className={`flash-banner ${flashMsg.type}`}>
          {flashMsg.msg}
        </div>
      )}

      <div className="pos-layout">
        {/* Left Column: Product Search & Grid */}
        <div className="pos-main">
          <div className="search-bar">
            <input 
              type="text" 
              className="cyber-input fat-input" 
              placeholder="SEARCH SKU OR PRODUCT NAME..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="product-grid">
            {filteredProducts.map(product => {
              const outOfStock = product.stock <= 0 && mode === 'OUT';
              return (
                <button 
                  key={product.id} 
                  className={`pos-product-btn ${outOfStock ? 'disabled' : ''}`}
                  onClick={() => !outOfStock && addToCart(product)}
                >
                  <span className="pos-sku">{product.sku}</span>
                  <span className="pos-name">{product.name}</span>
                  <div className="pos-btn-footer">
                    <span className="pos-price">${product.price.toFixed(2)}</span>
                    <span className="pos-stock">
                      {mode === 'OUT' ? `[${product.stock} IN STOCK]` : '[ADD INVENTORY]'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Cart & CRM */}
        <div className="pos-sidebar">
          {/* CRM Section (Only relevant for Stock Out/Sales) */}
          {mode === 'OUT' && (
            <div className="crm-section">
              <h3 className="section-title">CUSTOMER VAULT</h3>
              {selectedCustomer ? (
                <div className="selected-customer">
                  <div className="customer-info">
                    <span className="cust-name">{selectedCustomer.name}</span>
                    <span className="cust-email">{selectedCustomer.email}</span>
                  </div>
                  <button className="clear-btn" onClick={() => setSelectedCustomer(null)}>X</button>
                </div>
              ) : (
                <div className="customer-search-container">
                  <input 
                    type="text" 
                    className="cyber-input" 
                    placeholder="Search Customer..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  {customerSearch && (
                    <div className="customer-results">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(c => (
                          <div 
                            key={c.id} 
                            className="customer-result-item"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setCustomerSearch('');
                            }}
                          >
                            {c.name} <span className="dim">({c.email})</span>
                          </div>
                        ))
                      ) : (
                        <div className="customer-result-item dim">No results. Add new?</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cart Section */}
          <div className="cart-section">
            <h3 className="section-title">PENDING {mode === 'IN' ? 'RECEIPT' : 'SALE'}</h3>
            
            <div className="cart-items">
              {cart.length === 0 ? (
                <div className="empty-cart">CART EMPTY</div>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="cart-item">
                    <div className="cart-item-details">
                      <span className="cart-item-name">{item.name}</span>
                      <span className="cart-item-qty">
                        {item.qty} x ${item.price.toFixed(2)}
                      </span>
                    </div>
                    <div className="cart-item-actions">
                      <span className="cart-item-subtotal">${(item.qty * item.price).toFixed(2)}</span>
                      <button className="del-btn" onClick={() => removeFromCart(item.id)}>X</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="cart-summary">
              <div className="summary-row">
                <span>TOTAL</span>
                <span className="total-amount">${cartTotal.toFixed(2)}</span>
              </div>
              <button 
                className={`checkout-btn ${cart.length === 0 ? 'disabled' : ''} ${mode === 'IN' ? 'btn-in' : 'btn-out'}`}
                onClick={handleCheckout}
                disabled={cart.length === 0}
              >
                {mode === 'IN' ? 'CONFIRM RESTOCK' : 'FINALIZE TRANSACTION'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}