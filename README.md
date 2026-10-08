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

Mission URLs identify the selected asset directly. For example, `/missions/UAV-002` opens the mission workspace for `UAV-002`, while `/missions` is the fleet-wide mission board and vehicle-selection screen. `/vehicles/UGV-001` opens that vehicle's live operations workspace.

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

- a fleet-wide mission board (`/missions`) with live state, progress, ETA and distance per mission;
- vehicle selection and vehicle-specific mission routes;
- Cesium-based map modes;
- one profile-driven planner for every vehicle class: survey / point-to-point / encircle /
  maneuver for UAVs, route / patrol / coverage for UGVs and USVs, transect / loop for UUVs;
- point-by-point boundary creation and draggable control points;
- edge-clipped coverage paths with curved turns;
- reusable mission presets and editable, class-specific parameters (altitude, overlap and return
  altitude in the air; cruise speed, dwell, acceptance radius and grade limit on the ground);
- pre-mission checks that block upload (battery and reserve, link, health, altitude or terrain
  grade along the route, speed limits);
- one live operations workspace for UAVs, UGVs and USVs: 3D view with tracking HUD, payload feed,
  attitude indicator or inclinometer, class-specific commands, alerts, telemetry strip and a
  mission timeline;
- street routing for ground vehicles (the UGV planner's Street mode): the road network and
  building footprints are fetched from OpenStreetMap in tiles that follow the map view (the
  planning grid always loads; panning or zooming in loads what is on screen), the operator places
  targets, and the rover plans its own way along the streets (allowed way classes, quiet-street
  preference and an off-street approach limit are configurable); every building is an obstacle,
  the final approach steers around them, and roads, footprints and a street basemap are drawn in
  both the planner and the live view;
- ground coverage that respects the city: for a UGV coverage area the planner sweeps every
  street inside the area (buildings untouched, with the share of street reachable reported), or,
  on open ground, runs a lawnmower sweep clipped around the map's building footprints; the style
  is picked automatically and can be forced either way;
- ground and surface routes that obey surface rules: waypoint legs detour around drawn
  obstacles with a clearance margin, detour corners are rounded to the vehicle's turning radius,
  every waypoint is a stop with an acceptance radius and dwell, and the route is checked for
  terrain grade against the vehicle's limit;
- ground-vehicle teleoperation (WASD / on-screen pad) with rejoin-to-route;
- a shared per-vehicle mission simulator with an air motion model (climb profile, bank, gusts)
  and a ground / surface model (acceleration limits, corner slow-down, waypoint dwell, terrain
  grade, heel on the water);
- vehicle dashboards, configuration, calibration, diagnostics, fleet, alerts, and logs;
- simulation-only mission controls.

### Vehicle profiles

`src/features/vehicles/vehicleProfile.ts` holds one profile per vehicle type. A profile declares
the vocabulary (stage words, command labels), plan modes and their geometry, parameters and
limits, presets, the pre-mission checks and live alerts, the telemetry strip, the instrument set
and the 3D model. The planner (`MissionsPage`), the live workspace (`OperationsWorkspace`) and the
3D view (`FlightView3D`) are written once against that shape. Adding a vehicle class means adding
a profile and, if it needs one, a procedural model in `vehicleModels.ts`; it does not mean adding
a page.

The mission lifecycle is shared by every class (`standby → armed → active → holding / manual →
returning → complete`, plus `aborted`); profiles only rename the stages (`IN FLIGHT` vs
`DRIVING`, `LANDED` vs `PARKED`).

### Metrics shown per class

| Area          | Air (UAV)                                                        | Ground / surface (UGV, USV)                                                                                      |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Live strip    | ground speed, altitude, flight time, GPS, frames captured        | speed, grade (or heel), drive time, GPS, odometer (or log)                                                       |
| Instruments   | attitude indicator, compass                                      | inclinometer with rollover band, compass                                                                         |
| Plan summary  | route, est. time, photos / coverage, battery                     | route, est. time, waypoints, laps, stops, max grade, battery                                                     |
| Checks        | geometry, zones, battery + reserve, link, health, altitude limit | geometry, street data, targets reachable, obstacles, battery + reserve, link, health, terrain grade, speed limit |
| Alerts        | battery, link, plan limits, stale draft, abort                   | battery, link, side-slope / rollover, grade, off-route under manual, plan limits, stale draft, e-stop            |
| Mission board | status, progress, distance done / total, ETA, last update        | same, sourced live from the simulator while a mission runs                                                       |

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
