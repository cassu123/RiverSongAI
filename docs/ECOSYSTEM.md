# River Song AI Ecosystem — Program Reference

**Subtitle:** Responsive Intelligent Virtual Environment for Recognition, Scheduling, Organization, and Networked Governance
**Version:** 1.0
**Classification:** Personal
**Web:** riversongai.com
**Source of truth:** `River_Song_Ecosystem_Reference.docx` (Google Drive). This file mirrors that doc so the master architecture lives in version control. If the two disagree, the Drive document wins; sync this file when the Drive version changes.

---

## Ecosystem Overview

River Song is a personal AI ecosystem — a unified intelligence layer that connects, commands, and coordinates a fleet of hardware and software systems across the home, yard, vehicles, and beyond. It is not a single product. It is an architecture.

River Song serves as the **core brain**. Every sub-program registers to River Song, receives commands from River Song, and reports telemetry back to River Song. The goal is a seamless, voice-driven, locally-hosted AI that manages daily life autonomously.

### The Seven Programs

| Program | Domain | One Line |
|---|---|---|
| **River Song** | Core AI Brain | The intelligence that commands everything |
| **River Vortex** | Smart Home Hubs | Physical voice/display devices throughout the home |
| **River Vector** | Autonomous Mowers | Self-driving lawn mower fleet |
| **River Horizon** | Drone Fleet | Autonomous and remote-controlled drones |
| **River Vexa** | Vehicle Integration | AI co-pilot for cars and motorcycles |
| **River Sentinel** | Robot Dogs | Free-roaming autonomous quadruped patrol robots |
| **River Kova** | Chore Robots | Household task automation robots |

---

## River Song — Core AI

The central intelligence of the entire ecosystem. Locally-hosted AI assistant running on a dedicated server, accessible via web interface and physical hub devices. Processes voice commands, coordinates all sub-programs, manages schedules, monitors telemetry, and serves as the single source of truth for the ecosystem.

### Primary Functions

- Natural language voice and text command processing
- Device registry — tracks all connected units across all sub-programs
- Intent routing — receives a command and dispatches to the correct sub-program
- Scheduling and routine automation
- Weather monitoring — gates all outdoor autonomous operations
- Push notifications and alerts across all programs
- Smart home automation via Home Assistant middleware
- Telemetry aggregation from all connected devices

### Tech Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI (Python 3.11+) |
| Frontend | React + Vite |
| Database | Firebase Firestore |
| Auth | Firebase Auth |
| LLM | Ollama (local) |
| Speech-to-Text | Whisper (local) |
| Text-to-Speech | Piper (local) |
| Smart Home | Home Assistant |
| Hosting | riversongai.com |
| Security | WireGuard VPN |

### Server

- Hostname: `riversongai.com` — primary web interface
- Local server: ASUS Sabertooth 990FX, AMD FX-8350, GTX 1050 Ti, 32 GB RAM, Ubuntu 26.04 LTS
- All AI processing runs locally — no data sent to cloud

---

## River Vortex — Smart Home Hub Hardware

Dedicated touchscreen and voice devices placed throughout the home that give River Song a physical presence in every room. Conceptually similar to Google Home Hub but locally hosted, fully customized, and integrated into the River Song ecosystem.

### Primary Functions

- Always-on wake word detection — local processing, no cloud audio
- Voice interface to River Song from any room
- Ambient display — clock, weather, device status, notifications
- Touchscreen control of all ecosystem devices
- Live camera feed viewing on demand
- Intercom between Vortex units in different rooms
- Home Assistant device control — lights, thermostat, locks, cameras
- 4G LTE fallback if home WiFi fails

### Hardware Platform

| Component | Choice |
|---|---|
| Compute | Raspberry Pi 4 or Pi 5 |
| Display | 7" or 10" touchscreen |
| Microphone | USB mic array or ReSpeaker HAT |
| Audio | 3.5mm or USB speaker |
| Wake Word | Porcupine (local, no cloud) |
| Connectivity | WiFi + optional 4G LTE |
| Frontend | React (kiosk mode browser) |
| Backend | FastAPI (Python 3.11+) |

### Voice Command Flow

Vortex mic detects wake word locally → streams audio to River Song → River Song processes and responds → Vortex speaker plays response. **Audio never leaves the local network without explicit user command.**

---

## River Vector — Autonomous Lawn Mower Fleet

Controls a fleet of riding lawn mowers retrofitted with sensors, actuators, cameras, GPS, and compute hardware to enable fully autonomous mowing **while retaining complete manual drive capability at all times**.

### First Unit — Voyager

| Component | Spec |
|---|---|
| Platform | Yard Machines 7-Speed Shift-On-The-Go riding mower |
| Transmission | 7-speed manual — clutch sequencing automated |
| Deck | 42" cutting deck |
| Compute | Raspberry Pi 5 + Pi Pico |
| Navigation | ArduSimple RTK2B GPS (±2 cm accuracy) |
| Cameras | 5 total — front center, front left/right 45°, rear left/right bag |
| Sensors | 2× HC-SR04 ultrasonic (front/rear), IMU, fuel, temp, RPM, voltage |
| Display | Nextion 3.5" weatherproof touchscreen operator panel |
| Connectivity | 4G LTE + WireGuard VPN |
| Parking | ArUco marker precision docking |

### Primary Functions

- Fully autonomous mowing within GPS-defined boundary
- Manual drive mode — always available via AUTO/MANUAL toggle
- Obstacle detection and avoidance — ultrasonic + camera
- Precision parking via ArUco marker and front camera pose estimation
- Remote start via River Song voice command
- Real-time telemetry — fuel, engine temp, RPM, battery voltage
- Weather-gated operation — River Song checks conditions before launch
- Live camera streaming on demand via 4G
- Push notifications — mow complete, obstacle detected, fault state

### Safety Systems

- Physical e-stop mushroom button — cuts all power immediately
- AUTO/MANUAL toggle — instant human control handoff
- Deck lift kill switch — blades off if deck raises during operation
- Seat occupancy sensor — autonomous suspend if seat occupied
- Geofence lock — autonomous mode disabled outside property boundary
- Amber SAE J845 beacon — active during autonomous operation
- RGB LED status strips front and rear — mode indicators
- Audible buzzer — mode transition alerts

### Future Unit — Kepler

Second unit planned on a hydrostatic or CVT platform. Kepler will serve as the precision navigation reference unit for the fleet.

---

## River Horizon — Autonomous and Remote-Controlled Drone Fleet

Manages multiple unmanned aerial vehicles capable of fully autonomous waypoint-based flight and manual remote control via web interface. Integrates with River Song for voice commands, scheduling, and live monitoring.

### Primary Functions

- Fully autonomous waypoint-based flight missions
- Manual remote control via web browser interface
- Live video feed streaming from multiple drones simultaneously
- Fleet management — multiple units from single River Song dashboard
- River Song voice commands — launch, waypoint navigation, return home
- 4G LTE telemetry and control
- Automatic return to home on low battery or signal loss
- Geofence enforcement — drone cannot leave defined boundary

### Tech Stack

| Layer | Choice |
|---|---|
| Flight Controller | Pixhawk or BetaFlight FC |
| Companion Computer | Raspberry Pi Zero 2W or Pi 5 |
| Protocol | MAVLink |
| Software | DroneKit or MAVSDK |
| Vision | OpenCV |
| Backend | FastAPI (Python 3.11+) |
| Connectivity | 4G LTE + WireGuard VPN |

### Safety Systems

- Geofence enforced at all times — hard boundary
- Return to home on low battery, signal loss, or geofence breach
- Signal watchdog — automatic failsafe on connection loss

---

## River Vexa — Vehicle Integration

A River Song-powered alternative to Android Auto that works with both cars and motorcycles. Rides with you, providing voice-controlled AI assistance, navigation, diagnostics, and full River Song ecosystem access while in motion.

### Vehicle Fleet

| Unit | Vehicle |
|---|---|
| Unit 1 | 2026 Honda Rebel 500 SE (motorcycle) |
| Unit 2 | 2024 CFMoto Papio SS (motorcycle) |
| Unit 3 | 2015 Buick Verano 2.4L (car — OBD-II diagnostics) |

### Primary Functions

- Voice control via River Song AI while driving — hands free
- Real-time OBD-II diagnostics for the Verano — live fault codes and data
- Navigation with River Song integration
- River Song ecosystem access while driving — check mower status, home devices
- Motorcycle-specific alerts — weather, high wind, temperature extremes
- Trip data logging — speed, route, fuel consumption
- Music, calls, notifications — all hands free

### Tech Stack

| Layer | Choice |
|---|---|
| Android App | Kotlin + Jetpack |
| Backend | FastAPI (Python 3.11+) |
| OBD-II | ELM327 Bluetooth adapter |
| Voice | Whisper STT + Piper TTS via River Song |
| Navigation | OpenStreetMap + Mapbox |
| Connectivity | Bluetooth, WiFi, 4G LTE |

### Safety Note

Voice is the primary input while in motion. Screen interaction is minimal while vehicle is moving. River Song handles all AI processing — Vexa is the vehicle interface layer only.

---

## River Sentinel — Autonomous Quadruped Fleet

Controls a fleet of free-roaming robot dogs capable of autonomous patrol, monitoring, terrain navigation, and River Song ecosystem integration. Sentinel units operate within defined boundaries and return to base automatically.

### Primary Functions

- Autonomous patrol with defined property boundaries
- Obstacle avoidance and terrain navigation
- Live onboard camera feed — accessible on demand
- River Song voice commands — dispatch, recall, patrol assignment
- Coordinated multi-unit patrol (future capability)
- Return to base on low battery or fault
- Real-time telemetry — battery, position, status

### Tech Stack

| Layer | Choice |
|---|---|
| Compute | Raspberry Pi 5 + Pi Pico |
| Framework | ROS2 Humble |
| Vision | OpenCV |
| Backend | FastAPI (Python 3.11+) |
| Navigation | GPS + ROS2 Nav2 |
| Connectivity | 4G LTE + WireGuard VPN |
| Telemetry | InfluxDB + Grafana |

### Safety Systems

- Geofence enforced at all times
- Return to base on low battery or fault state
- Physical e-stop capability
- Watchdog — kills autonomy if compute hangs

---

## River Kova — Household Chore Robots

Controls a fleet of robots that perform household tasks autonomously — cleaning, fetching, organizing. Kova units navigate the home via room mapping, recognize objects via computer vision, and execute tasks on River Song voice commands or scheduled routines.

### Primary Functions

- Autonomous chore execution — cleaning, fetching, organizing
- Room mapping and path planning
- Object recognition and manipulation via computer vision
- River Song voice commands — assign tasks, check status, recall unit
- Task scheduling and prioritization queue
- Multi-unit coordination — different rooms simultaneously
- Live camera feed and status monitoring
- Return to base on task completion or low battery

### Tech Stack

| Layer | Choice |
|---|---|
| Compute | Raspberry Pi 5 + Pi Pico |
| Robotics | ROS2 Humble + MoveIt (arm control) |
| Vision | OpenCV + MediaPipe |
| Backend | FastAPI (Python 3.11+) |
| Connectivity | WiFi + WireGuard VPN |
| Telemetry | InfluxDB |

### Safety Systems

- Human detection — immediate stop if human within 1 meter
- Collision avoidance enforced at all times
- Physical e-stop capability
- Watchdog — kills autonomy if compute hangs

**Human safety is the absolute top priority for River Kova.** The unit stops all motion immediately upon detecting a human within the defined safety radius.

---

## Fleet Naming Convention

Each River Song sub-program manages a fleet of named units. **Units are named individually — they are crew members, not serial numbers.** The naming format is:

```
PROGRAM NAME — Unit Name
```

### Current Fleet Roster

| Program | Unit Name | Platform / Notes |
|---|---|---|
| River Vector | Voyager | Yard Machines 7-Speed — Unit 01, incoming |
| River Vector | Kepler | Future — CVT or hydrostatic platform |
| River Horizon | TBD | First drone unit — pending build |
| River Sentinel | TBD | First quad unit — pending build |
| River Kova | TBD | First chore unit — pending build |

---

*River Song Ecosystem // Version 1.0 // riversongai.com*
