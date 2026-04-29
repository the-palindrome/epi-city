# Internal Architecture

Epi City currently keeps the implementation in one `index.html` file so early simulation ideas can move quickly. The public Liberty City map package lives in `public/maps/liberty-city`, while the browser compiles the tile layout into a faster runtime representation after validation.

## Map Data Flow

The app loads `./maps/liberty-city/tile-layout.json` at startup. Vite serves `public/maps/liberty-city/tile-layout.json` from the site root, so the same relative fetch works in development and production builds.

Startup follows this sequence:

1. Pixi creates a full-window canvas and a `world` container.
2. The app installs left-drag pan and wheel zoom camera controls.
3. `loadCityMap()` fetches the JSON map and calls `validateCityMap()`.
4. `compileCityMap()` converts semantic rows and texture rows into typed arrays.
5. `loadTextureSet()` loads the selected texture manifest and atlas image.
6. `renderCity()` draws one sprite per map cell, grouped into 16x16 containers.
7. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.
8. `installDebugDashboard()` adds keyboard-controlled behavior overlays for movement debugging.

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
      "subcategory": "horizontal",
      "walkable": false,
      "drivable": true,
      "parkable": false
    }
  },
  "rows": ["..."],
  "textureRows": [[0, 1, 2]]
}
```

Each `rows` entry must be a string with exactly `width` symbols. The file must contain exactly `height` semantic rows. Every symbol must exist in the legend, and every legend entry must include a supported `category`, a `subcategory`, and boolean `walkable`, `drivable`, and `parkable` properties.

Each `textureRows` entry must be an array with exactly `width` integer texture IDs. The texture IDs refer to atlas frames in `public/maps/liberty-city/manifest.json`. This keeps gameplay semantics independent from visual fidelity.

The base categories are `road`, `sidewalk`, `water`, `bridge`, and `building`. Subcategories carry semantic detail such as `horizontal`, `vertical`, `intersection`, `corner-ne`, `waterfront-roadside`, or `large-roof`. Movement uses the generated behavior booleans instead of hard-coded category masks.

## Runtime City Object

`compileCityMap()` returns the runtime city object. `window.citySim.city` exposes it for debugging and later simulation systems.

| Property or method | Purpose |
| --- | --- |
| `width`, `height`, `tileSize` | Map dimensions and world-space tile size. |
| `tiles` | Numeric `Uint8Array` with one base category ID per cell. |
| `tileTextureIds` | Numeric `Uint32Array` with one atlas-frame ID per cell. |
| `tileWalkable`, `tileDrivable`, `tileParkable` | Numeric `Uint8Array` layers with generated gameplay behavior per cell. |
| `legend` | Normalized symbol metadata keyed by map symbol. |
| `index(x, y)` | Converts grid coordinates into a typed-array offset. |
| `getTile(x, y)` | Returns a base category name or `null` outside the map. |
| `getTileId(x, y)` | Returns a numeric category ID or `null` outside the map. |
| `getTileVariant(x, y)` | Returns `{ category, subcategory, walkable, drivable, parkable, textureId }` for a cell. |
| `getTextureId(x, y)` | Returns the atlas-frame ID for a cell. |
| `getTextureKey(x, y)` | Returns a stable debug string such as `tile-123`. |
| `inBounds(x, y)` | Checks integer grid bounds. |
| `isWalkable(x, y)`, `isDrivable(x, y)`, `isParkable(x, y)` | Checks generated tile behavior layers directly. |
| `isPassable(x, y, mode)` | Checks movement passability for `vehicle` or `pedestrian`. |
| `neighbors(x, y, mode)` | Returns passable 8-way neighbors with movement costs. |
| `nearestPassableTile(x, y, mode)` | Finds the closest tile usable by the movement mode. |
| `findPath(start, end, mode)` | Runs on-demand A* and returns `{ x, y }` path points. |

The typed-array representation keeps simulation code numeric and predictable. JSON remains the authoring format; typed arrays are the runtime format.

## Movement And Pathfinding

Movement uses generated behavior layers. Vehicles use `drivable` tiles. Pedestrians use `walkable` tiles. Parking systems can use `parkable` tiles. Water and buildings are not walkable, drivable, or parkable.

The importer derives behavior from tile abstractions rather than hand-filled legend entries. Sidewalks are walkable, roadside sidewalks are also parkable, parks are walkable only, roads are drivable, mixed road/curb crossing tiles are also walkable, bridges are walkable and drivable, and water or buildings are blocked.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Pedestrian movement exposes every adjacent `walkable` tile, including diagonal neighbors. Vehicle movement keeps stricter diagonal corner checks by requiring both adjacent cardinal cells to be drivable.

`findPath()` currently runs on demand and allocates fresh search arrays per request. This is simple and correct for the current prototype. If hundreds of NPCs request routes every frame, add route caching, hierarchical routing, or per-mode navigation graphs before tuning visual rendering.

## NPC Simulation

`createNpcSimulation()` spawns 1000 pedestrian NPCs after the map renders. NPCs start on walkable tile slots, render into one Pixi `Graphics` layer as small `#e5c748` pixel blobs, and move smoothly from slot anchor to slot anchor.

Each walkable tile currently has two side-by-side NPC slots. Collision uses two `Int32Array` grids indexed as `tileIndex * tileCapacity + slot`. `occupiedSlots` stores each NPC's current slot, and `reservedSlots` stores destination slots for NPCs already in motion. An NPC can only start a move when the target tile is walkable and at least one slot is both unoccupied and unreserved.

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

`renderCity()` groups sprites into 16x16 tile containers. Grouping keeps the display tree structured by map region while preserving per-cell source textures. If a texture frame is missing, the renderer draws a simple flat-color fallback for the affected cell.

The source texture set is extracted from `process_gta_map/source/gta1-liberty-city-hd.webp` by `process_gta_map/build-gta-tilemap.py`. The checked-in runtime assets live in `public/maps/liberty-city` so Vite can serve them directly. See `process_gta_map/README.md` for the reproducible import flow.

## Debug Dashboard

Press `d` to toggle the top-right debug dashboard. The dashboard exposes a tile-type overlay plus `walkable`, `parkable`, and `drivable` overlays backed by the runtime typed arrays. Behavior overlays paint green over tiles where the selected behavior is enabled and red over tiles where it is disabled.

The tile-type overlay paints semantic categories with fixed debug colors: sidewalk gray, road asphalt black, park green, water blue, bridge brown, and building slate. Parks are detected through the `sidewalk` category with the `park` subcategory.

`renderDebugOverlays()` redraws only the overlay layer. It uses the same 16x16 chunk pattern as the city renderer so large behavior masks remain inspectable without mixing debug visuals into the map or actor layers.

## Map Editor

The map editor in `map-editor/` is a local maintenance tool for correcting semantic tile labels without changing the source texture atlas. It serves the canonical source image and a browser editor from a separate Node server on port `5174`.

The browser owns the editable map state. Startup creates a default 256x256 sparse-label map where tile type, `walkable`, `parkable`, and `drivable` are all `null`. `Load Atlas`, `Load Tile Configuration`, and `Load Texture Manifest` fill separate browser-side asset slots. When both an atlas and manifest are loaded, the editor reconstructs the visual map from the tile configuration's `textureRows`. `Reset to defaults` discards the current browser state and rebuilds the empty sparse map. `Save Tile Configuration` writes the current editable tile configuration through the browser, and `Save Texture Manifest` writes only the currently loaded atlas-frame manifest, so the editor does not automatically overwrite files under `public/maps/liberty-city`.

Tile configuration loading validates `textureRows` instead of falling back to default texture IDs. The editor status reports whether the current visual preview is rendered from loaded atlas/manifest assets or is waiting for one of those assets.

The editor displays the current map state for every layer. There is no separate sparse-label overlay or hidden generated-label source. A brush stroke directly mutates the current tile type, `walkable`, `parkable`, or `drivable` grid, and each stroke becomes one undoable operation. The explicit `empty` brush value writes `null` back into the selected label layer.

The texture layer edits `textureRows` at the manifest-frame ID level. Its picker samples the texture ID from a clicked tile, then paint strokes copy that ID to other cells. Texture edits share the same undo/redo pipeline as semantic edits, and when an atlas plus manifest are loaded the editor rebuilds the visual map from the updated `textureRows`. Because the runtime reads tile texture IDs from the tile configuration, the editor blocks manifest saves while tile edits are dirty and directs users to `Save Tile Configuration`.

The editor tracks semantic tile-property edits separately from texture-row edits. If a save contains only texture changes, it preserves the loaded `legend` and `rows` and replaces only `textureRows`; semantic edits still rebuild `legend` and `rows` from the editable property grids.

`POST /api/train` runs `map-editor/train_random_forest.py` through the local `map-editor/.venv` interpreter when it exists. The browser posts the full current `rows` and `behaviorRows` grids, and the trainer validates that state before fitting `sklearn.ensemble.RandomForestClassifier` models. Each layer trains only from non-empty labels. Layers without at least two distinct non-empty values are skipped and return their current sparse values unchanged.

Training stores predictions separately from the editable map. `Predict labels` applies the latest prediction to the map as one undoable operation, which lets users inspect training results before committing them. Runtime JSON saving requires complete tile type and behavior labels and reports missing values instead of producing invalid app maps.

The map editor server serves `/`, `/source-image`, `/api/config`, and `/api/train`. Older sparse label and server-side map load/write endpoints return `410 Gone`, which keeps loading and saving explicit in the browser.

Run the map editor with:

```bash
npm run map-editor:deps
npm run map-editor
```

The dependency command creates or repairs `map-editor/.venv` with copied Python binaries, then installs the Python requirements. Set `MAP_EDITOR_BOOTSTRAP_PYTHON` to choose the setup interpreter or `MAP_EDITOR_PYTHON` to choose the runtime training interpreter.

## Debugging Hooks

`window.citySim` exposes the Pixi app, camera, world container, layers, tile constants, map data, compiled city, and texture-set helpers. This is intentional during prototyping because the browser console is the fastest way to inspect paths, passability, textures, and rendering state.

Useful console checks:

```js
window.citySim.city.getTile(100, 100)
window.citySim.city.getTileVariant(100, 100)
window.citySim.city.getTextureId(100, 100)
window.citySim.city.getTextureKey(100, 100)
window.citySim.city.nearestPassableTile(120, 140, 'pedestrian')
window.citySim.city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.centerCameraOnCity()
window.citySim.dashboard.setOverlay('walkable', true)
```

## Near-Term Extension Points

- Move code from `index.html` into modules once simulation systems grow beyond the prototype stage.
- Add route caching or navigation graphs before many NPCs request long paths frequently.
- Add actor rendering to `window.citySim.layers.actors` so NPCs stay separate from the static map layer.
- Add simulation metadata outside the base tile category when infection dynamics need population, occupancy, or district information.
