# Epi City Simulation Explorer

The simulation explorer is a local tool for inspecting JSON exports from headless simulation runs. It includes a D3 contact graph and a D3 SEIR curve view. Large result files are parsed and indexed in a Web Worker so the UI stays responsive while the data loads.

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

- Drag the canvas to pan and scroll to zoom.
- Drag an NPC node to pin it in the force layout.
- Set `Start` and `End` to include only contact events whose time interval overlaps that simulation-time window.
- Use `Layout` to switch between force, spherical, hierarchical, and infection-map graph arrangements. The hierarchical layout is computed only from infection event edges, using each infected NPC's first recorded infector as its parent. Switching to it turns contact edges off so the infection forest remains readable. The infection-map layout places infected NPCs around the tile where they were infected and jitters shared-tile infections apart.
- Use `Display edges` to toggle contact and infection edge layers independently.
- Hover an NPC node to see its id, initial SEIR state, and contact count inside the current window.

The graph always keeps all NPCs visible. Time filtering only changes visible edges and contact counts. The contact counter reports matching contact events, while rendered contact edges are grouped by NPC pair for readability. The force layout is computed from the full contact history, so changing the time window does not collapse the graph.

For dense runs, contact and infection edges are drawn on a canvas layer instead of as individual SVG elements. The contact counter remains exact, while the visible contact edge layer is capped to the strongest ranked NPC-pair edges in the current time window so huge 10-day exports remain interactive.

## SEIR Curve Controls

- Drag the plot to pan and scroll to zoom.
- Use `Display curves` to toggle S(t), E(t), I(t), and R(t) independently.
- Curves are derived from each NPC's initial SEIR state plus `infection`, `incubation`, `recovery`, and `immunity_waned` events.
