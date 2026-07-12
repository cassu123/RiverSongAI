import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer, Bloom } from '@react-three/postprocessing'

// ─ Constants pulled verbatim from prototypes/presence-orb.html ─────────────
const PALETTES = {
  // Legacy "spice" still resolves to the Dune amber for backward compatibility
  spice: {
    warm:       0xd4a040, deep: 0x6e3a16, silhouette: 0xe8c878,
    accent:     0xffd28a, glyph: 0x8a5a28, bloom: 0.55, glyphStyleSeed: 1.0,
  },
  dune: {
    warm:       0xd4a040, deep: 0x6e3a16, silhouette: 0xe8c878,
    accent:     0xffd28a, glyph: 0x8a5a28, bloom: 0.55, glyphStyleSeed: 1.0,
  },
  halo: {
    warm:       0x78c8e6, deep: 0x1a3a52, silhouette: 0xb0e0f0,
    accent:     0xe6f6ff, glyph: 0x3a7090, bloom: 0.50, glyphStyleSeed: 0.0,
  },
  mv: {
    warm:       0xb0a0c8,  // pastel violet-grey
    deep:       0x3a2a55,  // deep indigo
    silhouette: 0xd0c0e0,  // pale lilac
    accent:     0xeae0f0,  // chalk pastel
    glyph:      0x7a6090,  // muted plum
    bloom:      0.45,
    glyphStyleSeed: 0.5,
  },
  nightcity: {
    warm:       0xff3c8c,  // hot magenta
    deep:       0x0a0a16,  // pitch
    silhouette: 0xc8c8d4,  // chrome
    accent:     0x80e0ff,  // cyan signage
    glyph:      0xe8ff00,  // glitch yellow
    bloom:      0.65,
    glyphStyleSeed: 0.25,
  },
};

const STATE_TINT = {
  idle:      { warmShift: 0.0,  bloomBump: 0.00, speed: 1.0 },
  listening: { warmShift: 0.05, bloomBump: 0.18, speed: 1.6 },
  thinking:  { warmShift: 0.25, bloomBump: 0.12, speed: 2.2 },
  speaking:  { warmShift: 0.15, bloomBump: 0.28, speed: 1.3 },
  acting:    { warmShift: 0.4,  bloomBump: 0.22, speed: 1.4 },
  error:     { warmShift: 0.0,  bloomBump: 0.06, speed: 0.6, errorTint: true },
};

const STATE_MAP = {
  idle: 'idle', 
  connecting: 'thinking', 
  listening: 'listening',
  transcribing: 'thinking', 
  thinking: 'thinking',
  speaking: 'speaking', 
  error: 'error',
}

// ─ Shaders — copy verbatim from prototype ──────────────────────────────────
const VORTEX_VERT = `
  varying vec3 vNormal; varying vec3 vWorldPos; varying vec2 vUv;
  uniform float uTime, uPulse, uAudio, uMorph, uError;

  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
  float noise(vec3 p){
    vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(
      mix(mix(hash(i),                hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)),    hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)),    hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)),    hash(i+vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main(){
    vNormal = normalize(normalMatrix * normal);
    vec3 p = position;
    float breath = sin(uTime * 0.8 + position.y * 2.0) * 0.012 + uPulse * 0.04;
    
    // Audio FFT simulation
    float audioDeform = sin(position.x * 12.0 + uTime * 8.0) * sin(position.z * 12.0 + uTime * 6.0) * (uAudio * 0.15);
    
    // Morphing / Shattering (Thinking)
    float shatter = noise(position * 6.0 + vec3(uTime)) * uMorph * 0.25;
    
    // Jagged error
    float jagged = noise(position * 15.0 - vec3(uTime * 2.0)) * uError * 0.15;
    
    p += normal * (breath + audioDeform + shatter + jagged);
    
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz; vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const VORTEX_FRAG = `
  varying vec3 vNormal; varying vec3 vWorldPos;
  uniform float uTime, uAudio, uPulse, uSpeed, uStyleSeed;
  uniform vec3  uWarm, uDeep, uAccent, uCamPos;

  float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
  float noise(vec3 p){
    vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(
      mix(mix(hash(i),                hash(i+vec3(1,0,0)), f.x),
          mix(hash(i+vec3(0,1,0)),    hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)),    hash(i+vec3(1,0,1)), f.x),
          mix(hash(i+vec3(0,1,1)),    hash(i+vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.07; a*=0.5; } return s; }

  void main(){
    vec3 n  = normalize(vNormal);
    float lat = n.y;
    float lon = atan(n.x, n.z);
    float t = uTime * 0.18 * uSpeed;

    vec3 q1 = vec3(sin(lon*1.5 + t*1.6) + lat*2.0,
                   lat*4.0 + t*0.9,
                   cos(lon*1.5 + t*1.6) - lat*2.0);
    float swirl1 = fbm(q1 * 1.4);
    float swirl2 = fbm(q1 * 2.6 + vec3(0.0, t*0.6, 0.0));
    float flow = mix(swirl1, swirl2, 0.5);

    float bands = sin(lat * 22.0 + flow * 4.0 + t * 0.4);
    bands = smoothstep(0.30, 0.85, bands);
    float facets = smoothstep(0.55, 0.85, sin(lon * 8.0 + flow * 3.0) * sin(lat * 12.0 + t * 0.3));
    float surfaceMod = mix(facets, bands, uStyleSeed);
    float surfaceMask = mix(0.78, 1.0, surfaceMod);

    vec3 viewDir = normalize(uCamPos - vWorldPos);
    float fres = 1.0 - max(dot(n, viewDir), 0.0);
    fres = pow(fres, 1.7);

    vec3 base = mix(uDeep * 0.55, uWarm * 0.62, flow * 0.7 + 0.3);
    base *= surfaceMask;
    base += fres * uAccent * (0.42 + uAudio * 0.45);
    base += uPulse * uAccent * 0.22;

    float alpha = fres * 0.78 + flow * 0.10 + 0.06;
    alpha = clamp(alpha, 0.08, 0.85);
    gl_FragColor = vec4(base, alpha);
  }
`;

const RING_FRAG = `
  varying vec2 vUv;
  uniform float uTime, uIntensity, uOffset, uStyleSeed, uDensity;
  uniform vec3  uGlyph, uAccent;
  float hash11(float n){ return fract(sin(n) * 43758.5453); }
  void main(){
    float u = vUv.x;
    float v = vUv.y;
    float halo_a = step(0.78, fract(u * 36.0 * uDensity + uOffset));
    float halo_b = step(0.92, fract(u * 90.0 * uDensity - uTime * 0.04 + uOffset));
    float halo_mark = max(halo_a * 0.75, halo_b * 0.85);
    float seg = floor(u * 24.0 * uDensity);
    float jitter = hash11(seg * 17.0 + uOffset * 11.0);
    float segStart = jitter * 0.55;
    float spice_a = step(segStart, fract(u * 24.0 * uDensity + uOffset)) *
                    step(fract(u * 24.0 * uDensity + uOffset), segStart + 0.18 + jitter * 0.12);
    float spice_b = step(0.85, fract(u * 70.0 * uDensity + uOffset));
    float spice_mark = max(spice_a * 0.85, spice_b * 0.5);
    float mark = mix(halo_mark, spice_mark, uStyleSeed);
    float micro = step(0.5, sin(u * 600.0)) * step(0.42, abs(v - 0.5)) * 0.25;
    mark = max(mark, micro);
    float edge = smoothstep(0.0, 0.15, v) * smoothstep(1.0, 0.85, v);
    float bodyAlpha = edge * 0.32 * uIntensity;
    float markAlpha = mark * edge * uIntensity;
    float alpha = max(bodyAlpha, markAlpha);
    vec3 col = mix(uGlyph * 0.72, uAccent * 1.25, mark);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
  }
`;

// ─ Torso silhouette envelope — copy from prototype ─────────────────────────
function insideTorso(x, y, z) {
  const r = Math.sqrt(x*x + z*z);
  if (y > 0.55 && y < 0.95) {
    const cy = 0.75, dy = y - cy;
    const maxR = Math.sqrt(Math.max(0, 0.045 - dy*dy)) * 1.05;
    return r < maxR && Math.abs(z) < 0.22;
  }
  if (y > 0.42 && y <= 0.55) return r < 0.13 && Math.abs(z) < 0.13;
  if (y > 0.10 && y <= 0.42) {
    const t = (0.42 - y) / 0.32;
    const maxX = 0.62 - t * 0.30, maxZ = 0.26 - t * 0.08;
    return Math.abs(x) < maxX && Math.abs(z) < maxZ && r < (0.62 - t * 0.25);
  }
  if (y > -0.6 && y <= 0.10) {
    const t = (0.10 - y) / 0.7;
    const maxX = 0.32 - t * 0.10, maxZ = 0.20 - t * 0.04;
    return Math.abs(x) < maxX && Math.abs(z) < maxZ;
  }
  return false;
}

// ─ Pre-build particle positions once (memoized) ────────────────────────────
function useSilhouettePositions() {
  return useMemo(() => {
    const N = 2600
    const home = new Float32Array(N * 3)
    const cur  = new Float32Array(N * 3)
    let i = 0
    while (i < N) {
      const x = (Math.random() - 0.5) * 1.4
      const y = (Math.random() * 1.9) - 0.9
      const z = (Math.random() - 0.5) * 0.7
      if (insideTorso(x, y, z)) {
        home[i*3]   = x * 0.74
        home[i*3+1] = y * 0.62 - 0.05
        home[i*3+2] = z * 0.74
        cur[i*3]   = home[i*3]
        cur[i*3+1] = home[i*3+1]
        cur[i*3+2] = home[i*3+2]
        i++
      }
    }
    return { home, cur, count: N }
  }, [])
}

// ─ Read CSS var for palette/env (data-universe on documentElement) ─────────
// Three-axis system uses data-universe; falls back to legacy data-palette
// so the orb keeps rendering during the cutover.
function useCurrentPalette() {
  const pickKey = () =>
    document.documentElement.dataset.universe
    || document.documentElement.dataset.palette
    || 'dune'
  const [palette, setPalette] = useState(pickKey)
  useEffect(() => {
    const obs = new MutationObserver(() => setPalette(pickKey()))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-universe', 'data-palette'],
    })
    return () => obs.disconnect()
  }, [])
  return palette
}

const _tmpWarm = new THREE.Color(), _tmpDeep = new THREE.Color();
const _tmpAccent = new THREE.Color(), _tmpGlyph = new THREE.Color(), _tmpSil = new THREE.Color();
const _errWarm = new THREE.Color(0x9a2030), _errAccent = new THREE.Color(0xff5060);

// ─ Inner orb mesh group — runs inside Canvas ───────────────────────────────
function OrbCore({ state, audioLevel, lipSyncOpen, palette }) {
  const groupRef = useRef()
  const vortexMatRef = useRef()
  const ringRefs = useRef([])
  const silhouetteRef = useRef()
  const dotsRef = useRef()
  const trackRef = useRef()
  const lightRef = useRef()

  const { mouse } = useThree()

  const { home, cur, count } = useSilhouettePositions()
  const audioSim = useRef(0)
  const audioVel = useRef(0)
  
  const morphSim = useRef(0)
  const morphVel = useRef(0)
  const errorSim = useRef(0)
  const errorVel = useRef(0)
  
  const orbState = STATE_MAP[state] || 'idle'
  const palData = PALETTES[palette]
  const tint = STATE_TINT[orbState]

  const vortexMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    uniforms: {
      uTime:      { value: 0 },
      uAudio:     { value: 0 },
      uPulse:     { value: 0 },
      uWarm:      { value: new THREE.Color(0xd4a040) },
      uDeep:      { value: new THREE.Color(0x6e3a16) },
      uAccent:    { value: new THREE.Color(0xffd28a) },
      uCamPos:    { value: new THREE.Vector3(0, 0, 6) },
      uSpeed:     { value: 1.0 },
      uStyleSeed: { value: 1.0 },
      uMorph:     { value: 0 },
      uError:     { value: 0 },
    },
  }), [])

  const ringSpecs = [
    { radius: 1.85, tube: 0.045, rx: Math.PI / 2,     ry: 0,            rz: 0,    density: 1.0, intensity: 0.9 },
    { radius: 2.05, tube: 0.030, rx: Math.PI / 2.3,   ry: 0.45,         rz: 0.4,  density: 1.4, intensity: 0.75 },
    { radius: 2.30, tube: 0.018, rx: Math.PI / 1.9,   ry: -0.6,         rz: 0.9,  density: 2.1, intensity: 0.55 },
    { radius: 1.65, tube: 0.022, rx: Math.PI / 2.5,   ry: Math.PI / 4,  rz: -0.3, density: 0.8, intensity: 0.7 },
  ];

  const dotN = 36;
  const dotPos = useMemo(() => {
    const pos = new Float32Array(dotN * 3);
    for (let k = 0; k < dotN; k++) {
      const ang = (k / dotN) * Math.PI * 2;
      const radius = 2.55;
      pos[k*3    ] = Math.cos(ang) * radius;
      pos[k*3 + 1] = Math.sin(ang * 2.0) * 0.08;
      pos[k*3 + 2] = Math.sin(ang) * radius;
    }
    return pos;
  }, []);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime
    const currentOrbState = STATE_MAP[state] || 'idle'
    const pal = PALETTES[palette]
    const tint = STATE_TINT[currentOrbState]

    // Audio simulation
    const driver = lipSyncOpen > 0 ? lipSyncOpen : audioLevel
    let target = 0;
    if (currentOrbState === 'listening')     target = 0.30 + Math.sin(t * 6.0) * 0.18 + Math.random() * 0.10;
    else if (currentOrbState === 'speaking') target = 0.42 + Math.sin(t * 10.0) * 0.22 + Math.sin(t * 6.0) * 0.14;
    else if (currentOrbState === 'thinking') target = 0.08 + Math.sin(t * 3.5) * 0.05;
    
    // If real audio is coming in, use it as a target floor/ceiling
    if (driver > 0) target = Math.max(target, driver * 0.8);
    
    // Spring physics for audio
    const stiffness = 0.15;
    const damping = 0.75;
    const accel = (target - audioSim.current) * stiffness;
    audioVel.current = (audioVel.current + accel) * damping;
    audioSim.current += audioVel.current;
    
    // Spring physics for morph (Thinking)
    const targetMorph = currentOrbState === 'thinking' ? 1.0 : 0.0;
    const mAccel = (targetMorph - morphSim.current) * 0.1;
    morphVel.current = (morphVel.current + mAccel) * 0.8;
    morphSim.current += morphVel.current;
    vortexMat.uniforms.uMorph.value = morphSim.current;
    
    // Spring physics for error (Error)
    const targetError = currentOrbState === 'error' ? 1.0 : 0.0;
    const eAccel = (targetError - errorSim.current) * 0.15;
    errorVel.current = (errorVel.current + eAccel) * 0.7;
    errorSim.current += errorVel.current;
    vortexMat.uniforms.uError.value = errorSim.current;

    // Apply Palette Lerps
    _tmpWarm.setHex(pal.warm);
    _tmpDeep.setHex(pal.deep);
    _tmpAccent.setHex(pal.accent);
    _tmpGlyph.setHex(pal.glyph);
    _tmpSil.setHex(pal.silhouette);
    if (tint.errorTint) {
      _tmpWarm.lerp(_errWarm, 0.55);
      _tmpAccent.lerp(_errAccent, 0.5);
      _tmpSil.lerp(_errWarm, 0.4);
    }
    vortexMat.uniforms.uWarm.value.lerp(_tmpWarm, 0.06);
    vortexMat.uniforms.uDeep.value.lerp(_tmpDeep, 0.06);
    vortexMat.uniforms.uAccent.value.lerp(_tmpAccent, 0.06);
    vortexMat.uniforms.uStyleSeed.value += (pal.glyphStyleSeed - vortexMat.uniforms.uStyleSeed.value) * 0.05;
    vortexMat.uniforms.uCamPos.value.copy(camera.position);
    vortexMat.uniforms.uTime.value = t;
    vortexMat.uniforms.uAudio.value = audioSim.current;
    vortexMat.uniforms.uSpeed.value = tint.speed;

    let pulse = 0;
    if (currentOrbState === 'idle')          pulse = Math.sin(t * 1.3) * 0.04;
    else if (currentOrbState === 'thinking') pulse = Math.sin(t * 3.5) * 0.12;
    else if (currentOrbState === 'error')    pulse = Math.sin(t * 14) * 0.05;
    vortexMat.uniforms.uPulse.value = pulse;

    if (silhouetteRef.current) {
      silhouetteRef.current.material.color.lerp(_tmpSil, 0.06);
      const positions = silhouetteRef.current.geometry.attributes.position;
      const arr = positions.array;
      const dispScale = currentOrbState === 'idle'      ? 0.012
                      : currentOrbState === 'listening' ? 0.018 + audioSim.current * 0.04
                      : currentOrbState === 'thinking'  ? 0.06  + Math.sin(t * 2.0) * 0.02
                      : currentOrbState === 'speaking'  ? 0.020 + audioSim.current * 0.06
                      : 0.025;
      for (let i = 0; i < count; i++) {
        const hx = home[i*3], hy = home[i*3+1], hz = home[i*3+2];
        const seed = i * 0.137;
        const dx = Math.sin(t * 0.7 + seed * 11.0 + hy * 4.0) * dispScale;
        const dy = Math.sin(t * 0.9 + seed * 13.0 + hx * 5.0) * dispScale * 1.2;
        const dz = Math.sin(t * 0.6 + seed * 17.0 + hz * 3.0) * dispScale;
        let ox = 0, oz = 0;
        if (currentOrbState === 'thinking') {
          const ang = t * 0.6 + seed * 6.28;
          ox = Math.cos(ang) * 0.025;
          oz = Math.sin(ang) * 0.025;
        }
        arr[i*3    ] = hx + dx + ox;
        arr[i*3 + 1] = hy + dy;
        arr[i*3 + 2] = hz + dz + oz;
      }
      positions.needsUpdate = true;
      const baseSize = currentOrbState === 'speaking' ? 0.030 : currentOrbState === 'thinking' ? 0.026 : 0.022;
      silhouetteRef.current.material.size = baseSize + audioSim.current * 0.018 + pulse * 0.01;
      silhouetteRef.current.material.opacity = 0.75 + audioSim.current * 0.2 + (currentOrbState === 'idle' ? -0.1 : 0.05);
    }

    ringRefs.current.forEach((r, i) => {
      if (!r) return;
      const dir = (i % 2 === 0) ? 1 : -1;
      r.rotation.z += 0.0025 * tint.speed * dir * (1 + i * 0.15);
      r.rotation.y += 0.0014 * tint.speed * dir;
      r.material.uniforms.uTime.value = t;
      r.material.uniforms.uGlyph.value.lerp(_tmpGlyph, 0.06);
      r.material.uniforms.uAccent.value.lerp(_tmpAccent, 0.06);
      r.material.uniforms.uStyleSeed.value += (pal.glyphStyleSeed - r.material.uniforms.uStyleSeed.value) * 0.05;
      const baseI = currentOrbState === 'idle' ? 0.55 : 0.85;
      r.material.uniforms.uIntensity.value = (baseI + audioSim.current * 0.4 + pulse * 0.5) * ringSpecs[i].intensity;
    });

    if (dotsRef.current) {
      dotsRef.current.rotation.y += 0.0028 * tint.speed;
      dotsRef.current.rotation.x = Math.sin(t * 0.3) * 0.08;
      dotsRef.current.material.color.lerp(_tmpAccent, 0.06);
      dotsRef.current.material.opacity = 0.4 + audioSim.current * 0.4 + (currentOrbState === 'thinking' ? 0.2 : 0);
      dotsRef.current.material.size = 0.05 + audioSim.current * 0.03 + pulse * 0.04;
    }

    if (trackRef.current) {
      trackRef.current.rotation.z += 0.0006;
      trackRef.current.material.color.lerp(_tmpAccent, 0.04);
    }

    if (groupRef.current) {
      // Spinning
      groupRef.current.rotation.y += 0.0008 * tint.speed;
      
      // Mouse magnetism
      groupRef.current.rotation.x += (mouse.y * 0.4 - groupRef.current.rotation.x) * 0.08;
      groupRef.current.rotation.y += (mouse.x * 0.4 - groupRef.current.rotation.y) * 0.08;
    }

    if (lightRef.current) {
      lightRef.current.color.copy(_tmpWarm);
      lightRef.current.intensity = 2.5 + audioSim.current * 3.0 + (currentOrbState === 'speaking' ? 1.5 : 0);
    }
  })

  return (
    <>
      <pointLight ref={lightRef} position={[0, 0, 0]} intensity={2.5} distance={10} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color={0x020202} roughness={0.15} metalness={0.9} transparent opacity={0.6} />
      </mesh>
      
      <group ref={groupRef}>
        <mesh material={vortexMat}>
          <icosahedronGeometry args={[1.45, 32]} />
        </mesh>
      <mesh>
        <icosahedronGeometry args={[0.95, 2]} />
        <meshBasicMaterial color={0x1a0e06} transparent opacity={0.55} />
      </mesh>
      <points ref={silhouetteRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[cur, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial size={0.024} transparent opacity={0.85}
          blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
      </points>
      
      {ringSpecs.map((spec, i) => (
        <mesh 
          key={i} 
          ref={el => ringRefs.current[i] = el}
          rotation={[spec.rx, spec.ry, spec.rz]}
        >
          <torusGeometry args={[spec.radius, spec.tube, 12, 320]} />
          <shaderMaterial 
            attach="material"
            transparent 
            side={THREE.DoubleSide} 
            depthWrite={false}
            vertexShader={`
              varying vec2 vUv;
              void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `}
            fragmentShader={RING_FRAG}
            uniforms={useMemo(() => ({
              uTime:      { value: 0 },
              uGlyph:     { value: new THREE.Color(0x8a5a28) },
              uAccent:    { value: new THREE.Color(0xffd28a) },
              uIntensity: { value: spec.intensity },
              uOffset:    { value: i * 1.7 },
              uStyleSeed: { value: 1.0 },
              uDensity:   { value: spec.density },
            }), [spec.intensity, spec.density, i])}
          />
        </mesh>
      ))}

      <points ref={dotsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dotPos, 3]} count={dotN} />
        </bufferGeometry>
        <pointsMaterial size={0.06} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      <mesh ref={trackRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.55, 0.004, 4, 256]} />
        <meshBasicMaterial color={0xd4a040} transparent opacity={0.15} />
      </mesh>
    </group>
    </>
  )
}

export default function RiverSong({ state, audioLevel = 0, lipSyncOpen = 0, compact = false }) {
  const palette = useCurrentPalette()
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <div className={`river-song-wrapper ${compact ? 'river-song-wrapper--compact' : ''}`}>
      <div className="river-song-scanlines" aria-hidden="true" />
      <div className="river-song-vignette"  aria-hidden="true" />
      
      {/* 1.5 dpr cap matches the Stage's canvas budget; MSAA is wasted
          through the EffectComposer's offscreen buffers and Bloom softens
          edges anyway. */}
      <Canvas
        camera={{ position: [0, 0.05, compact ? 5.8 : 7.2], fov: 38 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace }}
      >
        <OrbCore state={state} audioLevel={audioLevel} lipSyncOpen={lipSyncOpen} palette={palette} />
        <EffectComposer disableNormalPass>
          <Bloom
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            intensity={1.5}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
