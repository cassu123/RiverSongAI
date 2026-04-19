// =============================================================================
// src/App.jsx
//
// Root application shell. Renders the NavBar and switches between pages.
// All conversation state lives in ConversationPage; settings state in
// SettingsPage. This component owns nothing except the current page key.
// =============================================================================

import React, { useState } from 'react'
import NavBar          from './components/NavBar.jsx'
import ConversationPage from './pages/ConversationPage.jsx'
import SettingsPage     from './pages/SettingsPage.jsx'

export default function App() {
  const [currentPage, setCurrentPage] = useState('conversation')

  return (
    <div className="app-shell">
      <NavBar currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="app-main">
        {currentPage === 'conversation' && <ConversationPage />}
        {currentPage === 'settings'     && <SettingsPage />}
      </main>
    </div>
  )
}
