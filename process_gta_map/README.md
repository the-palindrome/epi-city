# GTA Map Processing

This folder contains the reproducible import pipeline for the Liberty City map used by Epi City.

## Contents

- `source/gta1-liberty-city-hd.webp` is the canonical downloaded source image.
- `build-gta-tilemap.py` converts the source image into raw importer map and texture assets.

## Generated Files

Running the script writes ignored raw importer output:

- `process_gta_map/output/liberty-city-raw/tile-layout.json`
- `process_gta_map/output/liberty-city-raw/texture-layout.json`
- `process_gta_map/output/liberty-city-raw/manifest.json`
- `process_gta_map/output/liberty-city-raw/liberty-city-atlas.webp`
- `process_gta_map/output/gta-256-textured-preview.png`

The generated `process_gta_map/output/` files are local inspection outputs ignored by Git. The app defaults to `public/maps/liberty-city/`, which is the curated/editor-reviewed package with semantic corrections and building metadata.

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
6. Writes `texture-layout.json` so every cell points to its exact source tile frame.
7. Verifies each `textureRows` entry against the original source pixels.
8. Writes a preview image to `process_gta_map/output/gta-256-textured-preview.png`.

The script prints current dedupe stats after it runs.

## Verify The App

After regenerating, run:

```bash
npm run build
```

For visual inspection, open the preview:

```bash
xdg-open process_gta_map/output/gta-256-textured-preview.png
```

The preview should match the source map tile-by-tile. If it does not, treat the preprocessing script as the source of truth and fix the importer rather than manually editing generated output files.

To promote regenerated raw assets into the default `public/maps/liberty-city/` package, review the generated output, load the relevant files in the map editor, apply semantic/building corrections, then save over the runtime package files intentionally. Do not copy raw importer output directly into `public/maps/liberty-city/` without that review step.

## Notes

- The map format is intentionally unversioned while the app is pre-release.
- `rows` stores gameplay semantics through legend symbols in `tile-layout.json`.
- The legend stores generated `walkable`, `drivable`, and `parkable` booleans for each symbol.
- `textureRows` stores exact atlas frame IDs for rendering in `texture-layout.json`.
