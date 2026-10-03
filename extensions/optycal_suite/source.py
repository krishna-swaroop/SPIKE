# SPDX-License-Identifier: Apache-2.0
"""Bound a solved EMerge complex angular source to an Optycal study.

SPIKE-owned adapter, independently authored from public API signatures. This
is an explicitly assumed outgoing far-zone source, not a FEM near-field model.
"""
from __future__ import annotations

import hashlib
import json
import math

from extensions.emerge_suite.normalize import radiation

PHASE_ASSUMPTION = "emerge_farfield_coefficient_e_plus_jwt"


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number.")
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}.")
    return value


def vector(value, name, limit):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{name} needs three explicit values.")
    return [number(v, name, -limit, limit) for v in value]


def prepare_source(parameters, binding):
    source = parameters.get("emerge_analysis_result")
    if (not isinstance(source, dict) or source.get("contract") != "spike/v1" or
            source.get("status") not in ("completed", "completed_with_warnings") or source.get("mode") != "emi" or
            source.get("model_status") not in ("validated", "reference_validated", "approximate", "unvalidated")):
        raise ValueError("Select a completed EMerge radiation AnalysisResult.")
    provenance = source.get("provenance", {})
    if not isinstance(provenance, dict) or not str(provenance.get("solver", "")).startswith("EMerge/"):
        raise ValueError("The source must carry EMerge solver provenance.")
    if provenance.get("extension_id") != "spike.emerge-suite" or any(
            not isinstance(provenance.get(key), str) or len(provenance[key]) != 64 or
            any(c not in "0123456789abcdef" for c in provenance[key])
            for key in ("design_digest_sha256", "board_case_sha256", "generated_script_sha256")):
        raise ValueError("The source needs complete EMerge case, script and board digest provenance.")
    if (not binding or provenance.get("design_id") != binding.get("design_id") or
            provenance.get("design_digest_sha256") != binding.get("digest_sha256")):
        raise ValueError("The EMerge source belongs to a different board revision.")
    raw = source.get("fields", {}).get("radiation")
    normalized, _ = radiation(raw)
    if "excitation_port" not in normalized:
        raise ValueError("The EMerge source must record an explicit port excitation and coefficients.")
    frequency = number(parameters.get("frequency_hz"), "frequency_hz", 1e3, 1e14)
    patterns = [v for v in normalized["patterns_3d"] if v["frequency_hz"] == frequency]
    if len(patterns) != 1:
        raise ValueError("Choose an exact solved frequency with a full complex EMerge sphere.")
    if parameters.get("source_phase_assumption") != PHASE_ASSUMPTION:
        raise ValueError("Explicitly acknowledge the EMerge outgoing-coefficient phase and origin assumption before a coherent study.")
    # Preserve the entire source digest, not just its peak-normalized display.
    source_bytes = json.dumps(source, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(source_bytes) > 8 * 1024 * 1024:
        raise ValueError("EMerge source exceeds the 8 MiB exchange bound.")
    steps = {}
    for key in ("theta_step_deg", "phi_step_deg"):
        value = parameters.get(key, 15)
        if isinstance(value, bool) or value not in (5, 10, 15, 30):
            raise ValueError(f"{key} must be 5, 10, 15 or 30 degrees.")
        steps[key] = int(value)
    return {"contract": "spike/optycal-case/v1", "frequency_hz": frequency,
            "source_pattern": patterns[0], "source_analysis_id": source["analysis_id"],
            "source_model_status": source["model_status"],
            "source_excitation": {key: normalized[key] for key in ("excitation_port", "excitation_ports", "excitation_coefficients", "excitation_normalization")},
            "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "source_phase_assumption": PHASE_ASSUMPTION,
            "antenna_translation_mm": vector(parameters.get("antenna_translation_mm", [0, 0, 0]), "antenna translation", 1e7),
            "antenna_rotation_deg": vector(parameters.get("antenna_rotation_deg", [0, 0, 0]), "antenna rotation", 360),
            "antenna_aperture_mm": number(parameters.get("antenna_aperture_mm"), "antenna_aperture_mm", 0.001, 10000),
            "observation_radius_m": number(parameters.get("observation_radius_m", 100), "observation_radius_m", 0.001, 1e6),
            **steps}
