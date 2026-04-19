import React, { useState } from 'react'
import Sidebar          from './components/Sidebar.jsx'
import DashboardPage    from './pages/DashboardPage.jsx'
import ConversationPage from './pages/ConversationPage.jsx'
import MemoryPage       from './pages/MemoryPage.jsx'
import RoutinesPage     from './pages/RoutinesPage.jsx'
import HomeNodePage     from './pages/HomeNodePage.jsx'
import UsersPage        from './pages/UsersPage.jsx'
import KillSwitchPage   from './pages/KillSwitchPage.jsx'

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard')

  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="app-main">
        {currentPage === 'dashboard'  && <DashboardPage  onNavigate={setCurrentPage} />}
        {currentPage === 'speak'      && <ConversationPage />}
        {currentPage === 'memory'     && <MemoryPage />}
        {currentPage === 'routines'   && <RoutinesPage />}
        {currentPage === 'home'       && <HomeNodePage />}
        {currentPage === 'users'      && <UsersPage />}
        {currentPage === 'killswitch' && <KillSwitchPage />}
      </main>
    </div>
  )
}
