// =============================================================================
// src/main.jsx
//
// React application entry point.
// Mounts the root App component into the #root div from index.html.
// Global styles are imported here so they apply to the entire application.
// =============================================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './context/AuthContext.jsx'
import App from './App.jsx'
import './styles/global.css'
import './styles/themes.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
