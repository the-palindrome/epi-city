# Internal Architecture

Epi City currently keeps the implementation in one `index.html` file so early simulation ideas can move quickly. The public map data lives in `public/liberty-city.json`, while the browser compiles that file into a faster runtime representation after validation.

## Map Data Flow

The app loads `./liberty-city.json` at startup. Vite serves `public/liberty-city.json` from the site root, so the same relative fetch works in development and production builds.
There is currently no procedural generator in the project. Map JSON is checked in as a static asset.

Startup follows this sequence:

1. Pixi creates a full-window canvas and a `world` container.
2. The app installs left-drag pan and wheel zoom camera controls.
3. `loadCityMap()` fetches the JSON map and calls `validateCityMap()`.
4. `compileCityMap()` converts row strings into a `Uint8Array`.
5. `renderCity()` draws the map in 16x16 tile chunks.
6. `centerCameraOnCity()` fits the 8192x8192 world into the viewport.

## Map Schema

`public/liberty-city.json` uses this shape:

```json
{
  "schemaVersion": 1,
  "width": 512,
  "height": 512,
  "tileSize": 16,
  "legend": {
    "r": "road",
    "s": "sidewalk",
    "h": "residential",
    "c": "commercial",
    "w": "water",
    "b": "bridge",
    "p": "park",
    "x": "structure",
    "m": "crossing"
  },
  "rows": ["..."]
}
```

Each row must be a string with exactly `width` symbols. The file must contain exactly `height` rows. The validator fails fast for unknown symbols, wrong dimensions, invalid metadata, or legend drift.

The current map is a static import from a source image. It preserves source shorelines and allows water to reach the map boundary naturally. The `x`/`structure` tile is non-passable and exists to keep dark roof, dock, and structural details visually readable without treating those details as driveable roads. The `m`/`crossing` tile renders like road while remaining passable to both vehicles and pedestrians.

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

Movement uses two passability masks. Vehicles use `road`, `bridge`, and `crossing`; pedestrians use `sidewalk`, `park`, `bridge`, and `crossing`. Residential, commercial, water, and structure tiles are blocked.

A* uses 8-way movement with costs of `10` for cardinal moves and `14` for diagonal moves. The heuristic uses octile distance, which matches the movement model. Diagonal movement rejects corner cutting by requiring both adjacent cardinal cells to be passable.

`findPath()` currently runs on demand and allocates fresh search arrays per request. This is simple and correct for the current prototype. If hundreds of NPCs request routes every frame, add route caching, hierarchical routing, or per-mode navigation graphs before tuning visual rendering.

## Rendering Strategy

`renderCity()` draws tiles into `PIXI.Graphics` chunks of 16x16 cells. This keeps display-object count low while still allowing the map to be redrawn from the authoritative tile array.

Tile graphics stay intentionally minimal. Each tile type uses a flat fill, and the renderer only draws borders where neighboring cells leave the same visual group. This makes contiguous roads, sidewalks, parks, building blocks, and water regions read as connected areas instead of repeated tile stamps.

Waterfront land cells should generally be walkable `sidewalk` cells rather than building blocks so future pedestrian NPCs can move along shorelines.

The `bridge` tile has two visual modes. Rendering checks nearby water to decide whether a bridge cell should read as deck/rails or as normal asphalt.

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

- Keep map JSON schema stable so a future generator or editor can output the same format.
- Move code from `index.html` into modules once simulation systems grow beyond the prototype stage.
- Add route caching or navigation graphs before many NPCs request long paths frequently.
- Add actor rendering to `window.citySim.layers.actors` so NPCs stay separate from the static map layer.
- Add simulation metadata outside the single tile enum when infection dynamics need population, occupancy, or district information.
