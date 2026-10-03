<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native EMerge Gerber validation

Date: 2026-10-04. Applies to SPIKE and standalone sibling SPIKE-Em.

## Delivered behavior

The [native Gerber source manager](../EMERGE_GERBER.md) retains original copper
artwork, explicit dielectric gaps, rectangular bounds and one or two manual
adjacent-layer port planes. It supports portable source-package import/export
and normal project save/reopen. Material-manager edits supply executed material
values while imported source metadata remains unchanged.

EMerge loads the artwork through `FileBasedPCB.layer_from_file`; neither KiCad
conversion nor a SPIKE copper parser is used. Existing KiCad/polygon workflows
remain separately available. The shared setup, generated Python, native mesh,
network/radiation/field result admission and probes accept the native source.
Dielectric-box surroundings are admitted through the existing validator rather
than silently omitted. Source, case and script hashes bind retained input.

SPIKE-Em's fixed built-in engine gateway admits the new import commands. Its
read-only source importer is available through the ordinary importer registry;
the core engine remains outside the mutable add-on catalog. Missing Gerber
dependencies block native execution without disabling the KiCad adapter.

## Focused and integration evidence

Passed in both projects:

- GUI source export/open, BOM/CRLF preservation, safe Unicode filenames,
  bounds/resource/port gates, hidden KiCad terminal fields, runtime recovery,
  pending-state controls and explicit unsupported-drill state.
- Actual backend snapshot through the production normalized-board parser:
  declared bounds and stackup render without invented tracks, pads or zones.
- Source artwork and current material values survive project save/open;
  imported material evidence is preserved separately.
- Registered process importer, generated-source digest binding, exact native
  file materialization, manual port provenance and optional-dependency probe.
- EMerge and extension workflow regression checks, parser/normalized-board
  checks, shared button/control standard and architecture guards.
- TypeScript and final production builds. Existing bundle-size/import warnings
  and React static-render useLayoutEffect warnings remain.

All 11 Gerber Python tests passed in SPIKE's final full run. SPIKE-Em passed 10
with one optional real-runtime skip. All 12 standalone engine/product-gate
tests passed, including the new native Gerber dispatch and registered importer.

The real native test used EMerge 3.0.0a19 from SPIKE's `.venv-emerge3`, with
PyGerber 2.4.3 and its dependencies in a disposable `.local/gerber-api-deps`
test target. It loaded independently authored millimetre dark/clear-region and
inch flash/trace fixtures, checked metre-scale extents and the clear hole, and
generated an actual mesh. The observed fixture mesh had 539 nodes and 2,622
tetrahedra. No RF field solve or physical/convergence validation was performed
for this native Gerber source. No packages were added to either solver runtime.

## Required suite outcomes

Configured project `.venv/Scripts/python.exe -X utf8` was used for these runs.

| Gate | SPIKE | SPIKE-Em |
| --- | --- | --- |
| Full Python | 2,525 tests; one failure, two errors, 13 skipped | 2,411 tests; 47 failures, 36 errors, 72 skipped |
| Rust host | 38 passed, one ignored | 34 passed, one failure, one ignored |

SPIKE's known `test_current_candidate_is_technical_but_externally_blocked`
failure still expects the absent `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`
issue. Two additional errors were SQLite model-index writes outside the
writable workspace in `test_model_library_indexes_step_assets_offline` and
`test_one_explicit_model_override_repairs_all_instances_without_editing_source`.
Both passed on a focused rerun using `SPIKE_MODEL_INDEX_PATH` inside the
workspace. The full-run snapshot remains failed; it is not represented as green.

SPIKE-Em's 83 failure/error identities exactly match
`SPIKE_EM_CHART_FLEX_UPDATE_PYTHON_TESTS.txt`; no new identities were introduced.
Its Rust failure remains the absent packaged-worker fixture in
`resident_packaged_worker_preserves_a_native_spikes_session`.

Main logs are `.local/plot-wheel/main-native-gerber-{python,cargo}.txt` and
`main-native-gerber-cache-recheck.txt`. Standalone logs are
`docs/validation/SPIKE_EM_NATIVE_GERBER_{PYTHON,CARGO}_TESTS.txt`.
An initial run through the system Python 3.14 lacked project dependencies;
those diagnostic logs are separately named and are not the configured suite
outcomes above. An automatic build-approval review timed out once; its allowed
retry completed and both final builds passed.

## Acceptance limits

Native wide/narrow-window visual acceptance and screenshots remain unverified.
The supported browser surface previously rejected the preview URL; no alternate
automation route or native application launch was used to bypass that limit.
Static rendering and responsive CSS checks do not establish native visual
acceptance.

The selected EMerge interpreter must supply its optional Gerber dependency.
The GUI currently admits at most eight total layer/drill files, 512 KiB per
file and 2 MiB aggregate content. Excellon files are retained, but their
presence blocks meshing/solving until native via semantics are integrated.
Manual port planes are not verified against pads or conductor contact; Gerber
does not provide net/pad identity. Copper is surface PEC and dielectric extents
use the declared rectangle. Native simplification belongs to the selected
runtime. Future EMerge majors fail closed for this native loader until checked.
These are unvalidated geometry/solver integrations, not release qualification.
