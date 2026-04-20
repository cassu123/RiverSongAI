// src/components/RiverSong.jsx
import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, Float, Sparkles } from '@react-three/drei'

const STATE_COLORS = {
  idle:         '#00aaff',
  connecting:   '#003366',
  listening:    '#00ffee',
  transcribing: '#0099cc',
  thinking:     '#9955ff',
  speaking:     '#00ffaa',
  error:        '#ff4433',
}

function AvatarModel({ state, audioLevel }) {
  const { nodes } = useGLTF('/avatar.glb')
  const groupRef = useRef()

  useFrame((stateObj, delta) => {
    if (groupRef.current) {
      // Base scale
      const scaleBase = 1.0;
      
      // 1. Exaggerated audio reactive scale when speaking/listening
      // Multiply by a larger number so small audio levels are visible
      const scaleAdd = (state === 'speaking' || state === 'listening') ? audioLevel * 0.8 : 0;
      const targetScale = scaleBase + scaleAdd;
      
      // Fast, snappy scaling
      groupRef.current.scale.setScalar(
        groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * 0.3
      )

      // 2. Audio reactive bouncing (moves up when loud)
      const targetY = -1.5 + ((state === 'speaking' || state === 'listening') ? audioLevel * 0.6 : 0);
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.3;

      // 3. Audio reactive shaking/rotation
      if (state === 'speaking' || state === 'listening') {
         // Fast jitter based on audio level to simulate energy/talking
         groupRef.current.rotation.y = Math.sin(stateObj.clock.elapsedTime * 20) * audioLevel * 0.4;
         groupRef.current.rotation.z = Math.cos(stateObj.clock.elapsedTime * 25) * audioLevel * 0.2;
      } else {
         // Smoothly return to center
         groupRef.current.rotation.y += (0 - groupRef.current.rotation.y) * 0.1;
         groupRef.current.rotation.z += (0 - groupRef.current.rotation.z) * 0.1;
      }
    }
  })

  const color = STATE_COLORS[state] || STATE_COLORS.idle;
  
  // Make the emissive glow much stronger when talking
  const glowIntensity = (state === 'speaking' || state === 'listening') 
    ? 0.4 + audioLevel * 3.0 
    : 0.2;

  return (
    <group ref={groupRef} dispose={null} position={[0, -1.5, 0]}>
      <mesh geometry={nodes.mesh_0.geometry}>
        <meshStandardMaterial 
          color={color} 
          emissive={color}
          emissiveIntensity={glowIntensity}
          wireframe={state === 'thinking' || state === 'connecting'}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  )
}

useGLTF.preload('/avatar.glb')

export default function RiverSong({ state, audioLevel = 0 }) {
  return (
    <div className="river-song-canvas" style={{ width: 300, height: 420 }}>
      <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        
        {/* Float adds the subtle ambient floating void effect */}
        <Float speed={state === 'thinking' ? 5 : 2.5} rotationIntensity={0.5} floatIntensity={1}>
          <AvatarModel state={state} audioLevel={audioLevel} />
        </Float>
        
        {state !== 'connecting' && (
           <Sparkles 
             count={state === 'thinking' ? 120 : 50} 
             scale={3} 
             size={state === 'speaking' ? 6 : 3} 
             speed={state === 'speaking' ? 0.8 : 0.3} 
             color={STATE_COLORS[state] || STATE_COLORS.idle} 
             noise={state === 'speaking' ? 0.5 : 0.1}
           />
        )}
      </Canvas>
    </div>
  )
}
