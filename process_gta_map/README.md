# GTA Map Processing

This folder contains the reproducible import pipeline for the Liberty City map used by Epi City.

## Contents

- `source/gta1-liberty-city-hd.webp` is the canonical downloaded source image.
- `build-gta-tilemap.py` converts the source image into the runtime map and texture assets.

## Generated Files

Running the script updates these runtime files:

- `public/maps/liberty-city/tile-layout.json`
- `public/maps/liberty-city/manifest.json`
- `public/maps/liberty-city/liberty-city-atlas.webp`
- `process_gta_map/output/gta-256-textured-preview.png`

The `process_gta_map/output/` preview is local inspection output and is ignored by Git. The `public/` files are the app-facing generated artifacts.

## Requirements

Use Python 3 with Pillow and NumPy available:

```bash
python3 -m pip install pillow numpy
```

The current dev container already has these packages installed.

## Regenerate The Map

From the repository root, run:

```bash
python3 process_gta_map/build-gta-tilemap.py
```

The script performs these steps:

1. Loads `process_gta_map/source/gta1-liberty-city-hd.webp`.
2. Classifies each of the 256x256 grid cells into gameplay categories.
3. Applies tile behavior abstractions to generate `walkable`, `drivable`, and `parkable` legend properties.
4. Decomposes the source image into 65,536 source tiles.
5. Deduplicates exact duplicate source crops.
6. Writes `textureRows` so every cell points to its exact source tile frame.
7. Verifies each `textureRows` entry against the original source pixels.
8. Writes a preview image to `process_gta_map/output/gta-256-textured-preview.png`.

Expected current stats:

```text
source tiles checked: 65536
unique tiles: 64193
duplicates removed: 1343
```

## Verify The App

After regenerating, run:

```bash
npm run build
```

For visual inspection, open the preview:

```bash
xdg-open process_gta_map/output/gta-256-textured-preview.png
```

The preview should match the source map tile-by-tile. If it does not, treat the preprocessing script as the source of truth and fix the importer rather than manually editing `public/maps/liberty-city/tile-layout.json`.

## Notes

- The map format is intentionally unversioned while the app is pre-release.
- `rows` stores gameplay semantics through legend symbols.
- The legend stores generated `walkable`, `drivable`, and `parkable` booleans for each symbol.
- `textureRows` stores exact atlas frame IDs for rendering.
- Do not keep legacy import formats in this folder.
