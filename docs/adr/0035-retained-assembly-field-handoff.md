<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Retained assembly field handoff

Status: Accepted for the experimental bounded reference path.
Date: 2026-10-04.

## Context

Reduced multiboard networks and viewport geometry cannot establish solid
conduction, EM fields or general channel extraction. Retained occurrences
require complete supplied volumes, material/placement traceability and explicit
contact/port bindings before a field adapter can execute them safely.

## Decision

Add separate EDA-neutral versioned handoff, thermal problem, result and offline
study contracts. Reuse `solver-mesh/v1` without adding ownership fields to its
public object map; occurrence ownership stays in handoff traceability and is
lowered into internal thermal admission only. Preserve shared source instances
as distinct nodes. Require proper rigid millimetre placements and check every
represented cell Jacobian after SI/world transformation.

Keep steady P1 conduction, geometric view factors, saved-result admission and
worker dispatch in separate original Python modules. Use existing NumPy/SciPy
dependencies; no new runtime dependency or external code is introduced.
Declare unsupported links and general Maxwell/SI execution explicitly. Never
promote a handoff or reduction to production-qualified field solving.

## Consequences

The path provides reproducible bounded solid-field evidence and shared geometry
identity for future EM/SI adapters, without changing reduced study ownership or
the frontend. Matched contact meshes must be refined coherently and all changed
inputs invalidate output. Source/stack hashes remain caller declarations until
a trusted CAD/package adapter verifies them. Distributed execution, automatic
CAD tetrahedralization, nonmatching interfaces, radiation coupling, airflow,
GUI forms and qualified Maxwell/SI translators remain separate work.
