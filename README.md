# Epi City

Epi City is a top-down city simulation prototype built with Pixi.js and Vite. The current version renders a 256x256 tile city, supports mouse camera controls, and exposes grid/pathfinding helpers for future NPC and epidemic simulation work.

## Quick Start

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Vite serves `public/city-map.json` as `/city-map.json`, which lets the app load the city layout with a normal `fetch('./city-map.json')` request.

## Controls

- Hold left mouse button and drag to pan the camera.
- Use the mouse wheel to zoom around the cursor.
- Use the browser console to inspect `window.citySim`.

## Project Structure

- `index.html` contains the Pixi app, camera controls, map validation, runtime city API, renderer, and pathfinding.
- `public/city-map.json` contains the externally authored tile map that Vite serves at runtime.
- `docs/internal-architecture.md` explains the map format, runtime representation, rendering strategy, and pathfinding behavior.
- `vite.config.ts` configures local development and preview server ports.

## City Tiles

The map uses one symbol per cell. The app validates every symbol before it compiles the map into a numeric `Uint8Array`.

| Symbol | Tile type | Vehicle passable | Pedestrian passable |
| --- | --- | --- | --- |
| `r` | road | yes | no |
| `s` | sidewalk | no | yes |
| `h` | residential | no | no |
| `c` | commercial | no | no |
| `w` | water | no | no |
| `b` | bridge | yes | yes |
| `p` | park | no | yes |

The `bridge` tile currently does two jobs: it represents water crossings and shared road-crossing tiles. Rendering checks nearby water to draw those cases differently.

## Debugging From The Console

After the app loads, `window.citySim.city` exposes the main runtime API:

```js
const { city } = window.citySim

city.getTile(10, 10)
city.isPassable(10, 10, 'vehicle')
city.neighbors(10, 10, 'pedestrian')
city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
```

The API supports two movement modes: `vehicle` and `pedestrian`. Pathfinding snaps invalid start and end points to the nearest passable tile for the selected mode.

## Build

Create a production build with:

```bash
npm run build
```

Preview the production build with:

```bash
npm run preview
```
