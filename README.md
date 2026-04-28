# Epi City

Epi City is a top-down city simulation prototype built with Pixi.js and Vite. The current version renders a pre-generated 256x256 Liberty City tile map, supports mouse camera controls, and exposes grid/pathfinding helpers for future NPC and epidemic simulation work.

## Quick Start

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Vite serves `public/liberty-city.json` as `/liberty-city.json`, and the app loads it with `fetch('./liberty-city.json')`.

## Controls

- Hold the left mouse button and drag to pan the camera.
- Use the mouse wheel to zoom around the cursor.
- Press `d` to toggle the debug dashboard in the top-right corner.
- Use the dashboard toggles to overlay `walkable`, `parkable`, and `drivable` behavior layers. Green tiles have the selected behavior, and red tiles do not.
- Use `overlay tile type` to tint semantic tile categories: sidewalk gray, road black, park green, water blue, bridge brown, and building slate.
- Use the browser console to inspect `window.citySim`.

## Project Structure

- `index.html` contains the Pixi app, camera controls, map validation, runtime city API, atlas texture renderer, and pathfinding.
- `public/liberty-city.json` contains the static Liberty City tile map.
- `public/assets/textures/gta/manifest.json` describes the source atlas frames used by the texture set.
- `public/assets/textures/gta/liberty-city-atlas.webp` is the generated runtime atlas copy used by the renderer.
- `process_gta_map/` contains the canonical source image, preprocessing script, and reproducibility notes.
- `map-editor/` contains the interactive map editor, random-forest training loop, and Epi City JSON load/save tools.
- `docs/internal-architecture.md` explains the map format, runtime representation, rendering strategy, and pathfinding behavior.
- `vite.config.ts` configures local development and preview server ports.

## Map Format

The map stores semantics and visuals separately. `rows` contains one legend symbol per cell for gameplay classification. `textureRows` contains one deduplicated source texture ID per cell for exact rendering.

```json
{
  "width": 256,
  "height": 256,
  "tileSize": 32,
  "textureSet": "gta",
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

The runtime supports five base categories: `road`, `sidewalk`, `water`, `bridge`, and `building`. Subcategories preserve semantic detail such as road orientation, waterfront sidewalks, water edge masks, and building roof styles. Each legend entry also stores `walkable`, `drivable`, and `parkable` booleans generated from tile behavior rules.

## Movement Rules

Vehicles use tiles marked `drivable`. Pedestrians use tiles marked `walkable`. Parking logic can use tiles marked `parkable`. Sidewalks are walkable, roadside sidewalks are parkable, parks are walkable only, roads are drivable, mixed curb/road crossing tiles can also be walkable, and water or buildings are blocked.

## NPC Prototype

The app spawns 1000 pedestrian NPCs when the city loads. NPCs render as small `#e5c748` pixel blobs and choose random neighboring walkable tiles.

Each walkable tile has two NPC slots. Collision uses occupied and reserved slot grids, so up to two NPCs can share one tile without stacking visually. Slot anchors sit side by side inside the tile, and NPCs interpolate smoothly between slot positions.

## Debugging From The Console

After the app loads, `window.citySim.city` exposes the main runtime API:

```js
const { city } = window.citySim

city.getTile(10, 10)
city.getTileVariant(10, 10)
city.getTextureId(10, 10)
city.getTextureKey(10, 10)
city.isWalkable(10, 10)
city.isDrivable(10, 10)
city.isParkable(10, 10)
city.isPassable(10, 10, 'vehicle')
city.neighbors(10, 10, 'pedestrian')
city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.npcs.length
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

The dependency command creates or repairs a local Python environment in `map-editor/.venv` and installs `scikit-learn` there. Open `http://localhost:5174`. The map editor starts with an in-browser empty sparse-label map, can load an Epi City JSON file from disk, paints tile type and behavior labels directly into the current map state, trains `sklearn` random-forest classifiers from non-empty labels, stores predictions separately, and applies predictions as one undoable operation. Save As preserves the visual texture layer from a loaded map, requires complete runtime labels, and never overwrites `public/liberty-city.json` automatically.

## Texture Sets

The current texture set is `gta`. The app loads `public/assets/textures/gta/manifest.json`, then loads the atlas image and creates Pixi subtextures from the manifest frame list. The generated manifest deduplicates exact source crops, so repeated map cells share one atlas frame while every cell still matches its original source tile.

In the console, switch texture sets with:

```js
window.citySim.setTextureSet('gta')
```

## Build

Create a production build with:

```bash
npm run build
```

Preview the production build with:

```bash
npm run preview
```
