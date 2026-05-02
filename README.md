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
- Press `d` to toggle the debug dashboard in the top-right corner.
- Use the dashboard toggles to overlay `walkable`, `parkable`, and `drivable` behavior layers. Green tiles have the selected behavior, and red tiles do not.
- Use `overlay tile type` to tint semantic tile categories: sidewalk gray, road black, park green, water blue, building slate, and obstacle red.
- Use the browser console to inspect `window.citySim`.

## Project Structure

- `index.html` is the app shell and loads the Vite module entrypoint.
- `src/` contains the runtime modules: map validation/compilation, Pixi rendering, camera controls, game loop, debug dashboard, and NPC simulation.
- `public/maps/liberty-city/tile-layout.json` contains the default static Liberty City semantic tile layout.
- `public/maps/liberty-city/texture-layout.json` contains one atlas-frame texture ID per map cell.
- `public/maps/liberty-city/manifest.json` describes the Liberty City atlas frames used by the default texture set.
- `public/maps/liberty-city/liberty-city-atlas.webp` is the generated runtime atlas copy used by the renderer.
- `process_gta_map/` contains the canonical source image, preprocessing script, and reproducibility notes.
- `map-editor/` contains the interactive map editor, random-forest training loop, and Epi City JSON load/save tools.
- `docs/internal-architecture.md` explains the map format, runtime representation, rendering strategy, and pathfinding behavior.
- `vite.config.ts` configures local development and preview server ports.

## Map Format

The map stores semantics and visuals in separate JSON files. `tile-layout.json` contains one legend symbol per cell for gameplay classification plus a compact `buildings` list for connected building components. `texture-layout.json` contains one deduplicated source texture ID per cell for exact rendering. Tile-to-texture assignments do not live in the texture manifest, so texture painting in the editor must be saved with `Save Texture Rows`.

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

```json
{
  "width": 256,
  "height": 256,
  "textureSet": "liberty-city",
  "textureRows": [[0, 1, 2]]
}
```

The runtime supports six base categories: `road`, `sidewalk`, `park`, `water`, `building`, and `obstacle`. Each legend entry also stores `walkable`, `drivable`, and `parkable` booleans generated from tile behavior rules. Building components are stored as 8-connected row spans with an `id` and `type`.

## Movement Rules

Vehicles use tiles marked `drivable`. Pedestrians use tiles marked `walkable`. Parking logic can use tiles marked `parkable`. In the default map, roads are drivable only; sidewalks and parks are walkable only; water, buildings, and obstacles are blocked.

## NPC Prototype

The app spawns 1000 pedestrian NPCs when the city loads. NPCs keep `position`, `tile`, `slot`, and `movement` state, render as small `#e5c748` pixel blobs, and choose random neighboring walkable tiles.

Each walkable tile has two NPC slots. Collision uses occupied and reserved slot grids, so up to two NPCs can share one tile without stacking visually. Slot anchors sit side by side inside the tile, and NPCs interpolate smoothly between slot positions.

The runtime uses a single browser animation loop with the game-development shape `dt = getDeltaTime()`, `update(dt)`, then `render()`. Simulation systems update first; rendering systems draw their retained Pixi objects; finally Pixi presents the stage.

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
city.isPassable(10, 10, 'vehicle')
city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.gameLoop.running
window.citySim.npcs.length
window.citySim.npcs[0].position
```

The API supports two movement modes: `vehicle` and `pedestrian`. Pathfinding snaps invalid start and end points to the nearest passable tile for the selected mode.

The debug dashboard is available through `window.citySim.dashboard`. It exposes `setOverlay(id, enabled)`, `toggle(force)`, and `render()` for quick checks from the console:

```js
window.citySim.dashboard.toggle(true)
window.citySim.dashboard.setOverlay('walkable', true)
window.citySim.dashboard.setOverlay('drivable', true)
```

## Map Editor

Install the Python training dependencies and start the map editor:

```bash
npm run map-editor:deps
npm run map-editor
```

The dependency command creates or repairs a local Python environment in `map-editor/.venv` and installs `scikit-learn` there. Open `http://localhost:5174`. The editor starts from an empty semantic layout plus the current Liberty City texture rows, atlas, and texture manifest. Use `Save Tile Configuration` for semantic rows/buildings and `Save Texture Rows` for visual tile assignments. Neither action overwrites files under `public/maps/liberty-city` automatically.

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

Preview the production build with:

```bash
npm run preview
```
