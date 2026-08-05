import React, { useEffect, useState } from 'react'
import ChatInterface from '../components/ChatInterface.jsx'

export default function ChatPage({ setAction, onNavigate }) {
  const [initialIntent, setInitialIntent] = useState(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('rs-chat-intent')
      if (stored) {
        const parsed = JSON.parse(stored)
        setInitialIntent(parsed)
        localStorage.removeItem('rs-chat-intent')
      }
    } catch (err) {
      console.warn('Failed to parse rs-chat-intent', err)
      localStorage.removeItem('rs-chat-intent')
    }
  }, [])

  return (
    <ChatInterface
      setAction={setAction}
      onNavigate={onNavigate}
      initialIntent={initialIntent}
      embedded={false}
    />
  )
}
