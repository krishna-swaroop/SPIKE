<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR 0027: Executable reduced models for coupled assemblies

Status: implemented experimental/approximate workflow; field qualification open.

## Decision

Add separate versioned worker contracts for shared native MNA circuits, shared
thermal RC networks, and reciprocal magnetic-loop impedance systems. Inputs
use retained board occurrences and explicit connector/contact physics. Namespace
board-local terminals; topology or equal net names do not short returns. Graph
planning and qualified field execution remain separate admission boundaries.

Python owns preparation, validation, numerical composition and result binding.
TypeScript presents property editors and projected results. Rust only classifies
heavy worker operations and approves existing project paths. Native MNA and
thermal kernels are reused; NumPy solves the bounded explicit RL loop matrix.
No new runtime or dependency is introduced.

Store per-domain unfinished setup in AssemblyIR's additive extensions under
spike.multiboard-studies. Store complete outputs using existing state artifacts.
Physical identity excludes studies; exact request identity includes the selected
canonical assembly. Result-free exports retain setups and remove outputs.
Standalone study files carry both setup and nullable results and bind to the
current assembly. Their digests establish consistency, not authenticity.

## Consequences

Imported board geometry alone cannot supply the reduced model. Users must
define/extract board circuits, return paths, thermal contacts, or loop matrices.
The workflow executes actual inter-board effects within these assumptions.
General SI delay/full PCB EM fields, radiation/EMI qualification and conjugate
heat transfer remain separate external solver work. Analytical evidence and
human numerical review are required before promoting any qualification claim.
See MULTIBOARD_COUPLED_ANALYSIS.md and the domain model references.
