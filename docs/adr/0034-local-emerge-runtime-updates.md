<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR 0034: Local EMerge runtime update service

- Status: Accepted for the local engineering preview.
- Date: 2026-10-04

## Context

Engine availability and adapter compatibility evolve independently of SPIKE's
application version. Users need an in-app way to update a separately installed
EMerge 3+ runtime while retaining its exact interpreter identity and the
existing distinction between API detection and validated physics.

## Decision

Keep update orchestration in the Python worker, with three methods using
`spike/emerge-runtime-update/v1`. A checked PyPI version and verified, isolated
solver virtual environment precede background package installation. Never
update the worker/system interpreter by fallback. Pin the selected public
EMerge version, disallow downgrades, neutralize pip configuration and inherited
index settings, and limit installs to wheels from the fixed PyPI index.

Coordinate EMerge and Optycal runtime use with the update operation inside the
resident worker because their default solver environment is shared;
use an OS file lock to prevent two workers updating the same environment.
Keep process output bounded and return explicit terminal states. Read back
the package version, run pip dependency checking, and reuse the adapter's
fresh-process API probe after installation. Only all three passing can yield
success; numerical validation status remains unvalidated.

## Consequences

The GUI remains responsive and Rust gains no package-management logic. Stable
and prerelease channels are explicit; a stable EMerge 2 release is never used
as fallback. Upstream runtimes remain separately licensed installations.
Python/platform wheel compatibility can fail at install time. Package updates
are not atomic or automatically reversible. Forced process termination can
orphan an installer, and operation history is not persisted across worker
restarts; unknown status cannot be interpreted as termination. Recovery and
release acceptance limits are documented in
[the runtime update workflow](../EMERGE_RUNTIME_UPDATES.md).
