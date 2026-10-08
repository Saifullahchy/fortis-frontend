# FORTIS — Unified Autonomy Command

FORTIS is a professional frontend prototype for a unified autonomous-vehicle command-and-control platform. It is intended to give operators one consistent environment for configuring, planning, monitoring, and coordinating heterogeneous autonomous systems.

## Product context

The platform is designed to support multiple vehicle domains from the same operational interface:

- UAV — unmanned aerial vehicles
- UGV — unmanned ground vehicles
- USV — unmanned surface vehicles
- UUV — unmanned underwater vehicles

Vehicle type, controller, protocol, and communication link are independent concepts. A vehicle may use MAVLink, ROS 2, DDS, RF, cellular, satellite, acoustic communications, or another future integration without changing the operator-facing product model.

Every connected asset is presented through the same core concepts:

```text
Vehicle
├── Capabilities
├── Components
├── Connection
├── Telemetry
├── Health
├── Commands
└── Missions
```

## What we are building

The target product combines:

- a God’s-eye tactical map for fleet awareness;
- vehicle-specific mission workspaces;
- point-by-point mission-area planning with editable boundaries;
- automatically generated coverage routes that follow the selected area;
- terrain, satellite, tactical, top-down, and 3D map modes;
- capability-driven dashboards for each vehicle class;
- setup, configuration, calibration, and diagnostics workflows;
- mission execution, telemetry, alerts, logs, and device management;
- a future integration boundary for AI-assisted planning and operations.

The intended operator flow is:

```text
Select vehicle
    ↓
Open that vehicle’s mission workspace
    ↓
Place boundary or waypoint points directly on the map
    ↓
Adjust mission parameters and validate the route
    ↓
Save a draft or reusable preset
    ↓
Execute and monitor the mission
```

Mission URLs identify the selected asset directly. For example, `/missions/UAV-002` opens the mission workspace for `UAV-002`, while `/missions` remains the vehicle-selection screen.

## Product areas

### Build

- Add and register vehicles
- Configure components and capabilities
- Validate configuration
- Calibrate sensors and control systems
- Run diagnostics

### Operate

- Select a vehicle
- Plan and save individual missions
- Use the tactical/terrain/satellite map
- Monitor telemetry, video, health, and connectivity
- Control mission execution

### Manage

- Fleet state
- Device registry
- Alerts and logs
- Users, roles, and settings
- Software and firmware status

## Current prototype scope

This version is a UI/UX simulation backed by typed mock data. Commands are not connected to physical hardware. The architecture separates server-like data, client application state, map rendering, and simulation behavior so mock services can later be replaced by real APIs and edge connections without redesigning the UI.

Implemented prototype capabilities include:

- vehicle selection and vehicle-specific mission routes;
- Cesium-based map modes;
- interactive UAV survey planning;
- point-by-point boundary creation and draggable control points;
- edge-clipped coverage paths with curved turns;
- reusable mission presets and editable flight parameters;
- vehicle dashboards, configuration, calibration, diagnostics, fleet, alerts, and logs;
- simulation-only mission controls.

## Architecture principles

- Model capabilities instead of hardcoding behavior by vehicle class.
- Keep vehicle type independent from controller, protocol, and link.
- Consume server-like data through RTK Query.
- Use Redux only for application-wide client state.
- Keep short-lived editing interactions local to their feature.
- Keep map and tactical-symbol implementations behind abstractions.
- Preserve strict TypeScript domain models.
- Keep simulation code replaceable by real telemetry and command services.

## Technology

- React
- Vite
- TypeScript
- React Router
- Redux Toolkit and RTK Query
- CesiumJS
- React Flow
- Lucide and Phosphor icons
- Prettier

## Local development

```bash
npm install
npm run dev -- --port 4180
```

Production verification:

```bash
npm run format:check
npm run build
```
# fortis
