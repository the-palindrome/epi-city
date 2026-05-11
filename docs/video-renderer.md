# Epi City Video Renderer

Epi City includes a deterministic scripting and rendering flow for producing MP4 videos from the browser simulation. The playback page uses the same `src/main.js` app that powers the normal interactive city, then records snapshots and seeks through those snapshots frame by frame. The command-line renderer drives that page with Playwright Core, captures PNG frames from the Pixi canvas, and streams them into ffmpeg.

## Quick Start

Install dependencies, then render the checked-in example script:

```bash
npm install
npm run render:video
```

The command writes `tmp/epi-city-video.mp4`. You can also call the renderer directly:

```bash
node scripts/render-epi-video.mjs \
  --script ./scripts/epi-city-video.example.json \
  --output ./tmp/epi-city-video.mp4 \
  --fps 30 \
  --width 1920 \
  --height 1080
```

For a short smoke test, render the small script:

```bash
node scripts/render-epi-video.mjs \
  --script ./scripts/epi-city-video.smoke.json \
  --output ./tmp/epi-city-smoke.mp4 \
  --fps 1 \
  --width 480 \
  --height 270
```

Open the interactive playback app at:

```text
http://localhost:5173/playback.html
```

The playback app loads the normal Epi City app inside an iframe, generates a recording, and lets you scrub or play the render timeline. This keeps the map rendering, NPC rendering, car rendering, simulation defaults, and exposed runtime functions in one source of truth.

## Architecture

The rendering flow has three parts:

1. `src/main.js` creates the normal Epi City runtime and exposes `window.citySim`.
2. `playback.html` loads the normal app as `index.html?embed=1&playback=1&render=1`, then exposes `window.epiCityVideo`.
3. `scripts/render-epi-video.mjs` opens `playback.html`, calls `epiCityVideo.runScript()`, seeks each frame, captures a PNG, and encodes the MP4 with ffmpeg.

During playback and rendering, the iframe uses `preserveDrawingBuffer` so canvas captures are stable. The normal dashboards and hover/context menus are hidden in render mode, but the simulation and Pixi renderer are unchanged.

## Browser Playback API

`playback.html` installs this browser API:

```js
window.epiCityVideo = {
  async runScript(script) {},
  async seek(renderSeconds) {},
  async captureFrame({ mimeType = 'image/png', quality } = {}) {},
  getDuration() {},
  getRecording() {}
}
```

`runScript()` normalizes the JSON script, applies simulation parameters, restarts the city, generates all simulation snapshots first, and seeks to render time `0`.

`seek(renderSeconds)` reconstructs a frame from the precomputed recording. It applies the recorded simulation snapshot, render-time API calls, scripted NPC/car position overrides, and scripted camera state.

`captureFrame()` renders the shared Pixi app and returns a PNG data URL. The Node renderer decodes this URL and sends the bytes to ffmpeg.

## Renderer CLI

Use `scripts/render-epi-video.mjs` for MP4 generation.

```bash
node scripts/render-epi-video.mjs --script ./scripts/epi-city-video.example.json [options]
```

Options:

- `--script, -s <path>`: JSON script file. Required.
- `--output, -o <path>`: output MP4 path. Defaults to `./tmp/epi-city-video.mp4`.
- `--fps <number>`: frame rate. Defaults to `30`.
- `--width <number>`: browser viewport width. Defaults to `1920`.
- `--height <number>`: browser viewport height. Defaults to `1080`.
- `--url <url>`: use an already-running playback page instead of building and serving `dist/`.
- `--frames-dir <path>`: write PNG frames to a directory before encoding.
- `--keep-frames`: keep generated PNG frames.
- `--high-quality`: encode lossless H.264 4:4:4. Files are much larger.
- `--chrome <path>`: explicit Chrome or Chromium executable.
- `--verbose, -v`: print page console diagnostics.
- `--help, -h`: print usage.

When `--url` is omitted, the renderer builds the Vite app, serves `dist/` from a local static server, and opens `playback.html`. If Chrome is not in a standard path, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `CHROME_PATH`, or pass `--chrome`.

## Script Payload

A script is a JSON object:

```json
{
  "simulation": {
    "durationHours": 12,
    "sampleInterval": 120,
    "step": 2,
    "parameters": {
      "seedEnabled": true,
      "seed": "epi-city-video",
      "npcCount": 700,
      "carCount": 120
    },
    "actions": []
  },
  "render": {
    "duration": 24
  },
  "cameraStart": {
    "x": 0,
    "y": 0,
    "zoom": 0.16
  },
  "script": [
    { "at": 0, "action": "playback", "from": 0, "to": 43200, "duration": 24 },
    { "at": 3, "action": "moveCamera", "delta": { "x": -520, "y": -240, "zoom": 0.12 }, "duration": 7 }
  ]
}
```

You can also pass a bare action array. In that form, Epi City uses default simulation and render durations.

## Simulation Block

The `simulation` block controls the precomputed recording. All durations in this block use simulation time, not video time.

- `durationSeconds` or `duration`: recording length in simulation seconds.
- `durationHours`: recording length in simulation hours.
- `sampleIntervalSeconds` or `sampleInterval`: seconds between stored snapshots. Defaults to `60`.
- `stepSeconds` or `step`: simulation seconds per generation step. Defaults to `min(sampleInterval, 2)`.
- `parameters`: startup parameters applied through `window.citySim`.
- `actions`: simulation-time actions applied while the recording is generated.

The renderer generates the simulation first. A 12-hour simulation with `sampleInterval: 120` records one snapshot every two simulated minutes, then the video timeline can scrub those snapshots at any presentation speed.

Supported `parameters` keys map to existing city controls:

- `seedEnabled`, `seed`, `speed`
- `npcCount`, `carCount`
- `initialInfectiousCount`, `inoculatedPercent`
- `infectionDistance`, `infectionProbability`, `incubationDays`, `infectionDays`, `immunityDays`
- `dayNightOverlayEnabled`
- `mapTextureEnabled`, `mapTextureOpacity`
- `entityRenderMode`
- `infectionRadiusVisible`, `infectionEdgesVisible`, `contactEdgesVisible`
- `pathTrailsVisible`, `pathTrailLength`
- `heatmapRadius`

## Simulation Actions

Simulation actions run while snapshots are generated. Their `at` values use simulation seconds.

### `call`

Calls a method on `window.citySim`.

```json
{ "at": 14400, "action": "call", "method": "setInfectionProbability", "args": [0.05] }
```

Nested method paths work:

```json
{ "at": 7200, "action": "call", "method": "dashboard.setOverlay", "args": ["heatmapInfectious", true] }
```

Avoid calling restart-style methods during generation unless you deliberately want to reset the recording state.

### `setNpcPosition`

Places an NPC at a world position during generation.

```json
{ "at": 3600, "action": "teleportNpc", "id": 42, "position": { "x": 4000, "y": 3900 } }
```

Aliases: `teleportNpc`, `moveNpc`.

### `setCarPosition`

Places a car at a world position during generation.

```json
{ "at": 3600, "action": "teleportCar", "id": 3, "position": { "x": 3900, "y": 4100 } }
```

Aliases: `teleportCar`, `moveCar`.

## Render Timeline

The top-level `script` array uses video time. Every action has:

- `at`: start time in render seconds. Negative values clamp to `0`.
- `action`: action name or alias.
- `duration`: optional render duration for continuous actions.
- `easing`: optional easing for continuous actions. Supported values are `linear`, `smooth`, `ease-in`, `ease-out`, and `ease-in-out`.

### `playback`

Maps render time to simulation time.

```json
{ "at": 0, "action": "playback", "from": 0, "to": 43200, "duration": 24 }
```

This example plays 12 simulated hours over 24 video seconds. Without a `playback` action, the whole recording maps linearly across the render duration.

Alias: `playSimulation`.

### `setCamera`

Sets the 2D camera immediately.

```json
{ "at": 0, "action": "setCamera", "x": -120, "y": -80, "zoom": 0.18 }
```

Alias: `cameraSet`.

### `moveCamera`

Animates the camera. You can provide `to`, top-level camera fields, or a `delta`.

```json
{
  "at": 4,
  "action": "moveCamera",
  "to": { "x": -520, "y": -240, "zoom": 0.28 },
  "duration": 6,
  "easing": "ease-in-out"
}
```

```json
{
  "at": 10,
  "action": "panCamera",
  "delta": { "x": 320, "y": 200, "zoom": -0.06 },
  "duration": 5
}
```

Aliases: `cameraMove`, `panCamera`.

### `followEntity`

Centers the camera on an NPC or car in the current playback snapshot.

```json
{ "at": 18, "action": "followNpc", "id": 12, "zoom": 1.2, "duration": 3 }
```

Aliases: `followNpc`, `followCar`.

### `call`

Calls a runtime method during rendering. The renderer reapplies call actions on seek, so use idempotent display changes.

```json
{ "at": 11, "action": "call", "method": "setEntityRenderMode", "args": ["geometric"] }
```

Aliases: `apiCall`, `callApi`.

### `moveNpc` and `moveCar`

Applies a render-time visual override to one entity. This does not alter the precomputed simulation recording.

```json
{
  "at": 6,
  "action": "moveNpc",
  "id": 25,
  "from": { "x": 3860, "y": 4140 },
  "to": { "x": 4020, "y": 4140 },
  "duration": 2,
  "easing": "smooth"
}
```

Use `setNpcPosition` or `setCarPosition` for instant render-time placement.

## Validation Rules

The parser validates these conditions:

- The payload must be a JSON object, JSON string, or action array.
- Action names must be non-empty strings.
- Durations, intervals, and step sizes must be positive when present.
- `durationSeconds`/`duration` and `durationHours` cannot be specified together.
- Actions are sorted by `at`, then by optional `index`.
- Unknown action names are preserved, but only supported actions affect playback.

The renderer reports runtime errors for missing script files, missing ffmpeg, missing Chrome/Chromium, page startup failures, invalid frame captures, and ffmpeg encode failures.

## Notes And Limits

The MP4 contains the Pixi city canvas, not the playback toolbar. The normal app dashboards also hide in render mode. Use script actions and map/entity rendering options to put visual state in the video.

Long simulation windows can take time to generate. Increase `sampleInterval` to reduce memory use, and increase `step` carefully if you need faster generation. Smaller steps preserve closer parity with the live app.

`call` intentionally exposes the existing runtime API, so it can invoke most functions available on `window.citySim`. The method resolver blocks prototype paths and `destroy`, but scripts should still treat calls as local trusted automation.
