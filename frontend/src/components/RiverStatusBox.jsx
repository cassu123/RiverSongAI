import React, { useEffect, useRef, useState } from 'react'
import './RiverStatusBox.css'

const STATE_META = {
  idle:         { label: 'STANDBY',     color: 'var(--primary)',   pulse: 'slow' },
  connecting:   { label: 'CONNECTING',  color: 'var(--md-on-surface-variant)',  pulse: 'slow' },
  listening:    { label: 'LISTENING',   color: '#00ffcc', pulse: 'fast' },
  transcribing: { label: 'PROCESSING',  color: 'var(--primary)',   pulse: 'fast' },
  thinking:     { label: 'THINKING',    color: '#9955ff',          pulse: 'fast' },
  speaking:     { label: 'SPEAKING',    color: '#00aaff', pulse: 'fast' },
  error:        { label: 'ERROR',       color: 'var(--md-error)',  pulse: 'slow' },
}

const DOT_COLORS_THINKING = ['#9955ff', '#00aaff', '#00ffcc', '#ff55aa', '#ffaa00']

export default function RiverStatusBox({ state = 'idle', streamingText = '' }) {
  const meta = STATE_META[state] || STATE_META.idle
  const isThinking = state === 'thinking'
  const isSpeaking = state === 'speaking'
  const isListening = state === 'listening'
  const isActive = state !== 'idle' && state !== 'connecting'

  return (
    <div className="rsb" style={{ '--rsb-color': meta.color }}>
      {/* Indicator area */}
      <div className="rsb-body">
        {isThinking && <ThinkingDots colors={DOT_COLORS_THINKING} />}
        {isSpeaking && <WaveformBars />}
        {isListening && <ListeningRings />}
        {!isActive   && <IdleRing />}
      </div>

      {/* Streaming text or last state hint */}
      <div className="rsb-text-zone">
        {streamingText ? (
          <div className="rsb-stream">
            {streamingText}
            <span className="rsb-cursor" aria-hidden="true">|</span>
          </div>
        ) : (
          <div className="rsb-hint">
            {state === 'idle'      && 'RIVER SONG STANDING BY'}
            {state === 'thinking'  && 'PROCESS IN PROGRESS...'}
            {state === 'speaking'  && 'TRANSMITTING RESPONSE'}
            {state === 'listening' && 'AWAITING INPUT...'}
          </div>
        )}
      </div>
    </div>
  )
}

// -- Sub-components --

function PulseDot({ speed, color }) {
  return (
    <span
      className={`rsb-pulse-dot rsb-pulse-dot--${speed}`}
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  )
}

function IdleRing() {
  return (
    <div className="rsb-idle-ring">
      <div className="rsb-idle-ring-inner" />
    </div>
  )
}

function ThinkingDots({ colors }) {
  return (
    <div className="rsb-think-dots">
      {colors.map((c, i) => (
        <span
          key={i}
          className="rsb-think-dot"
          style={{
            background: c,
            boxShadow: `0 0 8px ${c}`,
            animationDelay: `${i * 0.14}s`,
          }}
        />
      ))}
    </div>
  )
}

function WaveformBars() {
  const BARS = 16
  return (
    <div className="rsb-wave">
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          className="rsb-wave-bar"
          style={{ animationDelay: `${i * 0.05}s` }}
        />
      ))}
    </div>
  )
}

function ListeningRings() {
  return (
    <div className="rsb-listen-rings">
      <div className="rsb-listen-ring" style={{ animationDelay: '0s' }} />
      <div className="rsb-listen-ring" style={{ animationDelay: '0.4s' }} />
      <div className="rsb-listen-ring" style={{ animationDelay: '0.8s' }} />
    </div>
  )
}
