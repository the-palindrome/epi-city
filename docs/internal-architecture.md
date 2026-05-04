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
7. `renderCity()` draws one sprite per map cell, grouped into 16x16 containers.
8. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.
9. `installDebugDashboard()` adds simulation controls, keyboard-controlled behavior overlays for movement debugging, and cached overlay layers after their first build.
10. `createNpcSimulation()` creates the NPC system with the configured random source, then `Game` starts one `GameLoop` that runs `getDeltaTime()`, fixed-step `update(dt)`, and `render()` each animation frame.

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

The optional `buildings` object uses `row-spans-v1`: each building has a stable string `id`, a string `type`, and `spans` encoded as `[y, x, length]`. The runtime validates that spans are in bounds, cover only `building` category tiles, do not overlap, form 8-connected components, and exactly cover every building tile.

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
| `buildings`, `tileBuildingIndexes` | Runtime building records and tile-to-building lookup data. |
| `legend` | Normalized symbol metadata keyed by map symbol. |
| `index(x, y)` | Converts grid coordinates into a typed-array offset. |
| `getTile(x, y)` | Returns a base category name or `null` outside the map. |
| `getTileId(x, y)` | Returns a numeric category ID or `null` outside the map. |
| `getTileVariant(x, y)` | Returns `{ category, walkable, drivable, parkable, textureId, buildingId, buildingType }` for a cell. |
| `getTextureId(x, y)` | Returns the atlas-frame ID for a cell. |
| `getBuildingId(x, y)`, `getBuilding(x, y)` | Reads building metadata from the compiled building lookup. |
| `inBounds(x, y)` | Checks integer grid bounds. |
| `isWalkable(x, y)`, `isDrivable(x, y)`, `isParkable(x, y)` | Checks generated tile behavior layers directly. |
| `isCrosswalk(x, y)` | Checks whether a cell is a crosswalk tile. |
| `getCrosswalkSignalState()`, `setCrosswalkSignalState(state)`, `resetCrosswalkSignals()`, `updateCrosswalkSignals(dt)` | Reads, tests, resets, and advances the shared crosswalk signal cycle. |
| `isPassable(x, y, mode)` | Checks movement passability for `vehicle` or `pedestrian`. |
| `canStep(fromX, fromY, toX, toY, mode)` | Checks a single movement step, including vehicle diagonal corner rules. |
| `nearestPassableTile(x, y, mode)` | Finds the closest tile usable by the movement mode. |
| `findPath(start, end, mode)` | Runs on-demand A* and returns `{ x, y }` path points. |

The typed-array representation keeps simulation code numeric and predictable. JSON remains the authoring format; typed arrays are the runtime format.

## Movement And Pathfinding

Movement uses generated behavior layers. Vehicles use `drivable` tiles. Pedestrians use `walkable` tiles. Parking systems can use `parkable` tiles. Crosswalks are both `walkable` and `drivable`, but pedestrian movement through them is controlled by the city crosswalk signal. In the default map, roads are drivable only; sidewalks and parks are walkable only; water, buildings, and obstacles are blocked.

The shared crosswalk signal cycles through `red`, `green`, and `yellow`. NPCs can step onto a crosswalk only on green. During yellow, NPCs already on a crosswalk can continue to another crosswalk tile or step off the crossing, but NPCs outside the crossing cannot begin entering it. During red, NPCs cannot step onto crosswalk tiles, though any NPC already on one can still step off to a non-crosswalk walkable tile.

The checked-in layout stores behavior as explicit legend properties instead of deriving movement masks from category names at runtime. This keeps map-editor corrections authoritative once a tile configuration is saved.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Pedestrian movement exposes every adjacent `walkable` tile, including diagonal neighbors. Vehicle movement keeps stricter diagonal corner checks by requiring both adjacent cardinal cells to be drivable.

`findPath()` currently runs on demand and reuses per-city scratch arrays for its open/closed/came-from/score state. If hundreds of NPCs request routes every frame, add route caching, hierarchical routing, or per-mode navigation graphs before tuning visual rendering.

## Simulation Clock

`Game` owns the runtime clock state. The browser animation loop keeps rendering while simulation time can pause, play, or run at a speed multiplier. Updates use a fixed step of `1 / 60` seconds, so systems receive stable delta values even when the display frame delta varies.

The dashboard writes speed changes through `game.setSpeed(multiplier)`. The multiplier applies to every simulation system, so NPC movement and crosswalk signals advance together.

## NPC Simulation

`createNpcSimulation()` spawns 1000 pedestrian NPCs after the map renders. NPCs start on walkable tile slots, render into one Pixi `Graphics` layer as small `#e5c748` pixel blobs, and move smoothly from slot anchor to slot anchor.

NPCs are plain objects with the state the simulation needs:

```js
{
  id,
  position: { x, y },
  tile: { x, y, index },
  slot: { id, index },
  movement: { speed, target }
}
```

The simulation owns movement decisions and slot bookkeeping. NPC entities keep inspectable state but do not own the frame loop.

The NPC system receives a random source through config. The default app state enables the `epi-city` seed, which makes spawn slot selection, speed assignment, neighbor choice, and target-slot choice repeat when the simulation restarts with the same seed.

NPCs do not spawn directly on crosswalk tiles. Once spawned, random movement uses `city.canStep()` so crosswalk signal rules are enforced at the same boundary as other tile movement checks.

Each walkable tile currently has two side-by-side NPC slots. Collision uses two `Int32Array` grids indexed as `tileIndex * tileCapacity + slot`. `occupiedSlots` stores each NPC's current slot, and `reservedSlots` stores destination slots for NPCs already in motion. An NPC can only start a move when the target tile is walkable and at least one slot is both unoccupied and unreserved. Movement selection uses the city's non-allocating step checks instead of building a fresh neighbor array for each NPC decision.

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

The `world` container has separate `map`, `overlays`, and `actors` layers. Map sprites stay at the bottom, debug overlays render above the city, and NPC actors render on top.

`renderCity()` groups sprites into 16x16 tile containers. Grouping keeps the display tree structured by map region while preserving per-cell source textures. Map and manifest validation run before rendering, so missing texture frames fail fast instead of producing partial fallback art.

Pixi automatic rendering is disabled during app initialization. The app-level `GameLoop` owns frame timing instead: it clamps delta time, calls each system's `update(deltaSeconds)`, calls each system's `render()`, then calls `app.render()` once. Static map rendering builds the map layer once at startup.

The source texture set is extracted from `process_gta_map/source/gta1-liberty-city-hd.webp` by `process_gta_map/build-gta-tilemap.py`. The checked-in default runtime assets live in `public/maps/liberty-city` so Vite can serve them directly. See `process_gta_map/README.md` for the reproducible import flow.

## Debug Dashboard

Press `d` to toggle the top-right debug dashboard. The dashboard exposes a tile-type overlay plus `walkable`, `parkable`, and `drivable` overlays backed by the runtime typed arrays. Behavior overlays paint green over tiles where the selected behavior is enabled and red over tiles where it is disabled.

The tile-type overlay paints semantic categories with fixed debug colors: sidewalk gray, road asphalt black, crosswalk road black with white strips, park green, water blue, building slate, and obstacle red.

Each debug overlay layer is built lazily the first time it is enabled, then later toggles only change layer visibility. The overlay builders use the same 16x16 chunk pattern as the city renderer so large behavior masks remain inspectable without mixing debug visuals into the map or actor layers.

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
window.citySim.pause()
window.citySim.play()
window.citySim.setSeed('demo-seed')
window.citySim.restart()
window.citySim.setSpeed(4)
window.citySim.npcs[0].position
window.citySim.npcs[0].movement.target
window.citySim.centerCameraOnCity()
window.citySim.dashboard.setOverlay('walkable', true)
```

## Near-Term Extension Points

- Add focused tests around editor-side validators once the browser editor is split into modules.
- Add route caching or navigation graphs before many NPCs request long paths frequently.
- Add simulation metadata outside the base tile category when infection dynamics need population, occupancy, or district information.
