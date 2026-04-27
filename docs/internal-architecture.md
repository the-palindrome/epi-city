# Internal Architecture

Epi City currently keeps the implementation in one `index.html` file so early simulation ideas can move quickly. The public map data lives in `public/liberty-city.json`, while the browser compiles that file into a faster runtime representation after validation.

## Map Data Flow

The app loads `./liberty-city.json` at startup. Vite serves `public/liberty-city.json` from the site root, so the same relative fetch works in development and production builds.

Startup follows this sequence:

1. Pixi creates a full-window canvas and a `world` container.
2. The app installs left-drag pan and wheel zoom camera controls.
3. `loadCityMap()` fetches the JSON map and calls `validateCityMap()`.
4. `compileCityMap()` converts semantic rows and texture rows into typed arrays.
5. `loadTextureSet()` loads the selected texture manifest and atlas image.
6. `renderCity()` draws one sprite per map cell, grouped into 16x16 containers.
7. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.

## Map Schema

`public/liberty-city.json` uses this shape:

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

Each `rows` entry must be a string with exactly `width` symbols. The file must contain exactly `height` semantic rows. Every symbol must exist in the legend, and every legend entry must include a supported `category` and a `subcategory`.

Each `textureRows` entry must be an array with exactly `width` integer texture IDs. The texture IDs refer to atlas frames in `public/assets/textures/gta/manifest.json`. This keeps gameplay semantics independent from visual fidelity.

The base categories are `road`, `sidewalk`, `water`, `bridge`, and `building`. Subcategories carry semantic detail without changing movement masks. For example, a road can be `horizontal`, `vertical`, `intersection`, `corner-ne`, or another orientation-specific variant.

## Runtime City Object

`compileCityMap()` returns the runtime city object. `window.citySim.city` exposes it for debugging and later simulation systems.

| Property or method | Purpose |
| --- | --- |
| `width`, `height`, `tileSize` | Map dimensions and world-space tile size. |
| `tiles` | Numeric `Uint8Array` with one base category ID per cell. |
| `tileTextureIds` | Numeric `Uint32Array` with one atlas-frame ID per cell. |
| `legend` | Normalized symbol metadata keyed by map symbol. |
| `index(x, y)` | Converts grid coordinates into a typed-array offset. |
| `getTile(x, y)` | Returns a base category name or `null` outside the map. |
| `getTileId(x, y)` | Returns a numeric category ID or `null` outside the map. |
| `getTileVariant(x, y)` | Returns `{ category, subcategory, textureId }` for a cell. |
| `getTextureId(x, y)` | Returns the atlas-frame ID for a cell. |
| `getTextureKey(x, y)` | Returns a stable debug string such as `tile-123`. |
| `inBounds(x, y)` | Checks integer grid bounds. |
| `isPassable(x, y, mode)` | Checks movement passability for `vehicle` or `pedestrian`. |
| `neighbors(x, y, mode)` | Returns passable 8-way neighbors with movement costs. |
| `nearestPassableTile(x, y, mode)` | Finds the closest tile usable by the movement mode. |
| `findPath(start, end, mode)` | Runs on-demand A* and returns `{ x, y }` path points. |

The typed-array representation keeps simulation code numeric and predictable. JSON remains the authoring format; typed arrays are the runtime format.

## Movement And Pathfinding

Movement uses two passability masks. Vehicles use `road` and `bridge`. Pedestrians use `sidewalk` and `bridge`. `water` and `building` are blocked.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Diagonal movement rejects corner cutting by requiring both adjacent cardinal cells to be passable.

`findPath()` currently runs on demand and allocates fresh search arrays per request. This is simple and correct for the current prototype. If hundreds of NPCs request routes every frame, add route caching, hierarchical routing, or per-mode navigation graphs before tuning visual rendering.

## Texture Sets

A texture set lives under `public/assets/textures/<name>`. The current `gta` manifest stores one source atlas and a list of deduplicated source frames:

```json
{
  "name": "gta",
  "tileSize": 32,
  "atlas": {
    "file": "gta1-liberty-city-hd.webp",
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

`renderCity()` groups sprites into 16x16 tile containers. Grouping keeps the display tree structured by map region while preserving per-cell source textures. If a texture frame is missing, the renderer draws a simple flat-color fallback for the affected cell.

The source texture set is extracted from `tmp/liberty_city_gangsta_bang_map/source/gta1-liberty-city-hd.webp`. The checked-in runtime assets live in `public/assets/textures/gta` so Vite can serve them directly.

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
```

## Near-Term Extension Points

- Move code from `index.html` into modules once simulation systems grow beyond the prototype stage.
- Add route caching or navigation graphs before many NPCs request long paths frequently.
- Add actor rendering to `window.citySim.layers.actors` so NPCs stay separate from the static map layer.
- Add simulation metadata outside the base tile category when infection dynamics need population, occupancy, or district information.
