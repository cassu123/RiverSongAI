import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './STLViewer.css'

export default function STLViewer({ url, scadCode, className = '', height = 360 }) {
  const mountRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [dimensions, setDimensions] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  
  const sceneRef = useRef(null)
  const meshRef = useRef(null)
  const controlsRef = useRef(null)
  const cameraRef = useRef(null)
  const materialRef = useRef(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    if (!url && !scadCode) return

    let cancelled = false
    setLoading(true)
    setError(null)
    // Drop the previous mesh's blob before loading the next one, so the
    // download button cannot hand back the old model while the new one is
    // still in flight. The revoke effect below frees it.
    setBlobUrl(null)

    const width = container.clientWidth || 400
    const currentHeight = height

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0f1d) // Slate deep
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75)
    scene.add(ambientLight)

    const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 1.3) // Sky cyan
    dirLight1.position.set(60, 100, 80)
    scene.add(dirLight1)

    const dirLight2 = new THREE.DirectionalLight(0xf43f5e, 0.7) // Rose rim
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

    // Authenticated load helper
    const loadMesh = async () => {
      try {
        const token = localStorage.getItem('rs-auth-token') || localStorage.getItem('token')
        const headers = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        let arrayBuffer = null
        let resolvedDownloadUrl = url

        // 1. If scadCode or raw code is provided, compile it first
        const rawCode = scadCode || (url && !url.startsWith('/') && !url.startsWith('http') && !url.endsWith('.stl') ? url : null)
        if (rawCode) {
          const compileRes = await fetch('/api/cad/compile', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            body: JSON.stringify({ scad_code: rawCode, name: 'custom_part' }),
          })
          if (!compileRes.ok) {
            const errJson = await compileRes.json().catch(() => ({}))
            throw new Error(errJson.detail || `Compilation failed (HTTP ${compileRes.status})`)
          }
          const compileData = await compileRes.json()
          if (compileData.error) {
            throw new Error(compileData.error)
          }
          resolvedDownloadUrl = compileData.download_url || `/api/cad/models/${compileData.model_id}/stl`
        }

        // 2. Fetch the binary STL. The Bearer header carries the credential;
        // the URL never does. Same-origin requests also send the access_token
        // cookie, which the server accepts as a fallback. A ?token= would leak
        // into access logs, history and Referer for a route family that
        // includes the sandbox executor.
        //
        // The header goes out only when the target is our own origin. `url` is
        // a prop and download_url comes off a response body, so neither is
        // guaranteed relative -- an absolute URL elsewhere would otherwise
        // hand that host the token.
        const absoluteUrl = new URL(resolvedDownloadUrl, window.location.origin)
        const sameOrigin = absoluteUrl.origin === window.location.origin
        const res = await fetch(absoluteUrl.href, { headers: sameOrigin ? headers : {} })
        if (!res.ok) {
          throw new Error(`Failed to load STL (HTTP ${res.status})`)
        }
        arrayBuffer = await res.arrayBuffer()

        if (cancelled) return

        // Create Blob URL for downloading
        const blob = new Blob([arrayBuffer], { type: 'model/stl' })
        const objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)

        // Parse with Three.js STLLoader
        const loader = new STLLoader()
        const geometry = loader.parse(arrayBuffer)
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
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading/compiling STL mesh:', err)
          setError(err.message || 'Could not load 3D mesh.')
          setLoading(false)
        }
      }
    }

    loadMesh()

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
      cancelled = true
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', handleResize)
      if (controlsRef.current) {
        controlsRef.current.dispose()
      }
      if (meshRef.current) {
        if (meshRef.current.geometry) meshRef.current.geometry.dispose()
        if (meshRef.current.material) meshRef.current.material.dispose()
      }
      if (materialRef.current) {
        materialRef.current.dispose()
      }
      renderer.dispose()
      if (container && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [url, scadCode, height])

  // The object URL backing the download button holds the whole STL in memory
  // until it is revoked. Without this, every re-render that reloads a mesh
  // (new url, recompiled scad, height change) strands the previous buffer for
  // the life of the document.
  useEffect(() => {
    if (!blobUrl) return
    return () => URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

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

  const effectiveDownloadUrl = blobUrl || url

  return (
    <div className={`rs-stl-viewer ${className}`}>
      {/* 3D Viewport Header */}
      <div className="rs-stl-header">
        <div className="rs-stl-title-group">
          <span className="rs-stl-status-dot" />
          <span className="rs-stl-title">
            3D CAD Viewport
          </span>
          {dimensions && (
            <span className="rs-stl-dimensions">
              {dimensions.x} × {dimensions.y} × {dimensions.z} mm
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="rs-stl-actions">
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            className={`rs-stl-btn ${autoRotate ? 'is-active' : ''}`}
            title="Toggle Auto Rotation"
          >
            <span className="material-symbols-rounded" style={{ fontSize: "1rem", verticalAlign: "-3px" }}>autorenew</span> Rotate
          </button>
          <button
            type="button"
            onClick={() => setWireframe(!wireframe)}
            className={`rs-stl-btn ${wireframe ? 'is-active' : ''}`}
            title="Toggle Wireframe"
          >
            <span className="material-symbols-rounded" style={{ fontSize: "1rem", verticalAlign: "-3px" }}>grid_on</span> Wireframe
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            className="rs-stl-btn"
            title="Reset Camera Position"
          >
            <span className="material-symbols-rounded" style={{ fontSize: "1rem", verticalAlign: "-3px" }}>filter_center_focus</span> Center
          </button>
          {effectiveDownloadUrl && (
            <a
              href={effectiveDownloadUrl}
              download="model.stl"
              className="rs-stl-download-btn"
              title="Download STL Binary for 3D Printing"
            >
              <span className="material-symbols-rounded" style={{ fontSize: "1rem", verticalAlign: "-3px" }}>download</span> STL
            </a>
          )}
        </div>
      </div>

      {/* 3D Canvas Canvas Mount */}
      <div ref={mountRef} className="rs-stl-canvas" style={{ height }} />

      {/* Loading Overlay */}
      {loading && (
        <div className="rs-stl-loading-overlay">
          <div className="rs-stl-spinner" />
          <span className="rs-stl-loading-text">Compiling & Rendering 3D Mesh…</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="rs-stl-error-overlay">
          <span className="rs-stl-error-title">⚠️ 3D Mesh Render Failed</span>
          <span className="rs-stl-error-msg">{error}</span>
          {effectiveDownloadUrl && (
            <a
              href={effectiveDownloadUrl}
              download="model.stl"
              className="rs-stl-error-btn"
            >
              Download Raw STL
            </a>
          )}
        </div>
      )}

      {/* Helper text on bottom */}
      <div className="rs-stl-helper">
        Drag to rotate &middot; Right-click to pan &middot; Scroll to zoom
      </div>
    </div>
  )
}


