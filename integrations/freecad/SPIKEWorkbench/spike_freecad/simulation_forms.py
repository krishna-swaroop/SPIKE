# SPDX-License-Identifier: MIT
"""Small, strict request builders for the FreeCAD simulation controls."""

from __future__ import annotations

import math


def _number(value, label, *, positive=False, nonnegative=False):
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if not math.isfinite(result) or (positive and result <= 0) or (nonnegative and result < 0):
        raise ValueError(f"{label} must be finite and {'positive' if positive else 'nonnegative' if nonnegative else 'valid'}.")
    return result


def thermal_request(design, board, components):
    known = {str(item.get("reference") or item.get("ref") or "") for item in design.get("components", [])}
    rows = []
    seen = set()
    for item in components:
        ref = str(item.get("component_ref", "")).strip()
        if not ref or ref not in known or ref in seen:
            raise ValueError(f"Thermal component {ref!r} is absent or repeated.")
        seen.add(ref)
        row = {"component_ref": ref,
               "power_w": _number(item.get("power_w"), f"{ref} power", nonnegative=True),
               "r_junction_case_k_w": _number(item.get("r_junction_case_k_w"), f"{ref} junction-case resistance", positive=True),
               "r_case_board_k_w": _number(item.get("r_case_board_k_w"), f"{ref} case-board resistance", positive=True)}
        if item.get("contact_mode") == "pads":
            row["contact_mode"] = "pads"
        else:
            row["contact_size_mm"] = _number(item.get("contact_size_mm"), f"{ref} contact size", positive=True)
        rows.append(row)
    if not rows:
        raise ValueError("Assign measured or estimated power to at least one linked component.")
    values = {"ambient_temperature_c": _number(board.get("ambient_temperature_c"), "ambient temperature"),
              "board": {key: _number(board.get(key), key, positive=key not in {"convection_top_w_m2k", "convection_bottom_w_m2k"},
                                     nonnegative=key in {"convection_top_w_m2k", "convection_bottom_w_m2k"})
                        for key in ("conductivity_w_mk", "thickness_mm", "convection_top_w_m2k",
                                    "convection_bottom_w_m2k", "grid_step_mm")},
              "components": rows}
    if values["board"]["convection_top_w_m2k"] + values["board"]["convection_bottom_w_m2k"] <= 0:
        raise ValueError("At least one convection coefficient must be positive.")
    return values


def pads_for_net(design, net):
    return [pad for pad in design.get("pads", []) if pad.get("net_name") == net
            and isinstance(pad.get("at"), (list, tuple)) and len(pad["at"]) >= 2]


def pad_label(pad):
    return str(pad.get("component_pad") or f"{pad.get('component', '?')}.{pad.get('name', '?')}")


def dc_spec(design, net, source_pad, load_pad, voltage_v, current_a, zone_cell_mm=0.5):
    pads = pads_for_net(design, net)
    named = {pad_label(pad): pad for pad in pads}
    if not net or source_pad not in named or load_pad not in named or source_pad == load_pad:
        raise ValueError("Choose a net and two distinct pads on that net for source and load.")
    def contact(pad, identifier):
        terminal = {"id": identifier, "position_mm": [float(pad["at"][0]), float(pad["at"][1])],
                    "contact_resistance_ohm": 0.0, "package_resistance_ohm": 0.0}
        layer = str(pad.get("layer") or "")
        # Through-hole pads use KiCad's *.Cu wildcard. The PI mesh expects a
        # concrete layer or an unrestricted connected-conductor terminal.
        if layer and layer != "*.Cu":
            terminal["layer"] = layer
        return terminal
    return {"contract": "spike/v1", "mode": "dc", "solver_id": "auto",
            "required_capabilities": ["dc_resistance", "tracks", "through_vias", "pads", "copper_zones"],
            "net_names": [net],
            "sources": [{**contact(named[source_pad], "freecad-source"),
                         "voltage_v": _number(voltage_v, "source voltage", positive=True)}],
            "loads": [{**contact(named[load_pad], "freecad-load"),
                       "current_a": _number(current_a, "load current", positive=True)}],
            "mesh": {"zone_cell_mm": _number(zone_cell_mm, "zone cell size", positive=True),
                     "max_zone_cells": 20000}}


def si_request(values):
    channel = {"kind": "rlgc", "coupled": False,
               "length_m": _number(values.get("length_m"), "length", positive=True),
               "resistance_ohm_per_m": _number(values.get("resistance_ohm_per_m"), "resistance", nonnegative=True),
               "inductance_h_per_m": _number(values.get("inductance_h_per_m"), "inductance", positive=True),
               "capacitance_f_per_m": _number(values.get("capacitance_f_per_m"), "capacitance", positive=True),
               "loss_tangent": _number(values.get("loss_tangent"), "loss tangent", nonnegative=True),
               "frequency_stop_hz": _number(values.get("frequency_stop_hz"), "frequency stop", positive=True),
               "frequency_points": 513,
               "reference_impedance_ohm": _number(values.get("reference_impedance_ohm"), "reference impedance", positive=True)}
    return {"contract": "spike/si-workflow-request/v1", "channel": channel,
            "sources": [{"port": 0, "resistance_ohm": 50.0, "low_v": 0.0,
                         "high_v": _number(values.get("high_v"), "source high voltage", positive=True),
                         "rise_time_s": _number(values.get("rise_time_s"), "rise time", positive=True),
                         "fall_time_s": _number(values.get("rise_time_s"), "fall time", positive=True)}],
            "receivers": [{"port": 1, "resistance_ohm": 1e6, "capacitance_f": 2e-12,
                           "vil_v": _number(values.get("vil_v"), "VIL", nonnegative=True),
                           "vih_v": _number(values.get("vih_v"), "VIH", positive=True)}],
            "passives": [], "edits": [], "bit_rate_hz": _number(values.get("bit_rate_hz"), "bit rate", positive=True),
            "bit_count": 256, "temperature_c": _number(values.get("temperature_c"), "temperature"),
            "run_time_domain": True, "export_format": "RI"}


def geometry_si_request(design, signal_net, reference_net, reference_layer, stop_hz,
                        path_mode="strict_uniform"):
    nets = {str(item.get("name")) for item in design.get("nets", [])}
    layers = {str(item.get("name")) for item in design.get("layers", [])}
    if signal_net not in nets or reference_net not in nets or signal_net == reference_net:
        raise ValueError("Choose distinct signal and reference nets from the linked board.")
    if reference_layer not in layers or not reference_layer.endswith(".Cu"):
        raise ValueError("Choose a copper reference layer from the linked board.")
    if path_mode not in {"strict_uniform", "piecewise_planar"}:
        raise ValueError("Unsupported SI path mode.")
    stop = _number(stop_hz, "SI stop frequency", positive=True)
    return {"contract": "spike/si-uniform-channel-request/v1",
            "signal_net": signal_net, "reference_net": reference_net,
            "reference_layer": reference_layer, "path_mode": path_mode,
            "reference_impedance_ohm": 50.0,
            "frequencies_hz": [stop * index / 128 for index in range(129)]}
