# Epi City Simulation Explorer

The simulation explorer is a local tool for inspecting JSON exports from headless simulation runs. It includes a Three.js dynamic contact graph and a Three.js SEIR curve view.

## Run

From the repository root:

```bash
npm run simulation-explorer
```

Open the local URL printed by the command. It starts at `http://localhost:5175` and tries the next port if that one is already in use.

Use `Load JSON` in the browser to select a headless simulation result export. The explorer does not load a default result file.

## Views

Use the bottom tab selector to switch between `Contact graph` and `SEIR curve`.

## Contact Graph Controls

- Drag to orbit the 3D graph.
- Scroll to zoom.
- Drag with the right mouse button to pan.
- Set `Start` and `End` to include only contact events whose time interval overlaps that simulation-time window.
- Use `Layout` to switch between a stable spherical layout, a force layout driven by the full contact history, and a hierarchical layout ordered by the infection transmission tree.
- Use `Display edges` to toggle contact and infection edge layers independently.
- Hover an NPC node to see its id, initial SEIR state, and contact count inside the current window.

The graph always keeps all NPCs visible. Time filtering only changes visible edges and contact counts. The contact counter reports matching contact events, while rendered contact edges are grouped by NPC pair for readability.

## SEIR Curve Controls

- Drag, scroll, and pan with the same Three.js camera controls.
- Use `Display curves` to toggle S(t), E(t), I(t), and R(t) independently.
- Curves are derived from each NPC's initial SEIR state plus `infection`, `incubation`, `recovery`, and `immunity_waned` events.
