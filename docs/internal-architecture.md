# Internal Architecture

Epi City uses a small `index.html` shell plus Vite-served modules under `src/`. The default Liberty City map package lives in `public/maps/liberty-city`, while the browser validates and compiles the tile layout into a faster runtime representation before simulation starts.

## Map Data Flow

The app loads `./maps/liberty-city/tile-layout.json` and `./maps/liberty-city/texture-layout.json` at startup. Vite serves `public/maps/` from the site root, so the same relative fetches work in development and production builds. The local Vite dev and preview servers intercept `/maps/...` and serve those files directly from `public/maps/...` with `no-store`, which keeps local map-editor saves from being hidden by stale `dist/maps` build output.

Startup follows this sequence:

1. Vite loads `src/main.js`, which imports Pixi from the npm dependency instead of a CDN global.
2. Pixi creates a full-window canvas and a `world` container.
3. The app installs left-drag pan and wheel zoom camera controls with a teardown handle.
4. `loadCityMap()` fetches the semantic tile layout, fetches the texture rows layout, validates both files, and returns normalized map data.
5. `compileCityMap()` converts the normalized semantic rows and texture rows into typed arrays.
6. `loadTextureSet()` validates the selected texture manifest, loads the atlas image, and `validateCityTextureBindings()` checks map texture IDs against the frame count.
7. `renderCity()` draws one sprite per map cell, grouped into 16x16 z-ordered containers.
8. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.
9. `installDebugDashboard()` adds simulation controls, the clock display, keyboard-controlled behavior overlays for movement debugging, and cached overlay layers after their first build.
10. `SimulationClock`, `createNpcSimulation()`, and `createCarSimulation()` create the clock and entity systems with their configured random sources, then `Game` starts one `GameLoop` that runs `getDeltaTime()`, fixed-step `update(dt)`, and `render()` each animation frame.

## Map Schema

`public/maps/liberty-city/tile-layout.json` uses this shape:

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
    "defaultType": "residential",
    "items": [
      {
        "id": "building-0001",
        "type": "residential",
        "spans": [[0, 0, 3]]
      }
    ]
  },
  "rows": ["..."]
}
```

`public/maps/liberty-city/texture-layout.json` stores the visual assignment layer separately:

```json
{
  "width": 256,
  "height": 256,
  "textureSet": "liberty-city",
  "textureRows": [[0, 1, 2]]
}
```

Each `rows` entry must be a string with exactly `width` symbols. The file must contain exactly `height` semantic rows. Every symbol must exist in the legend, and every legend entry must include a supported `category` plus boolean `walkable`, `drivable`, and `parkable` properties.

The optional `buildings` object uses `row-spans-v1`: each building has a stable string `id`, a string `type`, optional `entrance: { x, y }` metadata, and `spans` encoded as `[y, x, length]`. The runtime validates that spans are in bounds, cover only `building` category tiles, do not overlap, form 8-connected components, and exactly cover every building tile. When present, an entrance must be inside its building footprint.

Each `textureRows` entry must be an array with exactly `width` integer texture IDs. The texture rows file must match the tile layout dimensions, and its texture IDs refer to atlas frames in `public/maps/liberty-city/manifest.json`. This keeps gameplay semantics independent from visual fidelity.

The base categories are `road`, `sidewalk`, `crosswalk`, `park`, `water`, `building`, and `obstacle`. Movement uses the generated behavior booleans instead of hard-coded category masks, with crosswalks adding a signal-state gate for pedestrian entry.

## Runtime City Object

`compileCityMap()` returns the runtime city object. `window.citySim.city` exposes it for debugging and later simulation systems.

| Property or method | Purpose |
| --- | --- |
| `width`, `height`, `tileSize` | Map dimensions and world-space tile size. |
| `tiles` | Numeric `Uint8Array` with one base category ID per cell. |
| `tileTextureIds` | Numeric `Uint32Array` with one atlas-frame ID per cell. |
| `tileWalkable`, `tileDrivable`, `tileParkable` | Numeric `Uint8Array` layers with generated gameplay behavior per cell. |
| `tileCrosswalk` | Numeric `Uint8Array` layer marking cells controlled by the crosswalk signal. |
| `tileZOrders` | Numeric `Int16Array` layer with each tile's render order. Normal tiles use `0`; building tiles use `2`. |
| `buildings`, `tileBuildingIndexes` | Runtime building records, including entrance coordinates, and tile-to-building lookup data. |
| `legend` | Normalized symbol metadata keyed by map symbol. |
| `index(x, y)` | Converts grid coordinates into a typed-array offset. |
| `getTile(x, y)` | Returns a base category name or `null` outside the map. |
| `getTileId(x, y)` | Returns a numeric category ID or `null` outside the map. |
| `getTileVariant(x, y)` | Returns `{ category, walkable, drivable, parkable, textureId, zorder, buildingId, buildingType, buildingEntrance }` for a cell. |
| `getTextureId(x, y)` | Returns the atlas-frame ID for a cell. |
| `getBuildingId(x, y)`, `getBuilding(x, y)` | Reads building metadata from the compiled building lookup. |
| `inBounds(x, y)` | Checks integer grid bounds. |
| `isWalkable(x, y)`, `isDrivable(x, y)`, `isParkable(x, y)` | Checks generated tile behavior layers directly. |
| `isCrosswalk(x, y)` | Checks whether a cell is a crosswalk tile. |
| `getCrosswalkSignalState()`, `setCrosswalkSignalState(state)`, `resetCrosswalkSignals()`, `updateCrosswalkSignals(dt)` | Reads, tests, resets, and advances the shared crosswalk signal cycle. |
| `isPassable(x, y, mode)` | Checks movement passability for `vehicle` or `pedestrian`. |
| `canStep(fromX, fromY, toX, toY, mode)` | Checks a single movement step, including vehicle diagonal corner rules. |
| `canStepIndex(fromIndex, toIndex, mode)` | Checks a single movement step by tile index for hot simulation loops. |
| `nearestPassableTile(x, y, mode)` | Finds the closest tile usable by the movement mode. |
| `findPath(start, end, mode)` | Runs on-demand A* and returns `{ x, y }` path points. |
| `findCachedPath(start, end, mode)` | Uses a cached destination route field and returns `{ x, y }` path points. |
| `findCachedPathIndexes(start, end, mode)` | Uses the same route field and returns tile indexes for NPC routing. |
| `findCachedPathIndexesByIndex(startIndex, endIndex, mode)` | Index-native route extraction for simulation hot paths that already store tile indexes. |
| `navigationCacheKey`, `getNavigationCacheStats()` | Exposes the compiled navigation signature and route-field cache counters for debugging. |

The typed-array representation keeps simulation code numeric and predictable. JSON remains the authoring format; typed arrays are the runtime format.

## Movement And Pathfinding

Movement uses generated behavior layers. Pedestrians use `walkable` tiles, while cars prefer the authored lane graph and use `drivable`/`crosswalk` tiles for occupancy checks. Parking systems use `parkable` tiles. Crosswalks are both pedestrian and vehicle crossing points, but entering them is controlled by the city crosswalk signal. In the default map, roads are drivable only; sidewalks and parks are walkable only; water, obstacles, and non-entrance building tiles are blocked. Building entrance cells keep the `building` category, but `compileCityMap()` marks them walkable after validating the entrance metadata.

The shared crosswalk signal cycles through `red`, `green`, and `yellow`. NPCs can step onto a crosswalk only on green. During yellow or red, NPCs outside the crossing cannot begin entering it, but any NPC already on a crosswalk can continue moving through crosswalk tiles or step off to another walkable tile.

The checked-in layout stores behavior as explicit legend properties instead of deriving movement masks from category names at runtime. This keeps map-editor corrections authoritative once a tile configuration is saved.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Pedestrian movement exposes every adjacent `walkable` tile, including diagonal neighbors. Vehicle movement keeps stricter diagonal corner checks by requiring both adjacent cardinal cells to be drivable.

`compileCityMap()` precomputes movement masks and reverse movement masks for pedestrian signal states and vehicle movement. The runtime caches these typed-array navigation structures by a hash of the map's walkable, drivable, and crosswalk layers. When the map folder changes those semantic layers, the hash changes and the runtime rebuilds the navigation data for the new layout.

`findPath()` runs on-demand A* with stamped typed arrays, so searches reuse scratch memory without clearing the whole map on each route. `findCachedPath()` builds a reverse route field for the current destination and movement state, caches the field with an LRU policy, and extracts future paths to that same destination by following deterministic next-hop indexes. `findCachedPathIndexesByIndex()` keeps NPC route planning index-native, and each route field caches exact start-to-destination index paths after extraction. This matches NPC commute patterns because many NPCs route to the same work or home entrances.

## Simulation Clock

`Game` owns the runtime clock state. The browser animation loop keeps rendering while simulation time can pause, play, or run at a speed multiplier. Updates use a fixed step of `1 / 60` seconds, so systems receive stable delta values even when the display frame delta varies.

The dashboard writes speed changes through `game.setSpeed(multiplier)`. The multiplier applies to every simulation system, so the day-night clock, NPC movement, car movement, and crosswalk signals advance together. The dashboard displays the current simulated day/time, exposes NPC and car counts as sliders plus exact number inputs, and includes a checkbox for the day-night overlay. Changing either entity count restarts the population systems with clamped counts; the NPC default remains 1000, and the car default is 500.

`SimulationClock` advances one simulated hour for every 60 game seconds. Since `Game` applies speed before fixed updates reach systems, `1x` speed makes one real minute equal one simulation hour, and higher speeds multiply that rate. Restarting the simulation resets the clock to the configured start hour.

## NPC Simulation

`createNpcSimulation()` creates 1000 pedestrian NPCs after the map renders. NPCs start inside their active timetable location when they have one, render into one Pixi `Graphics` layer as small `#e5c748` pixel blobs while outside, and move smoothly from slot anchor to slot anchor.

NPC entities expose the state the simulation needs:

```js
{
  id,
  zorder,
  home,
  work,
  timetable,
  goal,
  present,
  locationState,
  routing,
  position: { x, y },
  tile: { x, y, index },
  slot: { id, index },
  movement: { speed, target }
}
```

The simulation owns movement decisions and tile occupancy bookkeeping. NPC entities keep inspectable state but do not own the frame loop. NPCs use `zorder: 1`.

The NPC system receives a random source through config. At creation time, each NPC receives `home` and `work` building ids chosen from residential and commercial buildings, plus a timetable with `home` and `work` elements. The work element targets the work building entrance and is active around `09:00-17:00` with per-NPC variation. The home element targets the home building entrance and wraps around the rest of the day. The default app state enables the `epi-city` seed, which makes home/work assignment, timetable variation, spawn anchor selection, and speed assignment repeat when the simulation restarts with the same seed. NPCs without an active goal stay idle instead of choosing random adjacent path tiles.

NPCs do not spawn directly on crosswalk tiles when they need a fallback outdoor spawn. Goal movement uses `city.findCachedPath()` to plan pedestrian routes to the active timetable location, then uses `city.canStep()` for every tile step so crosswalk signal rules are enforced at the same boundary as other movement checks. Route requests are processed through a per-update budget so shift changes do not plan every queued NPC route in one frame.

Each normal walkable tile has nine visual NPC anchors arranged as a compact 3x3 grid inside the tile. Tile occupancy is unrestricted: NPCs do not block spawning, exiting, or movement because a tile is crowded. The renderer draws at most nine NPCs for a tile. Building entrance tiles remain shared holding points for NPCs entering, waiting inside, or leaving the same building without blocking the doorway.

## Car Simulation

`createCarSimulation()` builds cars after the map renders. Each car receives one or two real NPC owner records, and all owners for one car share the same residential home building. A commuting owner waits inside the origin building while the car is pending, rides hidden inside the car, and is dropped into the destination building when the car parks. If a car is used to reach work, the same car remains parked near work until the evening return window sends it home.

Cars park on `tileParkable` cells near the relevant building entrance. The parking manager uses typed `Int32Array` occupancy and reservation layers so each occupied tile belongs to at most one car. Two-tile cars are the common case, with some three-tile cars. Parked rendering shifts the car body toward the nearest road or lane tile.

Moving cars use the authored `city.laneGraph`. The runtime compiles that graph into compact arrays for node tile indexes, directed edge endpoints, reverse adjacency, edge costs, tile-to-node lookup, and nearest lane node by tile. This precomputed network is cached by the compiled lane graph object, so loading a changed map folder produces a new lane graph object and recomputes the car traffic structures.

Car routing follows the same destination-field idea as pedestrian routing. `createCarRoutePlanner()` builds reverse Dijkstra route fields keyed by destination lane node, stores the next edge for each reachable start node, and caches exact extracted routes by start node. Edge cost uses lane distance only, so cars choose the shortest lane route even if it includes authored merge or lane-change edges. Speed limits affect movement duration after routing. Cars only enter crosswalk lane nodes while the shared signal is green, but cars already on a crosswalk can continue out at any signal.

## Texture Sets

A texture set lives inside its map package under `public/maps/<map-name>`. The current `liberty-city` manifest stores one source atlas and a list of deduplicated source frames:

```json
{
  "name": "liberty-city",
  "tileSize": 32,
  "atlas": {
    "file": "liberty-city-atlas.webp",
    "width": 3277,
    "height": 3277
  },
  "frames": [[0, 0, 13, 13]],
  "dedupe": {
    "cells": 65536,
    "uniqueTiles": 64193,
    "duplicatesRemoved": 1343
  }
}
```

`loadTextureSet(name)` reads the manifest, loads the atlas through `PIXI.Assets`, and lazily creates a `PIXI.Texture` for each frame ID used by the renderer. `renderCity()` resolves each cell through `city.tileTextureIds`, then creates a `PIXI.Sprite` with the matching subtexture.

The extraction script checks every map cell against the original image. Each `textureRows[y][x]` ID points to a frame whose source pixels match that cell's original source crop exactly. Future map styles can reuse the same semantic rows by providing a compatible visual layer.

## Rendering Strategy

The `world` container has one sortable entity layer. Ground tile chunks render at `zorder: 0`, NPC and car graphics render at `zorder: 1`, building tile chunks render at `zorder: 2`, and the day-night overlay renders above the city at `zorder: 3`. Tile overlay chunks inherit the z-order of the tiles they cover, so ground overlays stay below entities while building overlays stay above building tiles.

`renderCity()` groups sprites into 16x16 tile containers per z-order. Grouping keeps the display tree structured by map region while preserving per-cell source textures and still allowing buildings to draw above NPCs. Map and manifest validation run before rendering, so missing texture frames fail fast instead of producing partial fallback art.

Pixi automatic rendering is disabled during app initialization. The app-level `GameLoop` owns frame timing instead: it clamps delta time, calls each system's `update(deltaSeconds)`, calls each system's `render()`, then calls `app.render()` once. Static tile rendering builds the entity layer once at startup.

The source texture set is extracted from `process_gta_map/source/gta1-liberty-city-hd.webp` by `process_gta_map/build-gta-tilemap.py`. The checked-in default runtime assets live in `public/maps/liberty-city` so Vite can serve them directly. See `process_gta_map/README.md` for the reproducible import flow.

## Debug Dashboard

Press `d` to toggle the top-right debug dashboard. The dashboard displays the simulation clock, exposes a day-night overlay checkbox, and includes a tile-type overlay plus `walkable`, `parkable`, and `drivable` overlays backed by the runtime typed arrays. Behavior overlays paint green over tiles where the selected behavior is enabled and red over tiles where it is disabled.

The tile-type overlay paints semantic categories with fixed debug colors: sidewalk gray, road asphalt black, crosswalk road black with white strips, park green, water blue, building slate, and obstacle red.

Each debug overlay layer is built lazily the first time it is enabled, then later toggles only change layer visibility. The overlay builders use the same 16x16 chunk pattern as the city renderer so large behavior masks remain inspectable without covering NPCs.

## Map Editor

The map editor in `map-editor/` is a local maintenance tool for correcting semantic tile labels without changing the source texture atlas. It serves the canonical source image and a browser editor from a separate Node server on port `5174`.

The browser owns the editable map state. Startup asks `/api/config` for an empty semantic tile configuration and the current Liberty City texture rows, then loads the default atlas plus texture manifest for immediate preview. `Load Map Folder` opens a package folder containing `tile-layout.json`, `texture-layout.json`, `manifest.json`, and the atlas named by the manifest. `Reset to defaults` rebuilds the empty semantic state with the current visual layer. `Save Map Folder` writes the editable semantic rows/buildings and visual assignment layer back to `tile-layout.json` and `texture-layout.json` together.

Texture rows loading validates `textureRows` instead of falling back to default texture IDs. The editor status reports whether the current visual preview is rendered from loaded folder assets or is waiting for one of those assets.

The editor displays the current map state for every layer. There is no separate sparse-label overlay or hidden generated-label source. A brush stroke directly mutates the current tile type, `walkable`, `parkable`, or `drivable` grid, and each stroke becomes one undoable operation. The explicit `empty` brush value writes `null` back into the selected label layer. The building layer edits the selected connected building component's `type` in the top-level `buildings` metadata.

The texture layer edits `textureRows` at the manifest-frame ID level. Its picker samples the texture ID from a clicked tile, then paint strokes copy that ID to other cells. Texture edits share the same undo/redo pipeline as semantic edits, and when an atlas plus manifest are loaded the editor rebuilds the visual map from the updated `textureRows`. Because the runtime reads tile texture IDs from `texture-layout.json`, the editor directs users to `Save Map Folder` after texture painting.

The editor tracks semantic tile-property and building metadata edits separately from texture-row edits, but package saving writes both JSON files in one operation. Incomplete semantic labels are saved as `null`, which keeps sparse labeling sessions serializable even before the map is ready for runtime use.

`POST /api/train` runs `map-editor/train_random_forest.py` through the local `map-editor/.venv` interpreter when it exists. The browser posts the full current `rows` and `behaviorRows` grids, and when atlas/manifest assets are loaded it also posts the current texture feature source: the atlas image data, texture manifest, and `textureRows`. The trainer reconstructs its pixel feature image from those texture assignments, so texture painting affects later classifier runs. If texture assets are not loaded, training falls back to the canonical source image. Each layer trains only from non-empty labels. Layers without at least two distinct non-empty values are skipped and return their current sparse values unchanged.

Training stores predictions separately from the editable map. `Predict labels` applies the latest prediction to the map as one undoable operation, which lets users inspect training results before committing them. The main app still requires complete tile type and behavior labels before a saved editor configuration replaces the runtime map.

The map editor server serves `/`, `/source-image`, `/default-texture-manifest`, `/default-texture-atlas`, `/api/config`, and `/api/train`. Removed sparse-label and server-side map load/write routes now fall through to the standard unknown-route `404`.

Run the map editor with:

```bash
npm run map-editor:deps
npm run map-editor
```

The dependency command creates or repairs `map-editor/.venv`, then installs the Python requirements. Set `MAP_EDITOR_BOOTSTRAP_PYTHON` to choose the setup interpreter or `MAP_EDITOR_PYTHON` to choose the runtime training interpreter.

## Debugging Hooks

`window.citySim` exposes the compiled city, camera, game loop, NPC state, dashboard, camera-centering helper, and teardown hook. This keeps the console useful without exposing every Pixi container and loader helper.

Useful console checks:

```js
window.citySim.city.getTile(100, 100)
window.citySim.city.getTileVariant(100, 100)
window.citySim.city.getTextureId(100, 100)
window.citySim.city.nearestPassableTile(120, 140, 'pedestrian')
window.citySim.city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.gameLoop.running
window.citySim.simulationClock.formatTimeOfDay()
window.citySim.pause()
window.citySim.play()
window.citySim.setSeed('demo-seed')
window.citySim.restart()
window.citySim.setSpeed(4)
window.citySim.setCarCount(250)
window.citySim.setDayNightOverlayEnabled(false)
window.citySim.cars[0].owners
window.citySim.cars[0].parkedAt
window.citySim.npcs[0].home
window.citySim.npcs[0].work
window.citySim.npcs[0].timetable.elements
window.citySim.npcs[0].position
window.citySim.npcs[0].movement.target
window.citySim.centerCameraOnCity()
window.citySim.dashboard.setOverlay('walkable', true)
```

## Near-Term Extension Points

- Add focused tests around editor-side validators once the browser editor is split into modules.
- Add hierarchical routing if future maps become much larger than the current 256x256 Liberty City layout.
- Add simulation metadata outside the base tile category when infection dynamics need population, occupancy, or district information.

## Lane Graph

The city map loader validates optional `laneGraph` metadata and compiles it alongside tile masks. Lane graph data uses `directed-lanes-v1`, `drivingSide: "right"`, tile-space coordinates, one centered node per tile, and directed neighboring-tile edges. Duplicate directed edges are collapsed during normalization. The map editor authors lane graph segments by clicking road or crosswalk tiles in travel order; lane edges model fixed travel between neighboring tiles, and turn edges model direction changes between neighboring tiles. Legacy generated metadata, lane offsets, layered lane fields, and connector edges are rejected.
