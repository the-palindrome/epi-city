# Procedural Generator

This document describes the procedural city generator in `city-generator.js`. The generator replaces hand-authored map rows without changing the app-facing map schema or runtime city API.

## Goals

- Produce city layouts with readable districts, road hierarchy, sidewalks, parks, water, and bridges.
- Return map data that passes the existing `city-map.json` validator unchanged.
- Keep generation deterministic for a given seed so bugs and interesting maps can be reproduced.
- Separate semantic planning from final tile emission so future simulation systems can reuse district and network decisions.

## Public API

`city-generator.js` should export these names:

```js
export const defaultCityGeneratorConfig = { ... }

export class CityMapGenerator {
  constructor(config = defaultCityGeneratorConfig) {}
  generate(overrides = {}) {}
}
```

`generate()` returns a `GeneratedCity` object. The Pixi app does not run this generator at startup; use the command-line interface to write a pre-generated `public/city-map.json` file.

Suggested usage:

```js
import { CityMapGenerator } from './city-generator.js'

const generator = new CityMapGenerator()
const generatedCity = generator.generate({
  seed: 'downtown-001',
  width: 192,
  height: 192,
  tileSize: 32
})
validateCityMap(generatedCity.tiles)
const city = compileCityMap(generatedCity.tiles)
```

Command-line usage:

```bash
node city-generator.js --seed downtown-001 --width 256 --height 256 --tileSize 32 --edgeBand 6 --out public/city-map.json --pretty
```

## Config

`defaultCityGeneratorConfig` includes stable defaults for:

| Option | Purpose |
| --- | --- |
| `seed` | String or number used by the deterministic RNG. |
| `width`, `height` | Tile dimensions. The generator must use these inputs for all semantic layers and emitted rows. |
| `tileSize` | World-space tile size. The generator must copy this value into the emitted tile map. |
| `edgeBand` | Non-passable outer band width. Land edges become buildings, while water is preserved. |
| `arterialSpacing` | Approximate spacing for major roads. |
| `collectorSpacing` | Approximate spacing for secondary roads. |
| `waterCoverageTarget` | Approximate fraction of the map covered by water. |
| `bridgeChance` | Random priority boost for eligible road-water crossings. |
| `maxWaterBridges` | Hard cap for water-crossing bridge corridors. |
| `minBridgeDistance` | Minimum spacing between selected water bridge corridors. |
| `parkChance` | Chance for eligible blocks to become parks. |
| `landmarkCount` | Number of landmark anchors to place. |

Keep config serializable. Avoid functions in default config so seeds and map recipes can be logged or saved.

## Output Shape

`GeneratedCity` must match schema version 1:

```js
{
  schemaVersion: 1,
  width: config.width,
  height: config.height,
  tileSize: config.tileSize,
  legend: {
    r: 'road',
    s: 'sidewalk',
    h: 'residential',
    c: 'commercial',
    w: 'water',
    b: 'bridge',
    p: 'park'
  },
  rows: ['...']
}
```

Each entry in `rows` is a string of exactly `width` one-character symbols. The row count is exactly `height`. The generator may keep richer internal layers while building the city, but the app-facing `tiles` object should only include fields understood by the current app unless the schema version is deliberately advanced.

The `tiles` term in generator code should refer to the emitted symbol grid before it is converted to row strings. It must map one-to-one with the existing city-map symbols and compile into the runtime `Uint8Array` without special cases.

## Intended Pipeline

1. Normalize config and create a seeded RNG.
2. Allocate semantic layers for terrain, districts, mobility, and constraints.
3. Reserve the outer edge band as non-passable tiles, preserving water where terrain reaches the boundary.
4. Generate coarse terrain from one of several water recipes: bent canals, harbor cuts, parallel channels, archipelago lagoons, or cross-map cuts.
5. Lay down a hierarchical road network with arterials first, then collectors and local roads.
6. Score water-crossing candidates and keep only a few high-value bridges.
7. Expand sidewalks around roads and bridge approaches.
8. Partition remaining buildable land into residential, commercial, and park districts.
9. Smooth small artifacts while preserving connectivity and required boundaries.
10. Emit the final symbol grid, convert it to `rows`, validate, and return `GeneratedCity`.

## Semantic Layers

Use separate internal layers instead of writing directly to final symbols too early:

| Layer | Responsibility |
| --- | --- |
| Terrain | Water, land, and protected edge cells. |
| Mobility | Roads, sidewalks, bridges, crossings, and connectivity targets. |
| District | Residential, commercial, park, waterfront, and civic intent. |
| Constraints | Reserved cells that later passes must not overwrite. |
| Emission | Final `r`, `s`, `h`, `c`, `w`, `b`, and `p` symbols. |

Layer order matters. Terrain and constraints should win over districts. Mobility should override districts where roads, sidewalks, or bridges are required. Emission should be the only layer that knows about the compact row-string format.

## Validation Rules

The generator should run local checks before returning:

- `schemaVersion` is `1`.
- `width`, `height`, and `tileSize` are positive integers.
- `legend` exactly matches the current required symbol-to-tile names.
- `rows.length === height`.
- Every row is a string with length `width`.
- Every symbol is one of `r`, `s`, `h`, `c`, `w`, `b`, or `p`.
- The outer `edgeBand` contains no pedestrian- or vehicle-passable tiles unless exits are intentionally added later; water may continue through the band.
- Water generation should vary between recipes instead of always using the same pair of channels.
- Vehicle connectivity has readable components connected by a small number of bridge bottlenecks.
- The generated vehicle road layer should be one connected component after tiny road specks are removed.
- Roads should use even-width corridors so lane counts read consistently.
- Pedestrian connectivity has useful access across `sidewalk`, `park`, and `bridge` tiles.
- Roads crossing water use `bridge`; raw `road` should not overwrite `water`.
- Pedestrian crossings may also use `bridge`, but the generator avoids adding those crossing tiles right against shorelines so they do not read as stray water bridges.
- Sidewalk emission should not leave one-tile `road`/`sidewalk`/`road` slivers between parallel roads.
- Tiny isolated islands of sidewalk, road, park, or water are removed or connected.

The app should still call `validateCityMap()` after generation. Generator validation catches design mistakes; app validation protects runtime assumptions.

## App Usage

The app keeps the existing `loadCityMap() -> validateCityMap() -> compileCityMap() -> renderCity()` path intact.

Recommended workflow:

1. Run `node city-generator.js` or `npm run generate:map` before starting the app.
2. Write output to `public/city-map.json`.
3. Start Vite with `npm run dev`.
4. Let the app validate and compile the pre-generated JSON.
5. Record the seed and config used for maps that should be reproduced later.

Do not make renderers, pathfinding, or simulation systems depend on generator internals. They should continue to consume only the compiled runtime city object.

## Contributor Notes

Prefer deterministic, testable passes over one large random fill. When changing generator behavior, add focused tests or console checks for schema validity, edge-band safety, and pedestrian/vehicle connectivity. If the output schema needs metadata beyond row strings, introduce a new schema version instead of adding silent optional fields to version 1.
