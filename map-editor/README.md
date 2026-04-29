# Epi City Map Editor

The map editor is a local maintenance tool for correcting semantic tile types and behavior attributes while keeping the source texture atlas unchanged. It can load the atlas image, tile configuration, texture rows, and texture manifest separately, keeps one editable 256x256 map state in the browser, trains from sparse labels, and saves tile configuration, texture rows, and manifest JSON through browser Save As flows.

## Run

From the repository root:

```bash
npm run map-editor:deps
npm run map-editor
```

Open `http://localhost:5174`.

The dependency command creates or repairs `map-editor/.venv` and installs the Python training packages there. The setup uses copied Python binaries instead of symlinks, which makes broken or partially-created virtualenvs easier to recover from. The server automatically uses that local Python environment when it exists.

To choose the setup interpreter, run:

```bash
MAP_EDITOR_BOOTSTRAP_PYTHON=/path/to/python npm run map-editor:deps
```

To choose the runtime training interpreter, run:

```bash
MAP_EDITOR_PYTHON=/path/to/python npm run map-editor
```

Set a different port when needed:

```bash
PORT=5180 npm run map-editor
```

## Source Image

The editor serves `process_gta_map/source/gta1-liberty-city-hd.webp` as the visual reference. It splits that image into the same 256x256 proportional grid used by `process_gta_map/build-gta-tilemap.py`.

The source image is read-only. Editing labels never changes the atlas or the extracted texture files.

## Startup State

When a tile configuration is incomplete, the editor represents missing labels with explicit empty values:

```json
{
  "type": null,
  "walkable": null,
  "parkable": null,
  "drivable": null
}
```

On startup, the default semantic state is a 256x256 empty tile configuration: tile type, `walkable`, `parkable`, and `drivable` are all `null`. The current `public/maps/liberty-city/texture-layout.json`, default Liberty City atlas, and texture manifest are loaded for an immediate texture preview. The editable state exists only in the browser until you save it.

## Loading Maps

Click `Load Atlas` to choose the atlas image used by the current texture manifest. The editor accepts WebP, PNG, or JPEG images. This replaces the default atlas preview for the browser session.

Click `Load Tile Configuration` to choose an Epi City tile configuration JSON such as `public/maps/liberty-city/tile-layout.json`. The browser reads the file and replaces the editable tile state.

Click `Load Texture Rows` to choose an Epi City texture rows JSON such as `public/maps/liberty-city/texture-layout.json`. The browser reads the file and replaces the editable `textureRows` state without changing tile semantics.

Click `Load Texture Manifest` to choose a texture manifest JSON such as `public/maps/liberty-city/manifest.json`. When both an atlas and manifest are loaded, the editor reconstructs the visual map from `textureRows` and manifest frames.

The editor does not automatically overwrite `public/maps/liberty-city/tile-layout.json` or `texture-layout.json`. It starts from an empty semantic layout and the current Liberty City visual assets by default, but you can still load another tile configuration, texture rows file, atlas, or manifest explicitly. Use `Save Tile Configuration` for semantic edits and `Save Texture Rows` for texture edits.

Texture rows loading requires a valid 256x256 `textureRows` grid. The editor reports the number of unique texture IDs it loaded and previews those IDs whenever an atlas and texture manifest are present.

## Editing State

The editor always displays the current editable map state. There is no separate manual-label overlay or hidden generated-label layer. Painting with the brush directly changes the current map state.

Use the `Paint layer` selector to choose what the brush updates:

- `tile type` sets the tile to empty, `road`, `sidewalk`, `park`, `water`, `bridge`, or `building`.
- `texture` picks and paints manifest frame IDs in `textureRows`.
- `walkable` sets the current tile's walkable value to empty, `true`, or `false`.
- `parkable` sets the current tile's parkable value to empty, `true`, or `false`.
- `drivable` sets the current tile's drivable value to empty, `true`, or `false`.

Painting a tile type does not auto-fill behavior attributes. This keeps labels sparse and lets the trainer learn each layer independently.

In the texture layer, the `pick texture` tool samples the texture ID from the clicked tile. The editor then switches to painting that texture ID onto other tiles. Texture edits update `textureRows`, so `Save Texture Rows` writes the changed manifest-frame references without changing atlas pixels or manifest frame geometry. `Save Texture Manifest` does not update the app map after texture painting.

When only texture assignments changed, `Save Texture Rows` updates `textureRows` without touching the loaded `legend` and semantic `rows`. This keeps texture retouching from creating tile-property diffs.

## Training And Prediction

Click `Train random forest` to train from the current sparse labels. The browser posts the full `rows` and `behaviorRows` grids to the local server, but the Python trainer uses only non-empty cells as training samples for each layer.

When both an atlas and texture manifest are loaded, training features are rendered from the current `textureRows` assignments. Texture edits therefore affect the pixel data used by the classifier. Without those loaded texture assets, the trainer falls back to the canonical source image.

Each layer trains independently:

- `tile type` trains from non-empty tile type labels.
- `walkable` trains from non-empty walkable labels.
- `parkable` trains from non-empty parkable labels.
- `drivable` trains from non-empty drivable labels.

A layer needs at least two distinct non-empty classes or boolean values. If a layer does not have enough variation, the trainer marks it as skipped and returns the current sparse values unchanged for that layer.

Training stores the latest prediction but does not change the editable map. Click `Predict labels` to apply the latest prediction to the current map. Prediction application is one undoable operation, so `Undo` restores the previous sparse labels in a single step.

## Resetting

Click `Reset to defaults` to discard the current browser state and return to the empty semantic tile configuration with the checked-in Liberty City texture rows. This does not modify any file on disk.

## Saving

Click `Save Tile Configuration` to save the current state as an Epi City tile configuration JSON file. Browsers with the File System Access API show a native Save As dialog. Other browsers download the file.

Click `Save Texture Rows` to save the current `textureRows` as an Epi City texture rows JSON file.

Click `Save Texture Manifest` to save the currently loaded texture manifest JSON file. The editor does not edit manifest frames yet, and the manifest does not contain tile-to-texture assignments. Texture painting changes belong to `textureRows` in the texture rows file, so save texture rows to update the main app.

Saving never overwrites `public/maps/liberty-city/tile-layout.json` or `texture-layout.json` automatically. Replace the app map files manually only after you review the saved output.

Runtime Epi City JSON cannot contain empty labels. Save As reports the first missing tile type or behavior values if the map is incomplete. Fill them manually or run `Predict labels` before saving.

The saved tile configuration preserves `textureSet`, `width`, `height`, and `tileSize` from a loaded map. Legend entries contain only category and behavior properties. The saved texture rows file preserves `width`, `height`, `textureSet`, and `textureRows`.

## Controls

- Left drag paints the current layer.
- One paint drag creates one undoable stroke.
- Right drag, middle drag, or hold `Space` to pan.
- Mouse wheel zooms around the cursor.
- For tile type: `1` road, `2` sidewalk, `3` park, `4` water, `5` bridge, `6` building, `e` empty.
- For texture: `i` switches back to the texture picker.
- For behavior layers: `t` true, `f` false, and `e` empty.
- `Ctrl+S` opens Save Tile Configuration.
- `Ctrl+Z` undoes.
- `Ctrl+Shift+Z` redoes.
- `Ctrl+Y` redoes.

## Server API

The browser UI talks to the local Node server through a small API:

- `GET /api/config` returns editor options, source paths, the default empty tile configuration, and the default texture rows.
- `GET /source-image` serves the source map image.
- `POST /api/train` trains from posted sparse `rows` and `behaviorRows`, plus optional atlas/manifest/`textureRows` feature data, and returns predicted grids.

The old sparse label and server-side map write endpoints return `410 Gone`. Loading and saving happen through browser file pickers and Save As dialogs.

## Saved Map Format

The editor saves semantic tile configuration JSON in this format:

```json
{
  "width": 256,
  "height": 256,
  "tileSize": 32,
  "textureSet": "liberty-city",
  "legend": {
    "A": {
      "category": "sidewalk",
      "walkable": true,
      "parkable": false,
      "drivable": false
    }
  },
  "rows": ["..."]
}
```

The editor saves texture rows JSON in this format:

```json
{
  "width": 256,
  "height": 256,
  "textureSet": "liberty-city",
  "textureRows": [[0, 1, 2]]
}
```

`rows` stores semantic legend symbols. `textureRows` stores visual texture IDs and remains separate from the edited semantic labels.
