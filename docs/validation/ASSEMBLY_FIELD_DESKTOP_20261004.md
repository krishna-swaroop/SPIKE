<!-- SPDX-License-Identifier: Apache-2.0 -->
# Assembly field desktop integration - 2026-10-04

## Scope

The dedicated assembly workspace now admits supplied conforming board and
mechanical volumes through the verified retained-field worker methods.
Boundary edits retire results, execution is gated to experimental steady
thermal conduction without unsupported retained links, and per-occurrence
temperature extrema use display names. EM/SI volume preparation remains
non-executable. No CAD volume generator, radiation coupling, full-wave claim or
spatial field overlay is introduced by this integration.

Records are stored at `analyses.assembly_field_study` in `.spike`, with exact
physical-assembly and manifest binding. Native reads require a host-opened
manifest; stale output is withheld. Standalone setup/results files use the
worker's self-digested snapshot contract. Ordinary setup-only save must retain a
valid recomputed digest. Board/part IDs remain separate occurrence identities.

## Acceptance checks

- Worker/project tests exercise the original two-solid contact example, offline
  package reopen, saved experimental status, corruption and resource rejection,
  exact assembly coverage, stale withholding and failed-save atomicity.
- The field editor callback test exercises boundary-result invalidation,
  admitted-result reset, setup-only save/export, occurrence display names,
  execution blockers and late-response rejection after a manifest change.
- Native path/trust tests cover field project method routing and require an
  opened manifest for targeted saved-study reads.
- Type checking, button-standard and architecture gates are run on the changed
  integration. The frontend production build checks bundling.

Observed results: the 67-test field/package/structure selection passed before
the additional lazy-import regression was added; the latest 8-test field
persistence suite and editor callback check pass. The Rust host library reports
38 passed and one pre-existing live-OS-counter test ignored. Type checking,
parser, assembly workspace, button-standard, architecture and documentation
checks pass. The production frontend builds with its existing mixed-import and
large-chunk warnings. Independent integration review found no actionable defect
in field-study reset, stale admission, save modes or invalidation handling.

Broad Python discovery ran 2,569 tests in 447.132 seconds, with one failure,
two errors and 13 skips. Both model-index errors were outside the managed
writable cache location; rerunning those two tests with
`SPIKE_MODEL_INDEX_PATH=build/assembly-field-model-index.sqlite3` passes.
The release-readiness test still expects
`PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`, while the current notices text
does not trigger that blocker. This policy/expectation mismatch remains open;
the release gate was not changed. The broad suite is not recorded as green.
The latest 27-test field/state/save/MCAD/topology integration selection passes.

Native wide/narrow visual acceptance and real CAD-derived board/casing field
qualification have not been performed for this new editor. The mathematical
two-solid fixture is a reference check, not an Arduino/Raspberry Pi field test.
Knowledgeable human numerical review remains required before release.

## Solver-suite implementation handoff

The user-authorized handoff to **Build modern SPIKE solver suite** requests
conforming physical volumes from real board stacks and mechanical assets,
authenticated source bindings, occlusion/view-factor/radiosity thermal coupling,
explicit standoff/contact paths, and executable geometry-based EM/SI translation
with connector/harness/bond returns and port normalization. The desktop exposes
only verified worker contracts as those implementation gates are completed.
