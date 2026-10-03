# Multi-board rendering correction — 2026-10-01

The earlier assembly viewport rendered extra occurrences as envelopes and copper
centerlines and used a single-board 2D view. It did not represent complete boards.

The corrected paths render full retained geometry (outline/cutouts, filled zones,
track widths, pads, vias, and drawings), verified KiCad board/component scene assets,
and missing-component placeholders in each 3D occurrence. Assets are cached by URL
and shared across occurrences. Component assets replace only resolved references.
Canonical net identities remain separate from occurrence identities; visible GLB
copper does not remove the logical net picking geometry or linked-net overlay.

The assembly 2D viewport projects every occurrence through its exact assembly XY
transform, renders source layer artwork with complete parsed-geometry fallback, and
draws harness routes. Stacked boards overlap in top view; the occurrence selector
and selected-board drawing order expose each without changing physical placement.
Pan, zoom, fit, layer visibility, and canonical net selection remain available.

Nonactive designs are read from the manifest-bound package by retained design ID
and exact source SHA-256, never by board name or the active design's source. Source
bytes and solver geometry are unchanged. Missing library models are reported rather
than presented as resolved assets.

Focused geometry, XY transform, canonical net, model mounting, source identity,
and stale-manifest tests pass. Native screenshot verification remains pending:
Windows Computer Use returned black frames and could not activate the captured
SPIKE window even after handle recovery. This is not visual acceptance evidence.

## Verification

- Frontend TypeScript check, production build, board-parser regression, complete-scene, assembly 2D, and harness tests passed.
- Rust library tests: 35 passed, 1 ignored; native debug build passed.
- Architecture check passed.
- Full Python suite: 2,339 tests, 1 failure, 12 skipped (509.277 s). The failure is `test_current_candidate_is_technical_but_externally_blocked`: release-readiness expects `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`, but the current third-party notice wording no longer triggers that gate. This is separate from assembly rendering; no release gate or notices were changed to make the suite pass.
