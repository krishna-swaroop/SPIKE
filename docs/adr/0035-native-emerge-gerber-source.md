<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR 0035: Retained native Gerber source for EMerge

- Status: Accepted for the experimental local EMerge workflow.
- Date: 2026-10-04

## Context

The existing EMerge adapter compiles selected normalized board objects into
polygons. EMerge 3 also exposes a native Gerber loader. Converting Gerber to a
temporary KiCad board or adding a second polygon parser would discard source
identity, create inferred connectivity and make the native loader impossible
to review as a distinct capability.

## Decision

Admit a bounded `spike/emerge-gerber-source/v1` package through the extension
application and importer registries. Preserve exact source text, hashes,
declared stackup, bounds and manual ports in neutral design metadata. Project a
minimal SpiDeR with layers and display markers but no inferred copper entities,
pads or source nets.

Dispatch by authoritative `design.source_format == "emerge-gerber"` and reject
a conflicting setup discriminator. Compile the retained package into the
existing digest-bound EMerge board case, then call `FileBasedPCB` only inside
the contained solver runner. Generated preview scripts include the same source
and runner branch. Runtime probing treats Gerber as an optional API so its
absence does not disable the polygon adapter. Future EMerge major versions are
fail-closed for this native branch until reviewed.

Use the current neutral design stackup as the authoritative material assignment
at case-compilation time, while requiring its copper order to match the retained
source files. Keep the original package material declarations unchanged as
source evidence.

Retain Excellon files but reject them before mesh generation until native via
semantics are integrated and verified. Do not silently omit holes or replace them with the
existing approximate solid-via model.

## Consequences

Gerber remains a first-class, auditable source without becoming KiCad or fake
normalized copper. Source packages and preview results are larger because the
artwork is deliberately retained. The eight-file and 2 MiB budgets keep process
exchange bounded. The GUI can show declared bounds, layer inventory and manual
port markers, while mesh output supplies review geometry after native loading.

No connectivity, pad verification, copper thickness, plating, material
dispersion or physical accuracy is inferred. This path remains unvalidated and
requires explicit runtime dependencies, convergence evidence and knowledgeable
human review before release use.
