// =============================================================================
// frontend/src/components/RiverAvatar.jsx
//
// 3D VRM avatar for River Song — a drop-in replacement for <RiverSong />.
//
// Takes the same props the orb does (state, audioLevel, lipSyncOpen, compact),
// so anywhere the orb renders, this can render instead.
//
// Everything runs in the browser on the device. The server sends the same
// audio it already sends; no GPU work is added server-side, which matters
// when hub devices are Raspberry Pis and the server has one small card.
//
// No VRM file present? It falls back to the orb rather than showing an empty
// canvas. Put a model at public/models/river.vrm to switch over — free
// rigged models are on VRoid Hub and BOOTH, no modelling required.
// =============================================================================

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'

import RiverSong from './RiverSong.jsx'

// Where the model lives. Override with VITE_RIVER_AVATAR_URL to swap models
// without touching code.
const AVATAR_URL =
  import.meta.env?.VITE_RIVER_AVATAR_URL || '/models/river.vrm'

// Conversation states, collapsed to the four the avatar actually performs.
// Mirrors STATE_MAP in RiverSong.jsx so both stay in step.
const STATE_MAP = {
  idle: 'idle',
  connecting: 'thinking',
  listening: 'listening',
  transcribing: 'thinking',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'error',
}

// Facial expression per state. Values are VRM preset expression names.
// Deliberately understated — a face holding a big expression reads as a mask.
const STATE_EXPRESSION = {
  idle: { name: 'neutral', weight: 1.0 },
  listening: { name: 'relaxed', weight: 0.35 },
  thinking: { name: 'relaxed', weight: 0.2 },
  speaking: { name: 'happy', weight: 0.15 },
  error: { name: 'sad', weight: 0.4 },
}

// Blink timing. Humans blink every 2-8 seconds; perfectly regular blinking
// is one of the strongest "this is a puppet" signals, so the interval is
// re-rolled after each one.
const BLINK_MIN_S = 2.0
const BLINK_MAX_S = 7.0
const BLINK_DURATION_S = 0.12

// Lip sync. Vowel shapes are cycled while speaking rather than driving one
// open-mouth shape: a jaw that only opens and closes looks like a puppet,
// and cycling between aa/ih/ou reads as speech without needing real phoneme
// detection.
const VISEMES = ['aa', 'ih', 'ou']
const VISEME_HOLD_S = 0.09

function randomBlinkDelay() {
  return BLINK_MIN_S + Math.random() * (BLINK_MAX_S - BLINK_MIN_S)
}

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

function VRMModel({ url, state, audioLevel, lipSyncOpen, onError }) {
  const [vrm, setVrm] = useState(null)
  const { camera } = useThree()

  const blink = useRef({ next: randomBlinkDelay(), elapsed: 0, closing: 0 })
  const viseme = useRef({ index: 0, held: 0 })
  const clock = useRef(0)
  const smoothedMouth = useRef(0)

  useEffect(() => {
    let cancelled = false
    let loaded = null

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return
        const model = gltf.userData.vrm
        if (!model) {
          onError(new Error('File loaded but contains no VRM data'))
          return
        }

        // Strip unused vertices/joints and disable frustum culling. Without
        // this the avatar can vanish at close camera distances, because the
        // culler tests the untransformed bounding box rather than the posed
        // one.
        VRMUtils.removeUnnecessaryVertices(model.scene)
        VRMUtils.combineSkeletons(model.scene)
        model.scene.traverse((obj) => { obj.frustumCulled = false })

        // VRM 0.x models face away from the viewer; 1.0 faces toward. Rotate
        // the older ones so both look at the camera.
        if (model.meta?.metaVersion === '0') {
          VRMUtils.rotateVRM0(model)
        }

        if (model.lookAt) model.lookAt.target = camera

        loaded = model
        setVrm(model)
      },
      undefined,
      (err) => { if (!cancelled) onError(err) },
    )

    return () => {
      cancelled = true
      // Free GPU memory on unmount. Without this, navigating between pages
      // leaks a full character model each time.
      if (loaded) VRMUtils.deepDispose(loaded.scene)
    }
  }, [url, camera, onError])

  useFrame((_, delta) => {
    if (!vrm) return

    const dt = Math.min(delta, 0.1)   // clamp after a tab-switch stall
    clock.current += dt

    const performed = STATE_MAP[state] || 'idle'
    const expressions = vrm.expressionManager

    if (expressions) {
      // --- expression -----------------------------------------------------
      for (const preset of ['neutral', 'relaxed', 'happy', 'sad', 'angry']) {
        expressions.setValue(preset, 0)
      }
      const mood = STATE_EXPRESSION[performed] || STATE_EXPRESSION.idle
      expressions.setValue(mood.name, mood.weight)

      // --- blink ----------------------------------------------------------
      const b = blink.current
      b.elapsed += dt
      if (b.closing > 0) {
        b.closing -= dt
        // Triangle wave: shut and open again over BLINK_DURATION_S.
        const phase = 1 - Math.abs((b.closing / BLINK_DURATION_S) * 2 - 1)
        expressions.setValue('blink', Math.max(0, Math.min(1, phase)))
      } else if (b.elapsed >= b.next) {
        b.elapsed = 0
        b.next = randomBlinkDelay()
        b.closing = BLINK_DURATION_S
      } else {
        expressions.setValue('blink', 0)
      }

      // --- mouth ----------------------------------------------------------
      for (const v of VISEMES) expressions.setValue(v, 0)

      if (performed === 'speaking') {
        // lipSyncOpen is the server-driven signal; audioLevel is the fallback
        // when only a level meter is available.
        const target = Math.max(lipSyncOpen || 0, (audioLevel || 0) * 0.8)
        // Smoothing stops the jaw snapping on every frame — raw amplitude is
        // far too jittery to drive a face directly.
        smoothedMouth.current += (target - smoothedMouth.current) * 0.35

        const m = viseme.current
        m.held += dt
        if (m.held >= VISEME_HOLD_S) {
          m.held = 0
          m.index = (m.index + 1) % VISEMES.length
        }
        expressions.setValue(
          VISEMES[m.index],
          Math.max(0, Math.min(1, smoothedMouth.current)),
        )
      } else {
        smoothedMouth.current = 0
      }
    }

    // --- idle motion --------------------------------------------------------
    // The part that actually sells "alive". A still model reads as dead even
    // when the face is animating.
    const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
    const spine = vrm.humanoid?.getNormalizedBoneNode('spine')
    const chest = vrm.humanoid?.getNormalizedBoneNode('chest')

    const t = clock.current
    if (hips) {
      hips.position.y = Math.sin(t * 1.1) * 0.006          // weight shift
      hips.rotation.y = Math.sin(t * 0.31) * 0.04          // slow sway
    }
    if (spine) {
      spine.rotation.x = Math.sin(t * 0.9) * 0.012         // breathing
    }
    if (chest) {
      // Thinking gets a slight forward lean; listening leans back a touch.
      const lean =
        performed === 'thinking' ? 0.05 :
        performed === 'listening' ? -0.03 : 0
      chest.rotation.x += (lean - chest.rotation.x) * 0.05
    }

    vrm.update(dt)
  })

  if (!vrm) return null
  return <primitive object={vrm.scene} />
}

// -----------------------------------------------------------------------------
// Scene
// -----------------------------------------------------------------------------

function Scene({ state, audioLevel, lipSyncOpen, onError }) {
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[1.5, 2.5, 2]} intensity={1.6} />
      {/* Rim light from behind separates the silhouette from a dark UI. */}
      <directionalLight position={[-2, 1.5, -2]} intensity={0.5} color="#88aaff" />
      <VRMModel
        url={AVATAR_URL}
        state={state}
        audioLevel={audioLevel}
        lipSyncOpen={lipSyncOpen}
        onError={onError}
      />
    </>
  )
}

// -----------------------------------------------------------------------------
// Public component
// -----------------------------------------------------------------------------

export default function RiverAvatar({
  state,
  audioLevel = 0,
  lipSyncOpen = 0,
  compact = false,
}) {
  const [mounted, setMounted] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const handleError = useMemo(() => (err) => {
    // A missing or broken model must not leave a blank panel where River
    // should be. Fall back to the orb, which always works.
    console.warn(
      `[RiverAvatar] Could not load ${AVATAR_URL}; falling back to the orb.`,
      err,
    )
    setFailed(true)
  }, [])

  if (!mounted) return null

  if (failed) {
    return (
      <RiverSong
        state={state}
        audioLevel={audioLevel}
        lipSyncOpen={lipSyncOpen}
        compact={compact}
      />
    )
  }

  return (
    <div className={`river-song-wrapper ${compact ? 'river-song-wrapper--compact' : ''}`}>
      <div className="river-song-scanlines" aria-hidden="true" />
      <div className="river-song-vignette" aria-hidden="true" />

      <Canvas
        camera={{ position: [0, 1.35, compact ? 1.1 : 1.5], fov: 30 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace }}
      >
        <Suspense fallback={null}>
          <Scene
            state={state}
            audioLevel={audioLevel}
            lipSyncOpen={lipSyncOpen}
            onError={handleError}
          />
        </Suspense>
        <EffectComposer disableNormalPass>
          <Bloom
            luminanceThreshold={0.6}
            luminanceSmoothing={0.9}
            intensity={0.5}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
