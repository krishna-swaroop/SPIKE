# Multi-board rendering and UI verification — 2026-10-02

## Changes

- Retain every footprint model assignment and transform, including normalized design model IDs. Resolve hierarchical GLB component references and replace placeholders only for resolved references.
- Correct assembly GLB axes against the real eBrake export. Reuse scene geometry for selection and occurrence-specific layer/opacity updates. Prefer authoritative native board geometry in unfiltered normal views; Board body is visible by default.
- Provide occurrence-specific layer stacks and net managers, plus explicit connector pin mapping rows. Equal net names do not connect separate board occurrences.
- Keep assembly SVG controls in a compact bottom row above the legend. Notifications participate in the top HUD grid rather than competing with board controls. Form fonts and heights are scoped explicitly.
- Retry typed busy-worker responses during retained design visual preparation, bounded to three minutes and cancelled on project changes.
- Guard development startup demo loading against replacing an open project during Fast Refresh, and discard a late demo parse when the project generation changes.
- Install the reusable `spike-ui` skill. Its tracked source is `docs/skills/spike-ui`; its discoverable installed copy is under the user's Codex skills directory.

## Evidence

Focused checks passed for assembly 2D transforms, repeated designs, harness endpoints, canonical net mapping, occurrence layer isolation, baked geometry fallback, selection geometry reuse, connector manager operations, and normal renderer layer gates at 2/6/12/16/32 layers. Eleven focused Python tests passed for source visual security, linked nets, and corrected real Arduino/Pi connector placement. Architecture checks, TypeScript checking, production build, and skill validation passed.

Native UI inspection at 1442 × 938 with an open board inspector confirmed the assembly selector and Fit button occupy a compact row separate from the title, selection status, and top diagnostics. The native session also exposed worker contention and development demo substitution; both were corrected. Narrow-window visual acceptance and complete model recovery for all imported third-party boards have not been established by this inspection.

The full Python suite ran 2342 tests, with 12 skips and one failure in the existing public release readiness expectation. The release policy gate was not weakened. Rust library tests passed 35 tests, with one ignored.

See `ARDUINO_RPI_MULTIBOARD_ACCEPTANCE_20261002.md` for real board provenance, connector alignment tolerances, reduced PI/SI/thermal/magnetic checks, and explicit assumptions. Full-wave assembly field coupling and far-field EM remain unsupported. Missing third-party models remain reported rather than synthesized as resolved assets.
