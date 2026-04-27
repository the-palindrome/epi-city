# Internal Architecture

Epi City currently keeps the implementation in one `index.html` file so early simulation ideas can move quickly. The public map data lives in `public/city-map.json`, while the browser compiles that file into a faster runtime representation after validation.

## Map Data Flow

The app loads `./city-map.json` at startup. Vite serves `public/city-map.json` from the site root, so the same relative fetch works in development and production builds.

Startup follows this sequence:

1. Pixi creates a full-window canvas and a `world` container.
2. The app installs left-drag pan and wheel zoom camera controls.
3. `loadCityMap()` fetches the JSON map and calls `validateCityMap()`.
4. `compileCityMap()` converts row strings into a `Uint8Array`.
5. `renderCity()` draws the map in 16x16 tile chunks.
6. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.

## Map Schema

`public/city-map.json` uses this shape:

```json
{
  "schemaVersion": 1,
  "width": 256,
  "height": 256,
  "tileSize": 32,
  "legend": {
    "r": "road",
    "s": "sidewalk",
    "h": "residential",
    "c": "commercial",
    "w": "water",
    "b": "bridge",
    "p": "park"
  },
  "rows": ["..."]
}
```

Each row must be a string with exactly `width` symbols. The file must contain exactly `height` rows. The validator fails fast for unknown symbols, wrong dimensions, invalid metadata, or legend drift.

## Runtime City Object

`compileCityMap()` returns the runtime city object. `window.citySim.city` exposes it for debugging and later simulation systems.

| Property or method | Purpose |
| --- | --- |
| `width`, `height`, `tileSize` | Map dimensions and world-space tile size. |
| `tiles` | Numeric `Uint8Array` with one tile ID per cell. |
| `index(x, y)` | Converts grid coordinates into a typed-array offset. |
| `getTile(x, y)` | Returns a tile name or `null` outside the map. |
| `getTileId(x, y)` | Returns a numeric tile ID or `null` outside the map. |
| `inBounds(x, y)` | Checks integer grid bounds. |
| `isPassable(x, y, mode)` | Checks movement passability for `vehicle` or `pedestrian`. |
| `neighbors(x, y, mode)` | Returns passable 8-way neighbors with movement costs. |
| `nearestPassableTile(x, y, mode)` | Finds the closest tile usable by the movement mode. |
| `findPath(start, end, mode)` | Runs on-demand A* and returns `{ x, y }` path points. |

The typed-array representation keeps simulation code numeric and predictable. JSON remains the authoring format; `Uint8Array` is the runtime format.

## Movement And Pathfinding

Movement uses two passability masks. Vehicles use `road` and `bridge`; pedestrians use `sidewalk`, `park`, and `bridge`.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Diagonal movement rejects corner cutting by requiring both adjacent cardinal cells to be passable.

`findPath()` currently runs on demand and allocates fresh search arrays per request. This is simple and correct for the current prototype. If hundreds of NPCs request routes every frame, add route caching, hierarchical routing, or per-mode navigation graphs before tuning visual rendering.

## Rendering Strategy

`renderCity()` draws tiles into `PIXI.Graphics` chunks of 16x16 cells. This keeps display-object count low while still allowing the map to be redrawn from the authoritative tile array.

Tile detail is procedural and deterministic. `tileHash(x, y, salt)` creates stable local variation without storing extra art data in the map file. The renderer uses that hash for roof offsets, park details, pavement marks, and water bands.

The `bridge` tile has two visual modes. If nearby water exists, it renders as a bridge deck. Otherwise, it renders as a shared crossing tile at road intersections so pedestrians can cross the road network without adding a separate crosswalk tile type.

## Debugging Hooks

`window.citySim` exposes the Pixi app, camera, world container, layers, tile constants, map data, and compiled city. This is intentional during prototyping because the browser console is the fastest way to inspect paths, passability, and rendering state.

Useful console checks:

```js
window.citySim.city.getTile(100, 100)
window.citySim.city.nearestPassableTile(120, 140, 'pedestrian')
window.citySim.city.findPath({ x: 8, y: 8 }, { x: 240, y: 240 }, 'vehicle')
window.citySim.centerCameraOnCity()
```

## Near-Term Extension Points

- Replace the hand-authored JSON with a procedural generator that outputs the same schema.
- Move code from `index.html` into modules once simulation systems grow beyond the prototype stage.
- Add route caching or navigation graphs before many NPCs request long paths frequently.
- Add actor rendering to `window.citySim.layers.actors` so NPCs stay separate from the static map layer.
- Add simulation metadata outside the single tile enum when infection dynamics need population, occupancy, or district information.
