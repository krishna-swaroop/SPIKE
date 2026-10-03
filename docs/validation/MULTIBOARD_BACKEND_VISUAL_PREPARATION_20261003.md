<!-- SPDX-License-Identifier: Apache-2.0 -->
# Multi-board backend visual preparation - 2026-10-03

## Scope

This record covers manifest-bound preparation of retained assembly board
visuals. It does not change imported SpiDeR geometry, solver input, numerical
status, or the source board. The `ready` request still runs the same independent
KiCad layout, board, and component exporters and validates each returned
artifact under its existing byte, digest, SVG, and self-contained GLB rules.

The exporters previously ran serially. They now run concurrently with one
isolated temporary directory per stage. Package verification, retained design
selection, source digest verification, packaged STEP admission, and response
assembly remain deterministic and single threaded.

## Retained real-board evidence

The retained fixture was
`build/arduino-shield-acceptance-20261002/arduino-r4-relay-shield.spike`,
manifest payload SHA-256
`b13e31b210fa6b9f8df6e9a25d688f1624cb6680c372c84a181f919fd28fee60`.
The measured design was `uno`, design ID
`6fd63004-d50d-5da2-a47d-08f055d044c8`, with 85 components and 68 retained
component model assignments. Each run used a new isolated model-index cache.

| Run | Ready wall time | Layout bytes | Board bytes | Component bytes | Result |
|---|---:|---:|---:|---:|---|
| Serial baseline | 28.418 s | 1,106,388 | 15,716,508 | 2,564,140 | all three stages ready |
| Concurrent stages | 10.753 s | 1,106,388 | 15,716,508 | 2,564,140 | all three stages ready |

The observed wall time decreased by 62.2%, or 2.64 times for this run. Artifact
byte counts were identical. These are single local runs with KiCad 10 and cold
isolated metadata caches; they establish the changed scheduling path and output
equivalence for this fixture, not a universal throughput guarantee or an FPS
claim. The focused concurrency test additionally requires two no-model stages
to enter preparation together while asserting deterministic response order.

## Failure and recovery contract

A failed optional stage does not discard the verified source or another
completed stage. The result keeps the compatible `stage_errors` text map and
adds:

- `stage_diagnostics[stage]`: a bounded `spike/error/v1` envelope with
  `SPIKE-BE-VIEW-E-0001`, the failed stage in safe context, and retry metadata;
- `recovery.preserved_stages`: stage payloads that remain usable;
- `recovery.retryable_stages`: only stages that failed;
- `recovery.reopen_project_required=false`: retry can use the still verified
  open project identity.

Recovery is to keep the completed stages, inspect the native diagnostic, repair
the source, model assignment, local KiCad installation, or resource condition
named by that diagnostic, then retry the failed stage. A stale manifest, source
digest mismatch, corrupt package artifact, or invalid request still fails the
whole request before exporters start and must follow its package error.

## Verification

The focused Python run passed 36 tests covering assembly visual identity,
concurrent readiness, partial-stage recovery, KiCad visual repair boundaries,
model-resolution staging, staged artifact admission, and the canonical error
catalog. Tests used `SPIKE_MODEL_INDEX_PATH` at an isolated writable temporary
location and removed its database, WAL, and shared-memory files afterward.

