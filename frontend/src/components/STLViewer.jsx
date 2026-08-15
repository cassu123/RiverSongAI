import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export default function STLViewer({ url, className = '', height = 360 }) {
  const mountRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [dimensions, setDimensions] = useState(null)
  
  const sceneRef = useRef(null)
  const meshRef = useRef(null)
  const controlsRef = useRef(null)
  const cameraRef = useRef(null)
  const materialRef = useRef(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container || !url) return

    setLoading(true)
    setError(null)

    const width = container.clientWidth || 400
    const currentHeight = height

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f172a) // Slate-900
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / currentHeight, 0.1, 1000)
    camera.position.set(0, 50, 100)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, currentHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = 2.0
    controlsRef.current = controls

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
    scene.add(ambientLight)

    const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 1.2) // Sky cyan
    dirLight1.position.set(60, 100, 80)
    scene.add(dirLight1)

    const dirLight2 = new THREE.DirectionalLight(0xf43f5e, 0.6) // Rose rim
    dirLight2.position.set(-60, -50, -80)
    scene.add(dirLight2)

    // Grid Floor
    const grid = new THREE.GridHelper(120, 24, 0x0284c7, 0x1e293b)
    grid.position.y = 0
    scene.add(grid)

    // Material
    const material = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      metalness: 0.25,
      roughness: 0.45,
      wireframe: wireframe,
    })
    materialRef.current = material

    // Load STL
    const loader = new STLLoader()
    loader.load(
      url,
      (geometry) => {
        geometry.computeVertexNormals()
        geometry.center()

        // Compute Bounding Box
        geometry.computeBoundingBox()
        const bbox = geometry.boundingBox
        if (bbox) {
          const size = new THREE.Vector3()
          bbox.getSize(size)
          setDimensions({
            x: Math.round(size.x * 10) / 10,
            y: Math.round(size.y * 10) / 10,
            z: Math.round(size.z * 10) / 10,
          })

          // Adjust camera to frame model nicely
          const maxDim = Math.max(size.x, size.y, size.z)
          const fov = camera.fov * (Math.PI / 180)
          let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.2
          cameraZ = Math.max(cameraZ, 40)
          camera.position.set(cameraZ * 0.7, cameraZ * 0.6, cameraZ)
          camera.lookAt(0, 0, 0)
          controls.target.set(0, 0, 0)
          controls.update()

          // Offset mesh to sit on grid floor
          const mesh = new THREE.Mesh(geometry, material)
          mesh.position.y = size.y / 2
          grid.position.y = 0
          mesh.castShadow = true
          mesh.receiveShadow = true
          scene.add(mesh)
          meshRef.current = mesh
        }

        setLoading(false)
      },
      undefined,
      (err) => {
        console.error('Error loading STL mesh:', err)
        setError('Could not load 3D mesh.')
        setLoading(false)
      }
    )

    // Animation Loop
    let animationId
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize Handler
    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth
      camera.aspect = w / currentHeight
      camera.updateProjectionMatrix()
      renderer.setSize(w, currentHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [url, height])

  // Update wireframe state
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.wireframe = wireframe
    }
  }, [wireframe])

  // Update autoRotate state
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate
    }
  }, [autoRotate])

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(60, 60, 80)
      controlsRef.current.target.set(0, 10, 0)
      controlsRef.current.update()
    }
  }

  return (
    <div className={`relative my-4 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl ${className}`}>
      {/* 3D Viewport Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            3D CAD Viewport
          </span>
          {dimensions && (
            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/60">
              {dimensions.x} × {dimensions.y} × {dimensions.z} mm
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              autoRotate ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle Auto Rotation"
          >
            🔄 Rotate
          </button>
          <button
            type="button"
            onClick={() => setWireframe(!wireframe)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              wireframe ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Toggle Wireframe"
          >
            🕸️ Wireframe
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            className="px-2 py-1 text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 rounded transition-colors"
            title="Reset Camera Position"
          >
            🎯 Center
          </button>
          <a
            href={url}
            download
            className="px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors flex items-center gap-1 shadow-sm"
            title="Download STL Binary for 3D Printing"
          >
            💾 STL
          </a>
        </div>
      </div>

      {/* 3D Canvas Canvas Mount */}
      <div ref={mountRef} className="w-full relative cursor-grab active:cursor-grabbing" style={{ height }} />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-cyan-400">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Compiling & Rendering 3D Mesh…</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center">
          <span className="text-sm text-red-400 font-semibold mb-1">⚠️ 3D Mesh Render Failed</span>
          <span className="text-xs text-slate-400 font-mono mb-3">{error}</span>
          <a
            href={url}
            download
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700"
          >
            Download Raw STL
          </a>
        </div>
      )}

      {/* Helper text on bottom */}
      <div className="absolute bottom-2 left-3 pointer-events-none text-[10px] font-mono text-slate-400 bg-slate-950/70 px-2 py-0.5 rounded backdrop-blur-xs">
        🖱️ Drag to rotate • Right-click to pan • Scroll to zoom
      </div>
    </div>
  )
}
