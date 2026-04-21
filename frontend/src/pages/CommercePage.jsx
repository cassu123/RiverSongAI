import React from 'react'

const COMMERCE_FEATURES = [
  {
    key: 'amazon',
    icon: IconCart,
    title: 'AMAZON',
    desc: 'Search products, check prices, review your order history, and add items to your cart by voice.',
    tags: ['Product search', 'Price check', 'Order history'],
  },
  {
    key: 'walmart',
    icon: IconStore,
    title: 'WALMART',
    desc: 'Browse grocery and general merchandise, check local store availability, and build shopping lists conversationally.',
    tags: ['Grocery search', 'Store availability', 'Shopping list'],
  },
]

export default function CommercePage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>INTEGRATIONS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>COMMERCE</span>
      </div>
      <h1 className="page-title">Commerce</h1>
      <p className="page-subtitle">
        Shop, search, and manage orders by asking River directly.
      </p>

      <div className="coming-soon-banner">
        <span className="coming-soon-tag">COMING SOON</span>
        <span className="coming-soon-text">
          Commerce providers (Amazon, Walmart) are scaffolded. API authentication and conversation hooks ship in a future phase.
        </span>
      </div>

      <div className="feature-card-grid feature-card-grid--2col">
        {COMMERCE_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
          <div key={key} className="feature-card feature-card--locked">
            <div className="feature-card-header">
              <div className="feature-card-icon"><Icon /></div>
              <div className="feature-card-title">{title}</div>
              <div className="feature-card-badge">SOON</div>
            </div>
            <p className="feature-card-desc">{desc}</p>
            <div className="feature-card-tags">
              {tags.map(t => <span key={t} className="feature-tag">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IconCart() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M2 2h2l2.4 9.6A1.5 1.5 0 0 0 7.8 13H16a1.5 1.5 0 0 0 1.46-1.15L19 6H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="8" cy="17" r="1.2" fill="currentColor"/>
      <circle cx="15" cy="17" r="1.2" fill="currentColor"/>
    </svg>
  )
}

function IconStore() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 9v9h14V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M1 5h18l-1.5 4H2.5L1 5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <rect x="8" y="13" width="4" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}
