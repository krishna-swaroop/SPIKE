# SPDX-License-Identifier: Apache-2.0
"""Public EMerge feature inventory with explicit SPIKE adapter boundaries.

Reference: https://www.emerge-software.com/features (2026-09-30).
This is an integration inventory, never a physical-validation statement.
"""

from __future__ import annotations


def capability_inventory() -> list[dict]:
    implemented = [
        ("pcb_multilayer", "Multilayer PCB surfaces", "2-16 copper layers; selected nets, rectangular rigid board; no multilayer vias"),
        ("native_gerber", "Native Gerber PCB surfaces", "Retained Gerber artwork is loaded directly by EMerge FileBasedPCB; 2-16 ordered copper layers, explicit stackup and one or two manual adjacent-layer ports; Excellon execution blocked"),
        ("dielectric_materials", "Per-layer dielectric materials and loss", "Explicit constant relative permittivity; optional imported loss tangent"),
        ("lumped_ports", "Lumped ports", "Two to eight aligned pad-pair ports on adjacent layers, up to four selected signal nets, explicit reference impedance"),
        ("absorbing_boundary", "Absorbing air boundary", "Finite air region with optional explicit margin; requires convergence review"),
        ("mesh_controls", "Manual copper and port mesh sizing", "Bounded requested copper resolution and port face refinement"),
        ("mesh_export", "PCB tetrahedral mesh without a field solve", "Exact finite nodes and connectivity with design/case/script binding; includes air domain and does not imply reuse by unrelated solvers"),
        ("frequency_sweep", "Solved S-parameter frequency sweep", "2-64 direct solved samples; no vector-fit interpolation"),
        ("parallel_sweep", "Parallel frequency sweep", "Optional 1-8 runtime workers; availability depends on selected runtime API"),
        ("farfield", "Far-field cuts and 3D patterns", "Configurable bounded angular sampling; relative normalization only"),
        ("nearfield", "Electric and magnetic field plane", "Optional XY grid with complex E/H samples and explicit invalid-point mask"),
        ("touchstone", "Touchstone and CSV export", "Exports returned complex network data at its stated reference impedance"),
        ("emcad", "EMCAD copper geometry", "Optional same-net, same-layer union; holes rejected"),
        ("dielectric_surroundings", "Dielectric surroundings", "Up to eight explicit non-overlapping boxes"),
        ("script", "Readable Python model", "GUI preview/export matches the generated script used by the contained runner"),
        ("analysis", "SPIKE analysis, probes and reports", "Sampled network and angular/field review with model status and provenance"),
    ]
    pending = [
        ("general_cad", "General CAD primitives, booleans and transforms", "Requires neutral volume/face selection and an EMerge CAD adapter"),
        ("pml", "Perfectly matched layers", "Requires explicit volume assignments and thickness validation"),
        ("wave_ports", "Waveguide, coaxial and modal wave ports", "Requires face geometry and mode selection contracts"),
        ("periodic_floquet", "Periodic and Floquet ports", "Requires paired-face periodic-cell contract"),
        ("pmc", "PMC and symmetry planes", "Requires boundary face selection and symmetry validation"),
        ("surface_impedance", "Surface impedance and thin metal", "Requires conductor/material model and boundary contracts"),
        ("lumped_elements", "Lumped elements", "Requires circuit-to-face mapping"),
        ("adaptive_mesh", "Adaptive mesh refinement", "Requires error/convergence admission and bounded refinement lifecycle"),
        ("optimization", "Optimization and geometry parameter sweeps", "Requires geometry parameter ownership and result comparison contracts"),
        ("tensor_materials", "Dispersive and tensor materials", "Requires material tensor, frequency and coordinate validity contracts"),
        ("material_library", "Upstream material library", "Requires provenance and verification of individual library properties"),
        ("vector_fitting", "Vector fitting", "Requires separately identified fitted network and error/passivity evidence"),
        ("eigenmode", "Eigenmode studies", "Requires eigenmode excitation, units and mode-shape result contracts"),
        ("rcs", "Scattered-field and radar cross section", "Requires incident-wave setup and absolute scattering result contract"),
        ("thermal", "Heat conduction and one-way coupling", "Requires thermal boundaries and transferred-loss validity contracts"),
        ("gpu_direct", "Alternate CPU/GPU direct solvers", "Requires runtime discovery and explicit supported solver selection"),
    ]
    return [{"id": identity, "name": name, "status": status, "scope": scope,
             "source": "https://www.emerge-software.com/features"}
            for status, rows in (("implemented_unvalidated", implemented), ("adapter_pending", pending))
            for identity, name, scope in rows]
