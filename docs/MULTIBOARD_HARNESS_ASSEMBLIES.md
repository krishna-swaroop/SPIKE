# Multi-board, harness and external CAD assemblies

Viewport notices use at most two compact chips in the upper right corner, with
bounded width and single-line text. Click a chip or the application notification
bell for full board/model and connection diagnostics. Selection details stay in
the inspector. Import progress and unresolved import warnings stay in the status
bar until **Import details** or **Import needs review** is clicked; imports do not
automatically reopen a large panel over the boards. Error diagnostics retain
retry and model-location actions.

In **Notifications**, click the model warning title or **Resolve models** to
open the model resolver at the active board and first missing component.
**Resolve this board's models** opens the resolver for that retained design.
Model repair actions become available when the board inventory is ready.
**Review import** reopens the staged import details, **Review connector links**
opens the link manager, and **Review all issues** opens the Issues dock. Each
action closes the notification popover. Failed model scenes also offer
**Retry 3D models**; timing and loader metrics stay under **Load diagnostics**.

In **2D**, the assembly view packs boards separately while preserving their
physical transforms. Use the wheel to zoom at the pointer, drag to pan, or
double-click the canvas to fit all boards. **Focus** frames a selected board or clicked object.
The normal **All / Part / Net** filters apply to each occurrence: **Net** lets
you pick tracks, pads, vias and zones without component hitboxes blocking them.
Only saved connector pin mappings propagate net highlights to other boards.

Open **Home → Multi-board** in the desktop shell. It opens a separate native
window with an OS title bar: drag it outside SPIKE, move it to another monitor,
resize or minimize it. **Placement**, **Layers**, **Nets** and **Links** in the
compact viewport row open native tool windows too. The viewport reserves one
38 px row; expanded placement forms no longer take canvas space. Model warnings
remain in the main notification center and per-design workspace diagnostics.
The workspace opens this editor directly at Boards, Links or Analysis; changing
sections keeps the current assembly draft mounted. Clicking **Multi-board**,
**Placement**, or a manager command again restores and focuses its existing
window. Selecting **2D layout** or **3D placement** updates the main viewport
while the setup window and its draft stay open. Native close requests check for
unsaved setup or connector drafts.

**MCAD assembly → Board instances and harnesses → Open multi-board workspace**
opens the same setup window. Setup forms are owned by that window. The MCAD
panel keeps its own mechanical part controls.

## ECAD–MCAD collaboration workspace

The workspace groups work into **Boards & organization**, **Placement & mechanics**,
**Connector links & harnesses**, and **Coupled studies**. Changing stages preserves
the editor draft. Search the board inventory by name, select an occurrence, then
use its **2D**, **3D**, **Layers**, **Nets**, or **Links** commands. Duplicate board
names receive occurrence ordinals; internal identity remains in the saved data.
Inventory cards show component, net and layer counts plus available graphics
and import diagnostics for each retained design.

Project commands provide **Save project** and **Reload package**. Mechanical
commands open **FreeCAD collaboration** or **MCAD attachments** using their existing
project-bound interfaces. Save structural board/link drafts before switching
editors or reloading. Collaboration commands require a saved, clean desktop
project; their presence does not qualify an analysis solver.

All controls use the shared [button and control standard](BUTTON_CONTROLS.md).

### Add, duplicate and remove local boards

Import a new source with **Import boards / external assemblies**. To reuse an
already retained source, choose **Local source** and **Add local board**. Each
row also provides **Duplicate** and **Remove**; another import is unnecessary
for repeated instances of one board.

Duplicate assigns a new board identity, frame and readable name, and starts it
beside the existing boards. It keeps the source design and resolved model
geometry shared, while placement and occurrence-scoped nets remain independent.
Connector links are not copied: define the new occurrence's explicit pin map.
Up to 30 board instances are supported, subject to existing resource budgets.

Remove deletes the occurrence and its dependent connector, harness and rigid-flex
link records from the draft. It retains the local source for later reuse.
**Reset draft** restores all board and link edits to the saved structure;
**Save boards and links** commits them to the `.spike` package. Save before
mechanical export or collaboration so those files use the same inventory.

The workspace organizes existing assembly capabilities; full-wave assembly EM
remains unsupported. Refer to [solver status](SOLVER_STATUS.md) for qualification.

The browser preview also opens assembly tools in separate popup windows. Allow
local SPIKE popups if the browser blocks opening one, then use **Retry**.
Unsaved drafts use the browser's close confirmation; cancelling it keeps the
parent session connected. Browser editing does not enable native board import
or analysis workers.

The board net list displays net names. Connector pin choices show the pin number
and net name; internal net IDs stay in the saved data and selection messages.
Nets without a source name display **Unnamed net**, and unresolved pin mappings
display **unresolved net**. Equal names on different boards remain distinct.

**Connector links** displays two board/connector cards joined by a pin connection.
Use **Add connection**, choose both connectors and pins, then **Apply connection**.
Existing endpoints stay fixed; edit their pin choices and **Save changes**, or
**Discard edit**. Applied, pending and incomplete connections have text and icon
status cues. Search matches board, connector, pin and net names. On narrow windows,
the two endpoints stack vertically. No internal board/net occurrence IDs appear
in connection labels. Large catalogs display 100 connections per page.

Assembly **Layers** uses the main layer manager's grouped inventory, color swatches,
search, eye toggles, group toggles, **All on**, **All off**, **Reset**, layer isolation
and percentage opacity. Physical dielectric rows show their material/stack data
without drawable controls. These actions apply only to the board chosen above
the manager; bulk actions are one native update and preserve other boards.

Assembly **Nets** uses the original imported net catalog with name search,
selection, active-row highlighting, object/layer counts, compact rows and table
keyboard navigation. Counts use the selected retained design's canonical
identities; missing inventories show a dash rather than a fabricated zero.
The single-board PI manager retains its role and loop setup; assembly circuits
and connector properties are configured in **Coupled studies**. Scene-wide
display controls remain in the main viewport controls.

For engineering placement, select a board and choose **Move** or **Rotate** in
the compact row. The translation arrows and rotation rings use board-local axes.
Click an axis handle to open its small numeric field, or start dragging and type
while the gesture is active. A signed number such as `12` is a delta of 12 mm
for translation or 12 degrees for rotation, relative to the gesture start.
Input previews the placement; **Enter** applies it and **Escape** restores the
starting placement. Plain dragging commits on release. The numeric field stays
inside the viewport beside the gizmo. Placement tool fields retain absolute
assembly X/Y/Z and Euler angles. Starting a physical gizmo clears display
explosion; exploded diagrams remain presentation-only.

Native title-bar close requests preserve unsaved board/link drafts through a
Keep editing / Discard draft choice. The main workspace owns placement, layer
visibility, linked selection and project state; tool windows exchange token-bound
snapshots and actions. A stale tool cannot overwrite a newer assembly. Finish a
tool's structural draft before changing placement from another window.
Check the version in the status bar: the dedicated workspace is in v0.3.0.
An older installed executable or file association can still open v0.2.13.
For a checkout preview, build the frontend with `npm.cmd run build` in `app`,
then `cargo build --features custom-protocol` in `app/src-tauri`. Run
`app/src-tauri/target/debug/spike-desktop.exe`, then **Home → Open** your project.
This embeds the frontend but uses the checkout's Python worker and installed
dependencies; it is a development preview, not a redistributable installer.
After a second board instance is added, the **Link Manager** appears in that
panel. It owns cable harness rows, stacked board connector mates, connector
mappings, rigid/flex links, and their pin maps. Choose **Save boards and links**
to commit the draft to the `.spike` package; normal **Save project** then retains
the assembly graph with the analysis and workspace state.
Save the active board as a `.spike` project first. **Import boards / external
assemblies** accepts one or more KiCad `.kicad_pcb`, IPC-2581 `.ipc2581`, or
`.spikeassembly` files in one selection. Save pending structure edits before
importing. Existing boards, enclosure parts and the active electrical design
are retained. The complete selection is validated and committed as one package
replacement; an invalid later source leaves the original package intact.
Native boards receive separated starter placements; explicit placements in a
`.spikeassembly` are retained.
To reuse an already retained board source, choose **Duplicate** on its occurrence
row (or **Add active design instance**). The new occurrence starts to the right
of the retained board outline with 30 mm edge clearance and skips occupied board
envelopes; rotated boards use their projected outline bounds. Its placement is a draft until
**Save boards and links** succeeds. Import remains disabled while a draft is
dirty so an import cannot silently replace unsaved placement or link edits.

The **Connector graph** discovers J, P and CN connector references from each
retained board, displays board nodes and connector ports, and draws existing
direct mates and virtual harnesses. Select two ports or use the endpoint lists,
review suggested physical pin pairs, then add a direct mate or preview a cable.
Automatic suggestions require a net to occur on exactly two free pins across
different boards. Shared grounds and multi-drop nets need explicit review.
Missing connectors can be added with board-local XYZ exit points and pin tables.
For a virtual cable, review slack, allowance, AWG, clearance, waypoints and
keepouts, then **Preview virtual harness route**. Add the proposal to the draft
and save links to see the approximate route in the 3D assembly viewport. The
detailed tables remain under **Review and edit all link records**.

Each board occurrence has its own ID and XYZ/rotation placement. Multiple
occurrences can reference one retained electrical design. The existing limits
are 30 boards, 32 copper layers per board, and 100 mechanical parts/groups.
The viewport prepares a digest-bound visual bundle for every retained design
and reuses that source geometry for each occurrence. Board copper and available
component models render for active and retained designs; a per-design diagnostic
reports missing or malformed source identity, failed visual stages and unresolved
component models. Placeholder geometry remains where source models are absent.
KiCad plots use a local page origin; the assembly view centers that page on the
source board envelope before applying occurrence transforms. Packing includes
the complete plot page, and duplicate source outline edges are joined once
without removing original drawing records.
An `UNDEFINED` layer on recognized non-electrical KiCad graphics can be moved to
an existing `Dwgs.User` layer in a temporary visual export copy. The diagnostic
reports the count and source preservation; unknown/electrical layers still fail
with the native exporter reason. This does not repair manufacturing geometry.
This rendering support does not implement a coupled multi-board field solver.

For stacked boards, add a **Stacked board connector mate** with two explicit
`board::connector` endpoints and a one-to-one pin map. This is a direct mating
edge, distinct from a cable harness. SPIKE checks that both board instances
exist, that they differ, and that no pin is assigned to both a mate and a
harness. A board's XYZ placement does not create an electrical connection;
the mate record does not infer contact resistance, return continuity, or
connector SI behavior. Enter those models explicitly in the applicable solver
workflow. A mate can be saved and included in a PI, SI, thermal, or EMI plan
without claiming a coupled solve.

For PI, thermal, or EMI analysis in the desktop, select the intended board
instance in the assembly viewport before running a selected-board workflow.
The selected instance must reference the active electrical design accepted by
that workflow. This disambiguates repeated occurrences of the same design.
A rendered occurrence for a different retained design cannot be solved through
the active design workflow. Analysis scope
and results identify the selected board and list omitted boards and assembly
entities; selection alone never activates electrical or thermal coupling.
SI multi-board jobs bind board identities through their own explicit request.

The `plan_multiboard_analysis` worker accepts PI, SI, thermal, and EMI domains.
`independent_board_batch` retains selected occurrence identities and requires
caller-controlled single-board dispatch. PI/SI use `coupled_harness_network`
and thermal/EMI use `coupled_assembly` to request a coupled plan. Both coupled
modes return a blocked graph-only plan until a qualified adapter consumes the
corresponding assembly physics. The separate **Coupled multi-board analysis**
panel executes explicit reduced circuit, RC thermal, and magnetic-loop models;
see [coupled workflow](MULTIBOARD_COUPLED_ANALYSIS.md). These interacting models
remain experimental/approximate. Plans retain direct connector mates separately from harnesses.
Thermal plans retain contacts and parts; EMI plans retain
electrical bonds and parts. Their presence in a plan is not a solved effect.

## Harness authoring

1. Choose **Discover connectors**. J, P and CN reference prefixes are candidates;
   discovery resolves canonical pin IDs to physical pin numbers and net names.
   Connector positions default to the component origin on board-local Z=0.
2. Review or add **Connector mappings**. Their typed data uses, for example,
   `{"board_id":"board-a","connector_id":"J1","position_mm":[10,20,5],"pins":{"1":"DATA","2":"GND"}}`.
   Explicit positions and pins override discovery. Use the physical cable exit
   point, especially for bottom-side or elevated connectors.
3. Choose a connector pair, or leave both automatic. Automatic pairing accepts
   only nets with exactly two available pin occurrences on different boards.
   Shared grounds, buses and repeated same-net pins produce diagnostics. An
   explicit pair matches unique equal net names; an explicit pin map permits
   reviewed crossovers or different net names.
4. Set AWG, slack and allowance per termination. Optionally provide ordered
   waypoints and solid forbidden-volume boxes, all in assembly millimetres.
5. Generate and review the proposal. Cut length equals routed polyline length
   times `(1 + slack_percent / 100)`, plus twice the termination allowance.
   Each mapped conductor receives that cut length in the CSV wire list.
6. **Add proposal to assembly draft**, then **Save board and harness structure**.
   Existing assigned pins cannot be reused. Changed planner inputs require a
   fresh proposal before applying or exporting it.

The bounded A* router avoids the interiors of up to 24 clearance-inflated
axis-aligned boxes and supports up to 32 waypoints, with a 100000-node search
limit. Routes are rendered as exact polylines, without curve smoothing through
obstacles. Moving an endpoint invalidates the saved route visually; regenerate
it after placement changes. Keepouts are explicit user input, not inferred
from STEP meshes. An enclosure's outer bounding box includes its usable
interior and generally should not be used as one solid keepout.

These are wiring and geometric proposals. Bend radius, connector mating,
wire ratings, physical fit, EMC performance and electrical coupling are not
qualified by the planner. Same net names describe proposed connectivity and
are not proof of compatible voltage domains. Existing analysis admission and
coupled-solver restrictions continue to apply.

## Explicit-pin DC harness review

The **Solve > PI > Harness PI** editor provides a project-owned harness document,
connector/pin tables and text pin maps. See [Harness PI](HARNESS_PI.md) for the
new native lumped DC execution path. It is distinct from board-field coupling:
board placement and a harness circuit alone do not extract board copper losses.

## STEP enclosure pieces and external CAD

For reviewed updates to existing occurrence placements, use the
[FreeCAD collaboration session](FREECAD_COLLABORATION.md). The assembly import
described below is the separate path for adding new occurrences and assets.

Use **Attach part** for individual STEP/STP or self-contained glTF/GLB pieces.
After importing a STEP piece, select it and use **Tessellate STEP for viewport**.
The bounded FreeCAD adapter retains the original STEP alongside its derived
visual GLB. Numeric placement, parent-frame hierarchy, material assignment and
the existing exact-shape extraction tools remain available for imported parts.

The FreeCAD workbench now includes **SPIKE → Export SPIKE Assembly…**. Select
assembly roots or parts, export `.spikeassembly`, and import that file in SPIKE.
Nested App::Part/groups retain their hierarchy and placements. STEP geometry
is separated from occurrence placement; repeated instances remain separately
placeable. Exported shapes have no inferred solver semantics. Bake non-unit
link scales before exporting. The real-kernel regression covers nested rigid
parts; arbitrary assembly-workbench constraints and linked-document variants
are not comprehensively qualified.

To retain electrical board data from FreeCAD, add a string property named
`SPIKEBoardSource` to the corresponding placed PCB object and set it to an
existing `.kicad_pcb` or `.ipc2581` file. The object's local coordinate system
must match the electrical file. Without this property, a PCB-looking STEP
solid is imported as mechanical geometry.

For other CAD programs, export neutral STEP parts plus occurrence placements
to the documented ZIP exchange below, or open a supported neutral assembly
in FreeCAD and use the workbench exporter. Proprietary native CAD files are
not directly parsed. CAD mates, feature history, external references and
vendor-specific constraints do not become editable native SPIKE constraints.

## Portable exchange format

A `.spikeassembly` is a ZIP containing `assembly.json` and the referenced
assets. Example manifest:

```json
{
  "contract": "spike/assembly-exchange/v1",
  "name": "Controller enclosure",
  "source_cad": "External CAD exporter",
  "units": "mm",
  "occurrences": [
    {"id":"housing","kind":"group","name":"Housing"},
    {"id":"base","kind":"part","parent_id":"housing","asset":"assets/base.step"},
    {"id":"controller","kind":"board","parent_id":"housing","asset":"assets/controller.kicad_pcb",
     "transform":[1,0,0,10,0,1,0,20,0,0,1,8,0,0,0,1]}
  ]
}
```

Transforms are row-major proper rigid 4×4 matrices, relative to `parent_id`;
omission means identity. Units apply to placement translations, connector
positions and harness lengths. Geometry files retain their own format units
(glTF uses its normal metre convention); no extra geometry scaling is inferred.
Occurrence IDs must be unique. Reusing an asset deduplicates model storage,
while occurrence identities stay distinct. Groups carry placement but no model.

Board assets can also be canonical SpiDeR v2 `.json` files. Part assets are
STEP/STP or self-contained glTF/GLB. Optional `connector_mappings` and `harnesses`
use the AssemblyIR fields, with source occurrence IDs in `data.board_id` and
`board::connector` endpoints. The importer remaps these IDs into the destination.
No host paths are followed. Limits are 256 archive members, 256 MiB per asset,
512 MiB total expanded data, and a 200:1 compression ratio. ZIP_STORED is useful
for highly repetitive STEP geometry. Missing assets, bad parents, cycles,
unsafe paths and identity conflicts fail before the project is replaced.

Implementation: `assembly_exchange.py`, `service_assembly_import.py`,
`harness_authoring.py`, `harness_routing.py`, and the FreeCAD workbench's
`assembly_export.py`. The exporter uses the documented FreeCAD
[TopoShape STEP export](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TopoShape_API.md)
and [hierarchical placement API](https://freecad.github.io/API/d7/d75/classApp_1_1GeoFeature.html).
