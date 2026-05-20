// =============================================================================
// src/main.jsx
//
// React application entry point.
// Mounts the root App component into the #root div from index.html.
// Global styles are imported here so they apply to the entire application.
// =============================================================================

import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './context/AuthContext.jsx'
import App from './App.jsx'
import './styles/global.css'
import './styles/themes.css'

const KioskPage = lazy(() => import('./pages/KioskPage.jsx'))

const rootElement = document.getElementById('root')
const root = ReactDOM.createRoot(rootElement)

// Short-circuit for Kiosk mode to avoid Auth overhead and hook violations
if (window.location.pathname === '/kiosk') {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#000' }} />}>
        <KioskPage />
      </Suspense>
    </React.StrictMode>
  )
} else {
  root.render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>
  )
}
