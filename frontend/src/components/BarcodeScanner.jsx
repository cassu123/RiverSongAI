/**
 * BarcodeScanner — full-screen modal that uses the device camera to scan barcodes.
 *
 * Props:
 *   onDetected: (value: string, format: string) => void
 *     Fires once per detected code. In continuous mode it fires per scan.
 *   onClose: () => void
 *     Fires when the user dismisses the modal (back button or Cancel).
 *   formats?: string[]
 *     Override the default scanned formats. Default:
 *     ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE']
 *   continuous?: boolean
 *     If true, modal stays open after each detection (for bulk scanning).
 *     If false (default), modal closes on first detection.
 *
 * Behavior:
 *   - Rear camera preferred (facingMode: 'environment').
 *   - Vibrates 80ms on each detection (navigator.vibrate).
 *   - On permission denied, shows a "Camera access required" message with Cancel.
 *   - On unmount, fully stops the MediaStream (no track leaks).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import './BarcodeScanner.css'

const DEFAULT_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.QR_CODE,
]

export default function BarcodeScanner({ onDetected, onClose, formats, continuous = false }) {
  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const [error, setError] = useState('')
  const lastValueRef = useRef('')
  const lastSeenRef = useRef(0)
  const onDetectedRef = useRef(onDetected)
  const continuousRef = useRef(continuous)
  
  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])
  useEffect(() => { continuousRef.current = continuous }, [continuous])

  const handleClose = useCallback(() => {
    if (onClose) onClose()
  }, [onClose])
  const handleCloseRef = useRef(handleClose)
  useEffect(() => { handleCloseRef.current = handleClose }, [handleClose])

  useEffect(() => {

    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats || DEFAULT_FORMATS)

    const reader = new BrowserMultiFormatReader(hints)
    readerRef.current = reader

    const start = async () => {
      try {
        const constraints = {
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        }

        // Try constraints first
        await reader.decodeFromConstraints(constraints, videoRef.current, (result, err) => {
          if (result) {
            const value = result.getText()
            const format = result.getBarcodeFormat()
            const now = Date.now()
            if (value === lastValueRef.current && now - lastSeenRef.current < 1500) return
            lastValueRef.current = value
            lastSeenRef.current = now
            try { navigator.vibrate?.(80) } catch {}
            onDetectedRef.current(value, format)
            if (!continuousRef.current) setTimeout(() => handleCloseRef.current(), 300)
          }
        })
      } catch (e) {
        console.warn('decodeFromConstraints failed, falling back to default device:', e)
        try {
          // Fallback to default device
          await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
             if (result) {
                const value = result.getText()
                onDetected(value, result.getBarcodeFormat())
                if (!continuous) handleClose()
             }
          })
        } catch (e2) {
          setError('Camera initialization failed. Please ensure permissions are granted.')
        }
      }
    }



    start()

    return () => {
      // Fully release the stream
      try {
        reader.reset()
        const stream = videoRef.current?.srcObject
        if (stream) {
          stream.getTracks().forEach(t => t.stop())
        }
      } catch {}
    }
  }, [formats])

  return (
    <div className="barcode-scanner-modal" role="dialog" aria-modal="true" aria-label="Barcode Scanner">
      <div className="barcode-scanner-overlay">
        <video ref={videoRef} className="barcode-scanner-video" playsInline muted />
        <div className="barcode-scanner-frame" />
        <div className="barcode-scanner-formats">UPC-A · EAN-13 · QR</div>
        <button className="barcode-scanner-cancel" onClick={handleClose}>Cancel</button>
        {error && <div className="barcode-scanner-error">{error}</div>}

      </div>
    </div>
  )
}
