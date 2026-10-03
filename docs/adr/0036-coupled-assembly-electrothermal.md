<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Coupled assembly electrothermal worker

Status: accepted for experimental development, October 4, 2026.

## Decision

Add a separate versioned worker request/result for steady DC and solid-thermal
feedback on the same retained tetra volumes. Reuse thermal geometry admission,
but require every retained electrical bond to compile into a matched contact
operator before lowering it out of the thermal-only adapter. Preserve original
assembly/request hashes. Unsupported retained connectivity remains an error.

Provide explicit averaged heating sources rather than silently assuming arbitrary
SPICE devices support temperature feedback. Separate dissipative waveforms,
orthogonal RMS resistive data and admitted temperature-indexed semiconductor
loss tables. Require nonoverlapping energy declarations and operating conditions.

## Consequences

Temperature and power convergence are mandatory; failed or cancelled studies
return structured worker errors, not successful partial results. Results remain
experimental with no production qualification. Nested thermal load and updated
electrical load differ only within the requested power convergence gate, with
that defect reported explicitly. No new dependency or in-process native ABI.

Thermal-only result validators cannot admit the new coupled record. Desktop
integration must preserve its complete request, distinct result contract and
stale-result checks. General CAD extraction, device subcircuit coverage,
transient coupling and measured qualification are not supplied by this boundary.
