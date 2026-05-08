# Epi City

Epi City is a top-down city simulation prototype built with Pixi.js and Vite. The current version renders a 256x256 Liberty City tile map, supports mouse camera controls, and exposes grid/pathfinding helpers for future simulation work.

## Quick Start

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Vite serves `public/maps/` as `/maps/`, and the app loads the `liberty-city` map package by default. Local dev and preview requests for `/maps/...` are served from `public/maps/...` with `no-store`, so editor changes to the source map files show up without relying on stale `dist/maps` copies.

## Controls

- Hold the left mouse button and drag to pan the camera.
- Use the mouse wheel to zoom around the cursor.
- Press `Space` to play or pause the simulation, press `s` to toggle the simulation dashboard, press `r` to toggle rendering options, and press `g` to toggle the epidemic graph.
- Use rendering options to show or hide the map texture, tune texture opacity, switch NPC/car rendering between `sprite` and `geometric`, show the tile overlay, choose its color scheme, tune tile overlay opacity, enable optional SEIR heatmaps, and turn on entity debug overlays.
- In `geometric` entity rendering, NPCs draw as infection-colored disks and cars draw as rectangles colored by any passengers inside them.
- Entity debug overlays can show infectious NPC radius circles, recent infection arrows, recent contact edges, and short NPC/car path trails. Infection and contact edge windows are tuned separately, default to 10 game minutes, and clamp from 1 game minute to 2 game hours.
- The tile overlay has `tile type`, `monochrome-light`, and `monochrome-dark` color schemes. The `tile type` scheme uses white sidewalks, blackish roads, light gray crosswalks, green parks, blue water, red obstacles, and primary building-type colors.
- SEIR heatmaps use kernel density estimation for susceptible, exposed, infectious, and recovered NPC positions. The rendering panel includes a kernel-radius slider plus exact number input.
- The epidemic graph plots S/E/I/R counts over simulated time, includes one tickbox per state, can be resized, labels its time/case axes, and supports drag-to-pan plus wheel-to-zoom on the time axis.
- Use the simulation dashboard NPC control to restart the simulation with 100 to 10000 pedestrians. The default is 1000.
- Use the simulation dashboard car control to restart the simulation with the selected number of cars. The default is 500.
- Use the simulation dashboard infection controls to tune initial infected count, SEIR distance, per-minute transmission probability, incubation time, infectious time, and recovered immunity time.
- Hover an NPC to inspect its infection status, contagiousness, immunity, and phase timer.
- Right-click an NPC and choose `infect` to manually make that NPC infectious.
- The simulation dashboard shows the simulated day/time, can run up to 24x speed, and can toggle the darker day-night overlay.
- Use the browser console to inspect `window.citySim`.

## Project Structure

- `index.html` is the app shell and loads the Vite module entrypoint.
- `src/` contains the runtime modules: map validation/compilation, Pixi rendering, camera controls, game loop, debug dashboard, NPC simulation, and car simulation.
- `public/maps/liberty-city/tile-layout.json` contains the default static Liberty City semantic tile layout.
- `public/maps/liberty-city/texture-layout.json` contains one atlas-frame texture ID per map cell.
- `public/maps/liberty-city/manifest.json` describes the Liberty City atlas frames used by the default texture set.
- `public/maps/liberty-city/liberty-city-atlas.webp` is the generated runtime atlas copy used by the renderer.
- `process_gta_map/` contains the canonical source image, preprocessing script, and reproducibility notes.
- `map-editor/` contains the interactive map editor, random-forest training loop, and Epi City JSON load/save tools.
- `docs/internal-architecture.md` explains the map format, runtime representation, rendering strategy, and pathfinding behavior.
- `vite.config.ts` configures local development and preview server ports.

## Map Format

The map stores semantics and visuals in separate JSON files. `tile-layout.json` contains one legend symbol per cell for gameplay classification plus a compact `buildings` list for connected building components. `texture-layout.json` contains one deduplicated source texture ID per cell for exact rendering. Tile-to-texture assignments do not live in the texture manifest, so texture painting in the editor is saved through `Save Map Folder`.

```json
{
  "width": 256,
  "height": 256,
  "tileSize": 32,
  "textureSet": "liberty-city",
  "legend": {
    "A": {
      "category": "road",
      "walkable": false,
      "drivable": true,
      "parkable": false
    }
  },
  "buildings": {
    "encoding": "row-spans-v1",
    "defaultTypes": ["residential"],
    "items": [
      {
        "id": "building-0001",
        "types": ["residential", "restaurant"],
        "entrance": { "x": 1, "y": 0 },
        "spans": [[0, 0, 3]]
      }
    ]
  },
  "rows": ["..."]
}
```

```json
{
  "width": 256,
  "height": 256,
  "textureSet": "liberty-city",
  "textureRows": [[0, 1, 2]]
}
```

The runtime supports seven base categories: `road`, `sidewalk`, `crosswalk`, `park`, `water`, `building`, and `obstacle`. Each legend entry also stores `walkable`, `drivable`, and `parkable` booleans generated from tile behavior rules. Building components are stored as 8-connected row spans with an `id`, `types`, and optional `entrance` coordinate on the building footprint. Supported editor types are `residential`, `commercial`, `school`, `restaurant`, `supermarket`, `mall`, and `nightclub`; legacy singular `type` maps still load.

## Movement Rules

Vehicles use the directed lane graph when it exists and park on tiles marked `parkable`. Pedestrians use tiles marked `walkable`. Crosswalks are both walkable and drivable, and their shared signal cycles through `red`, `green`, and `yellow`; NPCs and cars enter only on green, but entities already on a crosswalk can keep moving or step off at any signal. Vehicle traffic signals are generated from lane graph intersections and can be overridden from the map editor. In the default map, roads are drivable only; sidewalks and parks are walkable only; water, obstacles, and non-entrance building tiles are blocked. A building entrance remains a `building` tile, but the runtime marks that cell walkable from building metadata.

## NPC Prototype

The app creates 1000 pedestrian NPCs when the city loads. NPCs keep `home`, `work`, `timetable`, `goal`, `position`, `tile`, `slot`, `zorder`, `movement`, `sprite`, and `infection` state, render as animated top-down pixel pedestrians while they are outside, and route toward timetable goals. Each NPC receives a residential home building id and a work building id chosen from commercial, school, restaurant, supermarket, mall, or nightclub buildings when the simulation starts. The default runtime uses the `epi-city` seed so building assignments, timetable variation, spawn anchors, NPC speeds, and infection events can repeat after a restart. Route extraction is deterministic.

Infection uses a SEIR model with temporary recovered immunity. NPC infection state is one of `susceptible`, `exposed`, `infectious`, or `recovered`; recovered NPCs become susceptible again after the configured immunity time. Susceptible NPC clothing renders yellow, exposed orange, infectious red, and recovered green. The default starts four infectious NPCs, uses a 48 world-unit infection distance, a `0.03` per-minute contact probability, a 1-day incubation period, a 7-day infectious period, and 90 days of immunity. Transmission uses a spatial hash of infectious NPC positions, so contact checks stay near-linear as the NPC count grows.

Tiles and NPCs use `zorder` to decide what draws on top. Normal tiles render at `0`, NPCs render at `1`, and building tiles render at `2`. Tile overlays inherit the z-order of the tile they cover, while SEIR heatmaps render above map tiles and below the day-night overlay.

Each walkable tile has nine visual NPC anchors arranged in a compact 3x3 grid, but tile occupancy is unrestricted. Any number of NPCs can share a normal tile logically; the renderer draws at most nine NPCs per tile so crowded spots stay readable. NPCs interpolate smoothly between anchor positions.

The runtime uses a single browser animation loop with the game-development shape `dt = getDeltaTime()`, fixed-step `update(dt)`, then `render()`. Simulation systems update first; rendering systems draw their retained Pixi objects; finally Pixi presents the stage. The simulation dashboard can pause, play, restart, change the seed, set the NPC count, show the clock, toggle the day-night overlay, and speed up simulation time.

## Car Prototype

The app creates 500 cars by default. Cars have one or two real NPC owners from the same residential building, park in available parkable spots near home or work, and occupy two or three tiles with one car allowed per occupied tile. Commuting owners wait for their car instead of walking, ride hidden inside it, and get dropped into the destination building when the car parks. Parked cars render shifted toward the neighboring road, while moving cars render on lane graph node centers.

Car routing compiles the lane graph into compact typed arrays and caches reverse destination route fields plus exact extracted lane routes. Route cost uses lane distance only; speed limits affect movement speed, not path choice. At runtime, the car network also generates smooth lane-change maneuver edges wherever two same-direction lanes are one tile apart and three to six tiles forward. These maneuvers avoid crosswalks, check their swept road area for clearance, and keep the car body occupying only its normal two or three tiles. Traffic lights are movement gates rather than route-cache inputs, so cars wait before entering a red or yellow controlled intersection without invalidating cached routes. The cached lane route benchmark on Liberty City's 18,260-node lane graph is covered by a performance test requiring at least a 10x speedup for warmed cached route data.

## Debugging From The Console

After the app loads, `window.citySim.city` exposes the main runtime API:

```js
const { city } = window.citySim

city.getTile(10, 10)
city.getTileVariant(10, 10)
city.getTextureId(10, 10)
city.getBuilding(10, 10)
city.isWalkable(10, 10)
city.isDrivable(10, 10)
city.isParkable(10, 10)
city.isCrosswalk(10, 10)
city.getCrosswalkSignalState()
city.setCrosswalkSignalState('green')
city.resetCrosswalkSignals()
city.isPassable(10, 10, 'vehicle')
city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.gameLoop.running
window.citySim.simulationClock.formatTimeOfDay()
window.citySim.npcs.length
window.citySim.npcSimulation.infection.getStats()
window.citySim.cars.length
window.citySim.npcs[0].home
window.citySim.npcs[0].work
window.citySim.npcs[0].infection
window.citySim.cars[0].owners
window.citySim.cars[0].parkedAt
window.citySim.npcs[0].timetable.elements
window.citySim.npcs[0].position
window.citySim.pause()
window.citySim.play()
window.citySim.setSeed('demo-seed')
window.citySim.restart()
window.citySim.setSpeed(4)
window.citySim.setNpcCount(2500)
window.citySim.setCarCount(250)
window.citySim.setInitialInfectiousCount(10)
window.citySim.setInfectionDistance(64)
window.citySim.setInfectionProbability(0.05)
window.citySim.setIncubationDays(4)
window.citySim.setInfectionDays(8)
window.citySim.setImmunityDays(120)
window.citySim.setDayNightOverlayEnabled(false)
window.citySim.setEntityRenderMode('geometric')
window.citySim.setInfectionRadiusVisible(true)
window.citySim.setInfectionEdgesVisible(true)
window.citySim.setContactEdgesVisible(true)
window.citySim.setInfectionEdgeDuration(10)
window.citySim.setContactEdgeDuration(10)
window.citySim.setPathTrailsVisible(true)
window.citySim.setPathTrailLength(5)
window.citySim.setHeatmapRadius(128)
```

The API supports two movement modes: `vehicle` and `pedestrian`. Pathfinding snaps invalid start and end points to the nearest passable tile for the selected mode.

The dashboard controller is available through `window.citySim.dashboard`. It exposes simulation controls plus `setMapTextureEnabled(enabled)`, `setMapTextureOpacity(opacity)`, `setEntityRenderMode(mode)`, entity debug overlay setters, `setOverlay(id, enabled)`, `setTileOverlayScheme(schemeId)`, `setTileOverlayOpacity(opacity)`, `setHeatmapRadius(radius)`, `toggle(force)`, `toggleRenderingOptions(force)`, `toggleGraph(force)`, and `render()` for quick checks from the console:

```js
window.citySim.dashboard.toggle(true)
window.citySim.dashboard.toggleRenderingOptions(true)
window.citySim.dashboard.toggleGraph(true)
window.citySim.dashboard.setMapTextureEnabled(false)
window.citySim.dashboard.setMapTextureOpacity(0.45)
window.citySim.dashboard.setEntityRenderMode('geometric')
window.citySim.dashboard.setInfectionRadiusVisible(true)
window.citySim.dashboard.setInfectionEdgesVisible(true)
window.citySim.dashboard.setContactEdgesVisible(true)
window.citySim.dashboard.setInfectionEdgeDuration(10)
window.citySim.dashboard.setContactEdgeDuration(10)
window.citySim.dashboard.setPathTrailsVisible(true)
window.citySim.dashboard.setPathTrailLength(5)
window.citySim.dashboard.setOverlay('tileType', true)
window.citySim.dashboard.setOverlay('heatmapInfectious', true)
window.citySim.dashboard.setTileOverlayScheme('monochrome-dark')
window.citySim.dashboard.setTileOverlayOpacity(0.5)
window.citySim.dashboard.setHeatmapRadius(128)
```

## Map Editor

Install the Python training dependencies and start the map editor:

```bash
npm run map-editor:deps
npm run map-editor
```

The dependency command creates or repairs a local Python environment in `map-editor/.venv` and installs `scikit-learn` there. Open the local URL printed by the command; it starts at `http://localhost:5174` and tries the next port if that one is already in use. The editor starts from an empty semantic layout plus the current Liberty City texture rows, atlas, and texture manifest. Use `Load Map Folder` to open a package such as `public/maps/liberty-city`, and `Save Map Folder` to write `tile-layout.json` plus `texture-layout.json` back together.

## Texture Sets

The default texture set is `liberty-city`. The app loads `public/maps/liberty-city/manifest.json`, then loads the atlas image and creates Pixi subtextures from the manifest frame list. The generated manifest deduplicates exact source crops, so repeated map cells share one atlas frame while every cell still matches its original source tile.

## Build

Run the unit tests and production build with:

```bash
npm run check
```

Create a production build with:

```bash
npm run build
```

For GitHub Pages, the repository includes a workflow at `.github/workflows/deploy-pages.yml`. Enable Pages for GitHub Actions in the repository settings; pushes to `main` will build `dist/` with `VITE_BASE_PATH=/<repository-name>/` and deploy it to Pages.

Preview the production build with:

```bash
npm run preview
```

### Lane Graph Traffic Metadata

Car traffic can use optional manually authored `laneGraph` metadata in each map `tile-layout.json`. The map editor's lane graph layer builds directed segments by clicking road or crosswalk tiles in travel order; each tile owns one centered node, and each saved edge connects neighboring road or crosswalk tiles. Duplicate directed edges are rejected during validation. Intersections are detected from lane graph topology and receive generated traffic light phases; the editor can save `laneGraph.trafficSignals.overrides` to disable a generated signal or adjust its phase offset. Runtime code rejects legacy generated metadata, lane offsets, layered lane fields, and connector edges before compiling the graph into `LaneGraph`, `LaneNode`, and `LaneEdge` objects for efficient vehicle simulation.
