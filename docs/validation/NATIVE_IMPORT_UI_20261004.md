# Native source import validation — 2026-10-04

## Current continuation

The user confirmed that another chat owns the active v0.3.1 merge. Work in this
continuation is confined to non-conflicted source import components, focused
tests, and new documentation. No merge conflicts were resolved by this task.

Changes cover optional harness electrical/property mappings, bounded CSV header
inspection, contract detection for generically named JSON, cancellation during
file/header reads, awaiting worker cancellation, accessible keyboard focus, and
shared theme tokens for the import dialog.

Checks run successfully against the current independent files:

- `node app/scripts/test-source-import.mjs`: actual component event handlers
  exercised through a hook harness; routing, multi-step selection, mapping,
  prepare/apply separation, failure retry, cancellation and stale responses.
  This is not a native window or browser rendering test.
- `node app/scripts/check-button-standard.mjs`: desktop entrypoint and four
  interactive previews satisfy the shared control standard.
- `.venv/Scripts/python.exe -m unittest discover -s tests/python -p test_odb_source_inspection.py -v`:
  four checks pass, including the real registry/process invocation boundary.
- `.venv/Scripts/python.exe -m unittest discover -s tests/python -p test_native_harness_import_mapping.py -v`:
  one process-boundary check passes. Vendor endpoints and length mapping,
  canonical electrical properties, leading-zero pin IDs, unmapped vendor
  properties, and mapping provenance survive import.

## Previous pre-merge evidence

Before the current conflicted source state, the frontend type check/build and
focused board/import/project/MCAD tests passed. Rust library tests reported
38 passed and one ignored; a debug desktop host was built. Focused ODB++/harness,
IPC-2581 and registry checks also passed.

The earlier full Python run reported 2,402 tests, 13 skips, one failure and two
errors. The cache permission errors passed on approved focused reruns. The
release-policy expectation failure remained unresolved. The original log is
`build/source-import-validation/python-tests.log`. These are prior-run results,
not validation of the current merge or the latest dialog changes.

An earlier native wide-window observation showed the unified dialog and combined
file picker over the real board workspace. It exposed action-button sizing
problems that were corrected. User Escape stopped computer use before completion
of the import sequence. No complete native end-to-end or narrow-window acceptance
is claimed.

## Remaining acceptance after merge

The App, worker bridge, native Rust host, package manifest and shared service
files are conflicted. Whole-app builds and native runtime acceptance remain
unverified for this source state. The existing integration is present in merge
stage 2 for `App.tsx`, `workerBridge.ts` and `src-tauri/src/lib.rs`; stage 3 does
not contain it. Merge resolution must retain the import entrypoints, staging
callbacks, combined picker, and exact-path approved source reader.

After resolution, run the frontend type check/build and affected native host
tests, then exercise:

1. Open a saved project/results package and preserve the restore behavior.
2. Open a KiCad board, normalized JSON, ODB++ archive/folder and IPC-2581 source;
   inspect diagnostics, choose a multi-step job, apply and check geometry.
3. Import a vendor connection list with optional properties, inspect typed wire
   fields in the editor, save, reopen and confirm persistence.
4. Open a mechanical model into the attachment workflow; verify the saved
   assembly and selected source rather than just the attachment panel.
5. Exercise dirty-project save/discard/cancel, corrupt sources, worker
   cancellation, expanded diagnostics and long paths in wide and narrow windows.
6. Inspect dark, light and high-contrast modes and keyboard focus, including
   collapsed optional mappings and a save prompt over the import dialog.

These checks establish UI integration. They do not establish complete vendor
format parity, manufacturing qualification, MCAD export fidelity, or solver
readiness for unsupported imported features.
