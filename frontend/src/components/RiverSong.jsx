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

function AvatarModel({ state, audioLevel }) {
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

    const scaleBase = 1.0
    const scaleAdd = (state === 'speaking' || state === 'listening') ? audioLevel * 0.8 : 0
    const targetScale = scaleBase + scaleAdd
    groupRef.current.scale.setScalar(
      groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * 0.3
    )

    const targetY = -1.5 + ((state === 'speaking' || state === 'listening') ? audioLevel * 0.6 : 0)
    groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.3

    if (state === 'speaking' || state === 'listening') {
      groupRef.current.rotation.y = Math.sin(stateObj.clock.elapsedTime * 20) * audioLevel * 0.4
      groupRef.current.rotation.z = Math.cos(stateObj.clock.elapsedTime * 25) * audioLevel * 0.2
    } else {
      groupRef.current.rotation.y += (0 - groupRef.current.rotation.y) * 0.1
      groupRef.current.rotation.z += (0 - groupRef.current.rotation.z) * 0.1
    }
  })

  const glowIntensity = (state === 'speaking' || state === 'listening')
    ? 0.5 + audioLevel * 3.5
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

export default function RiverSong({ state, audioLevel = 0 }) {
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

  // CSS bloom
  const glowStrength = isSpeaking ? 1.2 + audioLevel * 3 : 0.6
  const canvasStyle = {
    filter: `brightness(${1 + glowStrength * 0.3}) drop-shadow(0 0 ${6 + glowStrength * 10}px ${color})`,
    transition: 'filter 0.1s ease',
    opacity: mounted ? 1 : 0
  }

  return (
    <div className="river-song-wrapper">
      <div className="river-song-scanlines" aria-hidden="true" />
      <div className="river-song-vignette"  aria-hidden="true" />

      <div className="river-song-canvas" style={canvasStyle}>
        {mounted && (
          <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} gl={{ antialias: true }}>
            <ambientLight intensity={0.4} />
            <pointLight position={[0, 4, 3]} intensity={2.0} color={color} />
            <pointLight position={[0, -2, 2]} intensity={0.6} color={color} />

            <Float speed={state === 'thinking' ? 5 : 2.5} rotationIntensity={0.5} floatIntensity={1}>
              <AvatarModel state={state} audioLevel={audioLevel} />
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
