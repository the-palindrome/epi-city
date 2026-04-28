# Epi City Map Editor

This is the project tool for manually labeling source-map tiles before training classifiers and writing corrected Epi City map JSON.

## Run

From the repository root:

```bash
npm run map-editor:deps
npm run map-editor
```

Open `http://localhost:5174`.

The dependency command creates `map-editor/.venv` and installs the Python training packages there. The server automatically uses that local Python environment when it exists. To use a different interpreter, start the server with `MAP_EDITOR_PYTHON=/path/to/python npm run map-editor`.

Set a different port when needed:

```bash
PORT=5180 npm run map-editor
```

## What It Loads

- Source image: `process_gta_map/source/gta1-liberty-city-hd.webp`
- Current generated map: `public/liberty-city.json`
- Label output: `map-editor/labels/tile-labels.json`

The source image is split into the same 256x256 proportional grid used by `process_gta_map/build-gta-tilemap.py`.

## Label Layers

Use the `Paint layer` selector to choose what you are labeling:

- `tile type`: `road`, `sidewalk`, `park`, `water`, `bridge`, or `building`.
- `walkable`: `true`, `false`, or `erase`.
- `parkable`: `true`, `false`, or `erase`.
- `drivable`: `true`, `false`, or `erase`.

The generated overlay always shows the currently selected layer. The manual overlay also shows only the currently selected layer, which keeps behavior labels easy to inspect.

## Random Forest Training

Click `Train random forest` after saving or painting labels. The app saves the current label file, trains local random-forest models, predicts every tile, and switches the overlay source to `model prediction`.

Training uses `map-editor/train_random_forest.py`, which wraps `sklearn.ensemble.RandomForestClassifier`. Each layer trains independently:

- `tile type` trains from `typeLabels`.
- `walkable` trains from `behaviorLabels.walkable`.
- `parkable` trains from `behaviorLabels.parkable`.
- `drivable` trains from `behaviorLabels.drivable`.

A layer needs at least two distinct classes or boolean values before it can train. Layers without enough labels fall back to the current map classification. After prediction, paint corrections with the brush and click `Train random forest` again to iterate.

## Epi City JSON Round-Trip

Use `Load Epi JSON` to reload the currently loaded map JSON classification into the map editor. The default loaded map is `public/liberty-city.json`. Manual brush labels remain active as overrides, so you can reload the base map without losing training examples.

Use `Save Epi JSON` to write the active overlay source back into the loaded map JSON in the app's runtime map format. The save operation:

- Uses the selected overlay source: `current map` or `model prediction`.
- Applies all manual tile-type and behavior labels as overrides.
- Preserves `textureRows`, `textureSet`, `width`, `height`, and `tileSize`.
- Regenerates the compact semantic `legend` and `rows` fields.

This updates the app-facing map JSON. The texture atlas is not modified.

Use `Reset labels` to clear all manual labels in the editor. The reset does not modify `map-editor/labels/tile-labels.json` until you click `Save labels`.

## Controls

- Left drag paints labels.
- Right drag, middle drag, or hold `Space` to pan.
- Mouse wheel zooms around the cursor.
- For tile type: `1` road, `2` sidewalk, `3` park, `4` water, `5` bridge, `6` building, `e` erase.
- For behavior layers: `t` true, `f` false, `e` erase.
- `Ctrl+S` saves labels.
- `Ctrl+Z` undoes.
- `Ctrl+Y` redoes.

Use the generated-classification overlay to find weak areas, then paint representative correct labels on top. You do not need to label every tile; label enough varied examples for each class and behavior state.

## Output Format

```json
{
  "sourceImage": "process_gta_map/source/gta1-liberty-city-hd.webp",
  "generatedMap": "public/liberty-city.json",
  "gridSize": 256,
  "typeLabels": [
    { "x": 12, "y": 40, "label": "road" }
  ],
  "behaviorLabels": {
    "walkable": [
      { "x": 12, "y": 40, "value": false }
    ],
    "parkable": [],
    "drivable": []
  }
}
```

The next processing step will train classifiers from this file and rewrite the semantic rows and behavior booleans in `public/liberty-city.json`.
