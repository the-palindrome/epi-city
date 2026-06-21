# Headless Simulation Runner

This folder contains the command-line simulation tools:

- `generate-headless-world.mjs`: creates a reusable world JSON with NPCs, cars, schedules, positions, and relationships.
- `run-headless-simulation.mjs`: runs the full SEIR simulation without a browser renderer and exports NPC IDs plus timeline events.
- `run-simulation.mjs`: records browser-playback snapshots for the video renderer. It is separate from the headless event exporter.
- `headless-world-config.example.json`: example config for world generation.
- `headless-run-config.example.json`: example config for a headless simulation run.

The headless tools use the same Liberty City map, NPC generator, car generator, SEIR dynamics, and policy logic as the app. There is one map source of truth, so no map path is needed in these configs.

## Quick Start

Generate a world:

```bash
npm run generate-headless-world
```

This writes a generated, git-ignored world file:

```text
scripts/simulation/epi-city-world.json
```

Run the simulation against that world:

```bash
npm run run-headless-simulation
```

This writes:

```text
tmp/epi-city-results.json
```

To run a short smoke simulation:

```bash
npm run run-headless-simulation -- --duration-seconds 60 --step 1
```

## Direct CLI Use

World generation:

```bash
node scripts/simulation/generate-headless-world.mjs \
  --config ./scripts/simulation/headless-world-config.example.json \
  --output ./scripts/simulation/epi-city-world.json
```

Headless run:

```bash
node scripts/simulation/run-headless-simulation.mjs \
  --config ./scripts/simulation/headless-run-config.example.json \
  --world ./scripts/simulation/epi-city-world.json \
  --output ./tmp/epi-city-results.json
```

Runner options:

- `--config, -c <path>`: headless run config JSON. Required.
- `--world, -w <path>`: generated world JSON. Required.
- `--output, -o <path>`: result JSON path. Defaults to `tmp/epi-city-results.json`.
- `--duration-days <number>`: override run duration.
- `--duration-hours <number>`: override run duration.
- `--duration-seconds <number>`: override run duration.
- `--step <number>`: override simulation step seconds.

Use only one duration override at a time.

## World Config

`headless-world-config.example.json` controls deterministic world generation:

```json
{
  "format": "epi-city-headless-world-config",
  "version": 1,
  "seed": {
    "enabled": true,
    "value": "epi-city"
  },
  "population": {
    "npcCount": 500,
    "carCount": 100
  }
}
```

Fields:

- `seed.enabled`: when `true`, use deterministic seeded generation. When `false`, use system randomness.
- `seed.value`: seed string.
- `population.npcCount`: NPC count, clamped to `100..10000`.
- `population.carCount`: car count, clamped to `0..2000`.

## Generated World File

The world generator writes:

```json
{
  "format": "epi-city-headless-world",
  "version": 1,
  "generatedAt": "2026-06-21T00:00:00.000Z",
  "npcs": [],
  "cars": []
}
```

`npcs` contains stable IDs and generated NPC details such as age, home, school, work, friend IDs, timetable, position, tile, slot, and location state. `cars` contains stable car IDs, owner NPC IDs, parking state, and position.

The generated world does not contain `config` or `initialSeir`. The runner derives population from `npcs.length` and `cars.length`.

## Run Config

`headless-run-config.example.json` controls simulation execution:

```json
{
  "format": "epi-city-headless-run-config",
  "version": 1,
  "seed": {
    "enabled": true,
    "value": "epi-city"
  },
  "initialSeir": {
    "initialInfectiousCount": 4,
    "inoculatedPercent": 0,
    "infectedNpcIds": [],
    "inoculatedNpcIds": []
  },
  "run": {
    "durationSeconds": 86400,
    "stepSeconds": 2
  },
  "infection": {
    "distanceMeters": 2,
    "transmissionProbabilityPerMinute": 0.03,
    "incubationDays": 1,
    "infectiousDays": 7,
    "immunityDays": 90
  },
  "policies": []
}
```

The world file is mandatory. The run config no longer has a `world` block.

Initial SEIR fields:

- `initialSeir.infectedNpcIds`: exact NPC IDs that start infectious.
- `initialSeir.inoculatedNpcIds`: exact NPC IDs that start recovered/inoculated.
- `initialSeir.initialInfectiousCount`: seeded random infectious count, used only when `infectedNpcIds` is empty.
- `initialSeir.inoculatedPercent`: seeded random recovered/inoculated percent, used only when `inoculatedNpcIds` is empty.

Explicit IDs must exist in the supplied world. An NPC cannot be both infected and inoculated. Random selections exclude already selected NPCs.

Run fields:

- `run.durationSeconds`: simulation duration in seconds.
- `run.durationHours`: alternate config duration field.
- `run.stepSeconds`: simulation update step size.

Infection fields:

- `infection.distanceMeters`: contact/infection distance, clamped to `0..25`.
- `infection.transmissionProbabilityPerMinute`: base transmission probability per minute, clamped to `0..1`.
- `infection.incubationDays`: exposed-to-infectious delay, clamped to `0..14`.
- `infection.infectiousDays`: infectious-to-recovered delay, clamped to `0..21`.
- `infection.immunityDays`: recovered-to-susceptible delay, clamped to `0..365`.

## Result Format

The runner writes:

```json
{
  "format": "epi-city-headless-results",
  "version": 1,
  "createdAt": "2026-06-21T00:00:00.000Z",
  "config": {},
  "world": {
    "source": "file",
    "path": "./scripts/simulation/epi-city-world.json"
  },
  "summary": {
    "durationSeconds": 86400,
    "stepSeconds": 2,
    "npcCount": 1000,
    "carCount": 200,
    "eventCount": 0,
    "finalSeir": {
      "susceptible": 0,
      "exposed": 0,
      "infectious": 0,
      "recovered": 0
    }
  },
  "npcs": [
    {
      "id": "npc_0",
      "index": 0,
      "initialSeirState": "susceptible"
    }
  ],
  "events": []
}
```

`at`, `until`, and `durationSeconds` are simulation seconds since the run start. `where.tile` is the tile coordinate and linear tile index from the default Liberty City map.

## Event Types

Contact interval:

```json
{
  "event": "contact",
  "id": "contact_1",
  "npcs": ["npc_12", "npc_31"],
  "at": 120,
  "until": 126,
  "durationSeconds": 6,
  "where": {
    "tile": { "x": 10, "y": 20, "index": 5130 }
  },
  "minDistanceMeters": 1.4212,
  "observationCount": 4
}
```

Infection:

```json
{
  "event": "infection",
  "id": "infection_1",
  "from": "npc_12",
  "to": "npc_31",
  "at": 124,
  "where": {
    "tile": { "x": 10, "y": 20, "index": 5130 }
  },
  "distanceMeters": 1.4212
}
```

Incubation, recovery, and immunity waning:

```json
{
  "event": "incubation",
  "id": "incubation_1",
  "npc": "npc_31",
  "at": 86524,
  "where": {
    "tile": { "x": 11, "y": 20, "index": 5131 }
  }
}
```

The same shape is used for:

- `incubation`: exposed to infectious.
- `recovery`: infectious to recovered.
- `immunity_waned`: recovered to susceptible.

Policy effect change:

```json
{
  "event": "policy_effect_change",
  "id": "policy_1",
  "at": 3600,
  "activePolicyIds": ["mask-policy"],
  "effects": {
    "infectionProbabilityMultiplier": 0.4,
    "socialDistancingEnabled": false,
    "eventCancellationProbabilities": {
      "closeSchools": 0,
      "homeOffice": 0,
      "reduceShopping": 0,
      "reduceNightlife": 0
    }
  }
}
```

The exporter does not write vehicle trips, policy destination cancellation events, or summary samples.

## Reproducibility Notes

For repeatable runs, generate a world once and keep passing it with `--world`. The world fixes NPC IDs, car IDs, generated schedules, relationships, and initial positions. The run config controls duration, infection parameters, policies, random seed for simulation-time stochastic choices, and initial SEIR assignment.

After this schema change, regenerate any existing `scripts/simulation/epi-city-world.json` file.
