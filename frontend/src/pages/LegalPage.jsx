import React, { useState } from 'react'

export default function LegalPage() {
  const [activeTab, setActiveTab] = useState('privacy')

  return (
    <div className="rs-page">
      <header className="rs-page-header">
        <h1 className="rs-page-title">Legal & Privacy</h1>
        <p className="rs-page-subtitle" style={{ opacity: 0.7, marginTop: 8 }}>
          Agreements, privacy policies, and open source licenses.
        </p>
      </header>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '20px 0' }}>
        <button 
          className={`rs-pill is-tappable ${activeTab === 'privacy' ? 'is-active' : ''}`} 
          onClick={() => setActiveTab('privacy')}
        >
          Privacy Policy
        </button>
        <button 
          className={`rs-pill is-tappable ${activeTab === 'terms' ? 'is-active' : ''}`} 
          onClick={() => setActiveTab('terms')}
        >
          Terms of Service
        </button>
        <button 
          className={`rs-pill is-tappable ${activeTab === 'licenses' ? 'is-active' : ''}`} 
          onClick={() => setActiveTab('licenses')}
        >
          Open Source Licenses
        </button>
      </div>

      <div className="rs-page-content animate-slide-up">
        {activeTab === 'privacy' && (
          <div className="rs-card">
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '16px' }}>Privacy Policy</h2>
            <p style={{ opacity: 0.6, fontSize: '0.8rem', marginBottom: '24px' }}>Last Updated: July 12, 2026</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', lineHeight: '1.6' }}>
              <p>River Song AI ("we", "our", or "us") respects your privacy. This Privacy Policy explains how we collect, use, and protect your information.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>1. Information We Collect</h3>
              <p>We may collect personal data such as your name, email address, voice inputs, and application usage data. We also store conversation history and memories locally or securely in the cloud based on your preferences.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>2. How We Use Your Information</h3>
              <p>Your data is used strictly to provide and improve the AI experience, process natural language inputs, and personalize your interactions with River Song AI.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>3. Data Sharing and Security</h3>
              <p>We do not sell your personal data. Data may be shared with trusted third-party APIs (e.g., Google, OpenAI, Anthropic) solely for the purpose of generating responses and fulfilling your requests.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>4. Contact Us</h3>
              <p>If you have any questions about this Privacy Policy, please contact us via our support channels.</p>
            </div>
          </div>
        )}

        {activeTab === 'terms' && (
          <div className="rs-card">
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '16px' }}>Terms of Service</h2>
            <p style={{ opacity: 0.6, fontSize: '0.8rem', marginBottom: '24px' }}>Last Updated: July 12, 2026</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', lineHeight: '1.6' }}>
              <p>Welcome to River Song AI. By accessing or using our application, you agree to be bound by these Terms of Service.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>1. Use of the Application</h3>
              <p>You agree to use the app only for lawful purposes. You are responsible for all activity that occurs under your account.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>2. AI-Generated Content</h3>
              <p>River Song AI generates content based on user inputs. We make no representations or warranties regarding the accuracy, reliability, or completeness of the AI-generated responses.</p>
              
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '8px' }}>3. Limitation of Liability</h3>
              <p>We shall not be liable for any indirect, incidental, special, or consequential damages resulting from the use or inability to use the application.</p>
            </div>
          </div>
        )}

        {activeTab === 'licenses' && (
          <div className="rs-card">
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '16px' }}>Open Source Licenses</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', lineHeight: '1.6' }}>
              <p>River Song AI uses several open source libraries. We are grateful to the open source community.</p>
              
              <ul style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <li><strong>React</strong> - MIT License</li>
                <li><strong>Three.js</strong> - MIT License</li>
                <li><strong>Leaflet</strong> - BSD-2-Clause License</li>
                <li><strong>Vite</strong> - MIT License</li>
              </ul>
              
              <p>Full license texts can be found in the respective project repositories or our source code distribution.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
