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
- Use the browser console to inspect `window.citySim`.

## Project Structure

- `index.html` contains the Pixi app, camera controls, map validation, runtime city API, atlas texture renderer, and pathfinding.
- `public/liberty-city.json` contains the static Liberty City tile map.
- `public/assets/textures/gta/manifest.json` describes the source atlas frames used by the texture set.
- `public/assets/textures/gta/liberty-city-atlas.webp` is the generated runtime atlas copy used by the renderer.
- `process_gta_map/` contains the canonical source image, preprocessing script, and reproducibility notes.
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
      "subcategory": "horizontal"
    }
  },
  "rows": ["..."],
  "textureRows": [[0, 1, 2]]
}
```

The runtime supports five base categories: `road`, `sidewalk`, `water`, `bridge`, and `building`. Subcategories preserve semantic detail such as road orientation, waterfront sidewalks, water edge masks, and building roof styles.

## Movement Rules

Vehicles can use `road` and `bridge` tiles. Pedestrians can use `sidewalk` and `bridge` tiles. `water` and `building` tiles are blocked for both modes.

## Debugging From The Console

After the app loads, `window.citySim.city` exposes the main runtime API:

```js
const { city } = window.citySim

city.getTile(10, 10)
city.getTileVariant(10, 10)
city.getTextureId(10, 10)
city.getTextureKey(10, 10)
city.isPassable(10, 10, 'vehicle')
city.neighbors(10, 10, 'pedestrian')
city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
```

The API supports two movement modes: `vehicle` and `pedestrian`. Pathfinding snaps invalid start and end points to the nearest passable tile for the selected mode.

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
