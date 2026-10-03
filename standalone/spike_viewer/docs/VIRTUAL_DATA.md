# Virtual data contract v1

The public contract is `spike-viewer/virtual-layer/v1`, defined in
`src/overlays/types.ts` and admitted by `validateVirtualLayers` or
`parseVirtualLayers`. Arbitrary quantity names and units allow simulation,
measurement, annotation, planning, and synthetic inputs to share rendering.
The viewer does not execute or qualify a solver.

## Minimal layer

```json
{
  "schema": "spike-viewer/virtual-layer/v1",
  "id": "voltage",
  "label": "Measured voltage",
  "binding": { "boardId": "viewer-lab-board", "revision": "1" },
  "quantity": "Voltage",
  "unit": "V",
  "provenance": { "source": "bench run", "status": "measured" },
  "visible": true,
  "opacity": 0.85,
  "range": [0, 5],
  "frames": [{
    "id": "sample-0",
    "label": "Initial sample",
    "timeSeconds": 0,
    "primitives": [{
      "id": "sensors",
      "kind": "points",
      "positionsMm": [[25, 30, 0.8], [45, 40, 0.8]],
      "values": [3.3, null],
      "radiusMm": 0.7
    }]
  }]
}
```

An import may contain one layer or an array. IDs must be unique per container.
The demo replaces layers by ID only after the entire merged set is admitted.
Rejected imports leave current data intact. The library wrapper leaves board
geometry visible, omits rejected virtual data, and shows the admission error.

## Coordinates, binding and status

`positionsMm` uses the board source coordinates: X to the right, Y down in
source/2D, Z toward the front of the board from its mid-plane. Neither changing
view nor animating a frame modifies source coordinates. Three.js converts Y's
direction and centers/scales the scene; callbacks return original millimetres.
2D projection does not turn out-of-plane samples into physical board samples.

Both `binding.boardId` and `binding.revision` must exactly match the loaded
board. Prefer a content digest as the revision. A matching string is a host
association check, not cryptographic provenance verification. Do not rebind
results merely to bypass a stale-data error.

`provenance.status` is `synthetic`, `measured`, `simulated`, `approximate`,
`unvalidated`, or `validated`. It is source-supplied metadata, never promoted by
the renderer. Keep source qualification evidence in the producing application.
Optional notes travel with picks and JSON exports.

## Primitives

| Kind | Additional fields | Behavior |
| --- | --- | --- |
| `points` | optional `values`, `radiusMm` | Point samples; scalar colors when values supplied |
| `vectors` | `vectors`, `displayScaleMm`, optional `values` | Full 3D arrows; explicit mm per vector unit |
| `surface` | `triangles`, optional `values` | Supplied connectivity, one scalar per vertex |
| `path` | optional `closed`, `widthMm` | Routes, contour lines, boundaries and planned geometry |
| `labels` | `labels` | Literal text at supplied positions; never interpreted as HTML |

Each primitive has an ID and optional `#RRGGBB` color. Values are finite numbers
or explicit `null` for missing samples. Null samples and faces touching null
vertices are omitted. Scalar values override a primitive's default color.
Vectors use their given components; the renderer does not infer fields.
Surface picking returns a supplied vertex, not an interpolated solver value.

A layer has one or more frames, each with an ID, label, primitives, and optional
`timeSeconds` / `frequencyHz`. One-frame layers remain visible at every frame
index. Multiframe layers with no entry at the selected index are hidden.
The UI selects retained frames; temporal interpolation is not performed.
The optional `range` fixes the scalar color scale. Otherwise a finite range is
derived across all frames, so animation does not silently rescale colors.

## Resource and input limits

Across the complete admitted set, including hidden layers and all frames:

- 32 layers, 256 frames and 2,048 primitives;
- 50,000 positions, 100,000 triangles and 1,000 labels;
- 16 MiB JSON text, 1,000 characters per text field;
- finite bounded coordinates, values, vector scales and opacity;
- distinct in-range triangle indices and matching vector/value/label lengths.

No retained samples are silently decimated by this API. Applications needing
larger workloads should explicitly tile/page their presentation data, retain
full data in the producing system, and label any display reduction.

Both renderers use the same frame, range, missing-value and pick helpers.
`VirtualPick` includes layer/frame/primitive/sample identity, position, original
value/vector/label, quantity, unit, and provenance. GPU resources belong to the
viewport and are released when an overlay is replaced or the viewer unmounts.
