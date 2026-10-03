# Native source import

The desktop Open action uses one native picker for saved SPIKE projects and
results, KiCad boards, normalized design snapshots, ODB++ jobs, IPC-2581 boards,
harness connection lists, and mechanical models. Saved projects and results
follow the restore workflow. CAD and connection sources open the import dialog
with the selected file and detected format. Generic JSON files are classified
by their document contract.

Import project / CAD, the project manager Import action, and the ODB++ extension
commands use the same dialog. ODB++ folder selection is available separately
because a directory cannot be selected by the native file picker. Browser-only
operation continues to use the existing text board upload path.

## Prepare and apply

Choose a source and verify its format, then prepare the import. ODB++ job
inspection reads the matrix through the registered extension and lists the job
steps. A multi-step job needs an explicit selection; a single-step job can use
its declared default. Archives remain subject to the importer package policy.
The inspection command does not import geometry.

ODB++ and IPC-2581 preparation returns a normalized snapshot and import report.
Review the coverage and unsupported-feature diagnostics before applying. KiCad
and normalized JSON preparation reads the source; board parsing and geometry
checks run at Apply. Preparation does not change the current project.

Applying a board starts a new project after the existing save/discard workflow.
Applying a harness replaces the project's harness and opens its editor.
Applying a mechanical model opens the assembly attachment tool with that model
selected; attachment follows the saved-project workflow. An apply failure keeps
the prepared source available for retry. Missing models and unresolved importer
capabilities remain diagnostics rather than inferred geometry or analysis data.

Cancellation invalidates pending results, including file reads that have not yet
started a worker. A worker cancellation is awaited before another import can
start. Late responses cannot make a cancelled or unmounted dialog ready to
apply. Closing restores focus to the invoking control when it still exists.

## Harness columns

CSV and TSV sources require `wire_id`, `from_connector`, `from_pin`,
`to_connector`, and `to_pin`. Select comma, tab, semicolon, or pipe as the
delimiter. Map a vendor column by entering its exact header beside the canonical
field. Blank mapping controls use canonical headers.

The following optional canonical headers are retained automatically when present:

| Header | Interpretation |
| --- | --- |
| `net` | Declared electrical net |
| `length_mm` | Wire length in millimetres |
| `area_mm2` | Conductor area in square millimetres |
| `resistance_ohm` | Explicit series resistance in ohms |
| `inductance_h` | Explicit series inductance in henries |
| `color` | Wire color |
| `part_number` | Wire part number |

Expand Optional wire fields and electrical properties to map vendor equivalents.
The importer does not convert vendor units automatically. Unmapped vendor cells
remain under each wire's `properties.source_row`; the import provenance records
the column mapping. JSON harness documents follow `spike/harness/v1` directly.

The dialog validates only the connection-list header: quoted delimiters,
escaped quotes, multiline headers, and BOM are supported; empty/duplicate
headers, missing mapping targets, and reused source columns are rejected. Header
inspection is bounded to 65,536 UTF-16 code units and 256 columns. Row parsing,
numeric checks, identities, and connectivity validation remain in the harness
extension. Native approved text reads are bounded to 64 MiB and require an exact
path grant from the picker.

## Implementation and validation

`ImportSourceDialog.tsx` owns staging and cancellation;
`importSourceRouting.ts` owns classification;
`harnessConnectionColumns.ts` owns bounded header mapping.
`odb_source_inspection.py` provides matrix inspection through `spike.odb-import`
and its `odb-inspect` contribution. App state and native path approval remain in
the existing App and Rust host ownership boundaries.

See [the validation checkpoint](validation/NATIVE_IMPORT_UI_20261004.md) for
checks performed and native acceptance work that remains after the active merge.
