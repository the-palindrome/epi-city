# Epi City Map Editor

The map editor is a local maintenance tool for correcting semantic tile types, behavior attributes, building metadata, and texture-row assignments while keeping atlas pixels and manifest frames unchanged. It keeps one editable 256x256 map state in the browser, trains from sparse labels, and loads or saves complete map package folders.

## Run

From the repository root:

```bash
npm run map-editor:deps
npm run map-editor
```

Open the local URL printed by the command. It starts at `http://localhost:5174` and tries the next port if that one is already in use.

The dependency command creates or repairs `map-editor/.venv` and installs the Python training packages there. The server automatically uses that local Python environment when it exists.

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

Click `Load Map Folder` to choose an Epi City map package folder such as `public/maps/liberty-city`. Folder loading requires a browser with the File System Access API, such as Chrome or Edge on `localhost`.

The folder must contain:

- `tile-layout.json`
- `texture-layout.json`
- `manifest.json`
- the atlas file named by `manifest.json`'s `atlas.file`

The browser reads those files together, replaces the editable tile state, loads the texture rows, and reconstructs the visual map from the manifest frames and atlas.

The editor does not automatically overwrite `public/maps/liberty-city/tile-layout.json` or `texture-layout.json`. It starts from an empty semantic layout and the current Liberty City visual assets by default, but loading a folder makes that folder the active save target.

Texture rows loading requires a valid 256x256 `textureRows` grid. The editor reports the number of unique texture IDs it loaded and previews those IDs whenever an atlas and texture manifest are present.

## Editing State

The editor always displays the current editable map state. There is no separate manual-label overlay or hidden generated-label layer. Painting with the brush directly changes the current map state.

Use the `Paint layer` selector to choose what the brush updates:

- `tile type` sets the tile to empty, `road`, `sidewalk`, `crosswalk`, `park`, `water`, `building`, or `obstacle`.
- `building` sets the clicked connected building component to one or more of `residential`, `commercial`, `school`, `restaurant`, `supermarket`, `mall`, or `nightclub`.
- `texture` picks and paints manifest frame IDs in `textureRows`.
- `walkable` sets the current tile's walkable value to empty, `true`, or `false`.
- `parkable` sets the current tile's parkable value to empty, `true`, or `false`.
- `drivable` sets the current tile's drivable value to empty, `true`, or `false`.

Painting a tile type does not auto-fill behavior attributes. This keeps labels sparse and lets the trainer learn each layer independently. The building layer edits top-level building metadata, so one click updates the connected building component instead of changing the base tile category.

In the texture layer, the `pick texture` tool samples the texture ID from the clicked tile. The editor then switches to painting that texture ID onto other tiles. Texture edits update `textureRows`, so `Save Map Folder` writes the changed manifest-frame references without changing atlas pixels or manifest frame geometry.

When only texture assignments changed, `Save Map Folder` preserves the loaded semantic rows while updating `texture-layout.json`.

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

Click `Save Map Folder` to write the current editable state into the active map package folder. If no folder has been loaded yet, the editor asks you to choose one.

Saving writes:

- `tile-layout.json` for semantic rows, behavior flags, and building metadata
- `texture-layout.json` for texture row assignments

Incomplete tile type and behavior labels are saved as `null`. Saving does not rewrite `manifest.json`, atlas pixels, or manifest frame geometry. The main app still expects complete runtime tile configuration files, so fill or predict empty labels before saving over a runtime map package.

The saved `tile-layout.json` preserves `textureSet`, `width`, `height`, `tileSize`, and top-level `buildings` metadata from a loaded map. Legend entries contain only category and behavior properties. The saved `texture-layout.json` preserves `width`, `height`, `textureSet`, and `textureRows`.

## Controls

- Left drag paints the current layer.
- One paint drag creates one undoable stroke.
- Right drag, middle drag, or hold `Space` to pan.
- Mouse wheel zooms around the cursor.
- For tile type: `1` road, `2` sidewalk, `3` park, `4` water, `5` building, `6` obstacle, `7` crosswalk, `e` empty.
- For building type: `r` residential, `c` commercial, `s` school, `t` restaurant, `u` supermarket, `m` mall, `n` nightclub.
- For texture: `p` switches back to the texture picker.
- For behavior layers: `t` true, `f` false, and `e` empty.
- `Ctrl+S` saves the current map folder.
- `Ctrl+Z` undoes.
- `Ctrl+Shift+Z` redoes.
- `Ctrl+Y` redoes.

## Server API

The browser UI talks to the local Node server through a small API:

- `GET /api/config` returns editor options, source paths, the default empty tile configuration, and the default texture rows.
- `GET /source-image` serves the source map image.
- `GET /default-texture-manifest` serves the default Liberty City texture manifest.
- `GET /default-texture-atlas` serves the default Liberty City atlas image.
- `POST /api/train` trains from posted sparse `rows` and `behaviorRows`, plus optional atlas/manifest/`textureRows` feature data, and returns predicted grids.

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
  "buildings": {
    "encoding": "row-spans-v1",
    "defaultTypes": ["residential"],
    "items": [
      {
        "id": "building-0001",
        "types": ["residential", "restaurant"],
        "entrance": { "x": 1, "y": 0 },
        "spans": [[0, 0, 3]]
      }
    ]
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

## Lane Graph Editing

The map editor includes a `lane graph` paint layer. Use `draw segment` to click a road or crosswalk tile, then click road or crosswalk tiles in travel order to add directed lane graph edges. Clicking farther along the same row or column fills every intermediate tile until the endpoint. Each tile owns one centered lane node; clicking an existing node closes the active segment. Use `new segment` to start another sequence, `delete tile` to remove the node on one tile, and `clear graph` to remove the authored graph.

The editor also renders auto-generated traffic signal markers on lane graph intersections. Use `toggle signal` to save an override that enables or disables a generated signal, and `offset signal` to shift that signal's phase timing. Saving writes top-level `laneGraph` metadata when the graph has nodes, edges, or traffic signal overrides. The editor accepts only this manual centered format; legacy generated metadata, lane offsets, layered lane fields, and connector edges must be removed from old maps.
