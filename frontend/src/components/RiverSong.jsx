import React, { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, Float, Sparkles } from '@react-three/drei'

// Map AI states to theme-relative hue shifts
const STATE_EMISSIVE = {
  idle:         '--primary',
  connecting:   '--accent',
  listening:    '--secondary',
  transcribing: '--primary',
  thinking:     '--secondary',
  speaking:     '--secondary',
  error:        '--error',
}

// Read a CSS variable from the document root
function getCSSVar(name) {
  if (typeof window === 'undefined') return '#00aaff'
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return val || null
}

function AvatarModel({ state, audioLevel, lipSyncOpen = 0 }) {
  const { scene } = useGLTF('/avatar.glb')
  const groupRef = useRef()
  
  // State-driven color that polls CSS variables
  const [color, setColor] = useState('#00aaff')

  useEffect(() => {
    const v = STATE_EMISSIVE[state] || '--primary'
    const raw = getCSSVar(v)
    if (raw) setColor(raw)
    
    // Fallback polling for slow theme loads in production
    const tid = setTimeout(() => {
      const retry = getCSSVar(v)
      if (retry) setColor(retry)
    }, 100)
    return () => clearTimeout(tid)
  }, [state])

  // Collect all meshes from the scene
  const meshes = useMemo(() => {
    const found = []
    scene.traverse(obj => { if (obj.isMesh) found.push(obj) })
    return found
  }, [scene])

  useFrame((stateObj) => {
    if (!groupRef.current) return

    // Driver: use lipSyncOpen if > 0, fallback to audioLevel
    const driver = lipSyncOpen > 0 ? lipSyncOpen : audioLevel

    if (state === 'speaking' || state === 'listening') {
      const scaleBase = 1.0
      const scaleAdd = driver * 0.8
      const targetScale = scaleBase + scaleAdd
      groupRef.current.scale.setScalar(
        groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * 0.3
      )

      const targetY = -1.5 + (driver * 0.6)
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.3

      groupRef.current.rotation.y = Math.sin(stateObj.clock.elapsedTime * 20) * driver * 0.4
      groupRef.current.rotation.z = Math.cos(stateObj.clock.elapsedTime * 25) * driver * 0.2
    } else if (state === 'idle') {
      // Idle breathing animation
      const breathingFreq = 0.8
      const breathingAmpY = 0.05
      const breathingAmpScale = 0.01

      const targetY = -1.5 + Math.sin(stateObj.clock.elapsedTime * breathingFreq) * breathingAmpY
      const targetScale = 1.0 + Math.sin(stateObj.clock.elapsedTime * breathingFreq) * breathingAmpScale

      groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.1
      groupRef.current.scale.setScalar(
        groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * 0.1
      )

      groupRef.current.rotation.y += (0 - groupRef.current.rotation.y) * 0.1
      groupRef.current.rotation.z += (0 - groupRef.current.rotation.z) * 0.1
    } else {
      // Other states (thinking, connecting, error)
      groupRef.current.scale.setScalar(
        groupRef.current.scale.x + (1.0 - groupRef.current.scale.x) * 0.3
      )
      groupRef.current.position.y += (-1.5 - groupRef.current.position.y) * 0.3
      groupRef.current.rotation.y += (0 - groupRef.current.rotation.y) * 0.1
      groupRef.current.rotation.z += (0 - groupRef.current.rotation.z) * 0.1
    }
  })

  const driver = lipSyncOpen > 0 ? lipSyncOpen : audioLevel
  const glowIntensity = (state === 'speaking' || state === 'listening')
    ? 0.5 + driver * 3.5
    : 0.3

  return (
    <group ref={groupRef} dispose={null} position={[0, -1.5, 0]}>
      {meshes.map((mesh, i) => (
        <mesh key={i} geometry={mesh.geometry}>
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={glowIntensity}
            wireframe={state === 'thinking' || state === 'connecting'}
            transparent
            opacity={0.92}
            roughness={0.2}
            metalness={0.6}
          />
        </mesh>
      ))}
    </group>
  )
}

useGLTF.preload('/avatar.glb')

export default function RiverSong({ state, audioLevel = 0, lipSyncOpen = 0, compact = false }) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    // Short delay before mounting Three.js to ensure CSS vars are applied
    const tid = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(tid)
  }, [])

  const [color, setColor] = useState('#00aaff')
  useEffect(() => {
    const v = STATE_EMISSIVE[state] || '--primary'
    const raw = getCSSVar(v)
    if (raw) setColor(raw)
  }, [state])

  const isSpeaking = state === 'speaking' || state === 'listening'
  const driver = lipSyncOpen > 0 ? lipSyncOpen : audioLevel

  // CSS bloom
  const glowStrength = isSpeaking ? 1.2 + driver * 3 : 0.6
  const canvasStyle = {
    filter: `brightness(${1 + glowStrength * 0.3}) drop-shadow(0 0 ${6 + glowStrength * 10}px ${color})`,
    transition: 'filter 0.1s ease',
    opacity: mounted ? 1 : 0
  }

  return (
    <div className={`river-song-wrapper ${compact ? 'river-song-wrapper--compact' : ''}`}>
      <style>{`
        .river-song-wrapper--compact {
          transform: scale(1.3);
        }
      `}</style>
      <div className="river-song-scanlines" aria-hidden="true" />
      <div className="river-song-vignette"  aria-hidden="true" />

      <div className="river-song-canvas" style={canvasStyle}>
        {mounted && (
          <Canvas 
            camera={{ 
              position: compact ? [0, 0, 3.5] : [0, 0, 4.5], 
              fov: compact ? 50 : 45 
            }} 
            gl={{ antialias: true }}
          >
            <ambientLight intensity={0.4} />
            <pointLight position={[0, 4, 3]} intensity={2.0} color={color} />
            <pointLight position={[0, -2, 2]} intensity={0.6} color={color} />

            <Float speed={state === 'thinking' ? 5 : 2.5} rotationIntensity={0.5} floatIntensity={1}>
              <AvatarModel state={state} audioLevel={audioLevel} lipSyncOpen={lipSyncOpen} />
            </Float>

            {state !== 'connecting' && (
              <Sparkles
                count={state === 'thinking' ? 120 : 50}
                scale={3}
                size={isSpeaking ? 6 : 3}
                speed={isSpeaking ? 0.8 : 0.3}
                color={color}
                noise={isSpeaking ? 0.5 : 0.1}
              />
            )}
          </Canvas>
        )}
      </div>
    </div>
  )
}
