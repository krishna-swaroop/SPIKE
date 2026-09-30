# SPDX-License-Identifier: Apache-2.0
"""Occurrence-bound coupled board RC networks; no geometry-derived heat paths."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Mapping

from .spider_v2 import AssemblyIRV1
from .multiboard_identity import assembly_physics_digest
from .thermal import ThermalScenario
from .thermal_network import MAX_NETWORK_NODES, MAX_TRANSIENT_STEPS, estimate_lumped_thermal_network

REQUEST_CONTRACT = "spike/multiboard-thermal-request/v1"
RESULT_CONTRACT = "spike/multiboard-thermal-result/v1"
MAX_LINKS = 8192
MAX_DENSE_WORK = 50_000_000


class MultiboardThermalError(ValueError):
    """Invalid identity, physical parameters, or unsupported network size."""


def _number(value: Any, label: str, *, positive: bool = False, nonnegative: bool = False) -> float:
    if isinstance(value, bool):
        raise MultiboardThermalError(f"{label} must be a finite number.")
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise MultiboardThermalError(f"{label} must be a finite number.") from exc
    if not math.isfinite(result) or (positive and result <= 0) or (nonnegative and result < 0):
        raise MultiboardThermalError(f"{label} is outside its finite physical range.")
    return result


def _array(value: Any, label: str) -> list[Mapping[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(item, Mapping) for item in value):
        raise MultiboardThermalError(f"{label} must be an array of objects.")
    return value


def _id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise MultiboardThermalError(f"{label} needs a nonempty string of at most 256 characters.")
    return value


def run_multiboard_thermal(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Solve C dT/dt + K(T-Tambient) = P with explicit inter-board contacts.

    Local node IDs are encoded as JSON pairs to prevent delimiter collisions.
    Conductance is W/K, power W, capacitance J/K, time seconds, temperature C.
    Every contact is reciprocal and passive. Backward Euler uses the existing
    thermal-network kernel, and output remains an approximate RC precheck.
    """
    if not isinstance(raw, Mapping) or raw.get("contract") != REQUEST_CONTRACT:
        raise MultiboardThermalError(f"contract must be {REQUEST_CONTRACT}.")
    if set(raw) - {"contract", "assembly", "board_models", "contact_models", "ambient_temperature_c", "mode", "time_step_s", "duration_s"}:
        raise MultiboardThermalError("Unexpected coupled thermal request fields.")
    if not isinstance(raw.get("assembly"), Mapping):
        raise MultiboardThermalError("assembly must be an AssemblyIR object.")
    try:
        assembly = AssemblyIRV1.from_dict(raw["assembly"])
    except (ValueError, TypeError, AttributeError) as exc:
        raise MultiboardThermalError(f"Invalid assembly: {exc}") from exc
    boards = {item.id for item in assembly.boards}
    if len(boards) < 2:
        raise MultiboardThermalError("Coupled thermal analysis requires at least two boards.")
    mode = raw.get("mode", "steady_state")
    if not isinstance(mode, str) or mode not in {"steady_state", "transient"}:
        raise MultiboardThermalError("mode must be steady_state or transient.")
    ambient = _number(raw.get("ambient_temperature_c", 25), "ambient_temperature_c")
    if ambient < -273.15:
        raise MultiboardThermalError("ambient_temperature_c is below absolute zero.")
    models = _array(raw.get("board_models"), "board_models")
    if any(not isinstance(item.get("board_id"), str) for item in models) or len(models) != len(boards) or {item.get("board_id") for item in models} != boards:
        raise MultiboardThermalError("board_models must cover each retained board occurrence exactly once.")
    elements: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    identity: dict[str, tuple[str, str]] = {}
    namespace = lambda board, node: json.dumps([board, node], separators=(",", ":"), ensure_ascii=True)
    for model in models:
        board = model["board_id"]
        local_elements = _array(model.get("elements"), f"{board}.elements")
        if not local_elements or len(elements) + len(local_elements) > MAX_NETWORK_NODES:
            raise MultiboardThermalError(f"Network requires 1..{MAX_NETWORK_NODES} total nodes, with nodes on every board.")
        local_ids: set[str] = set()
        for source in local_elements:
            node = _id(source.get("id"), "element.id")
            if node == "ambient" or node in local_ids:
                raise MultiboardThermalError("Local node IDs must be unique and cannot be ambient.")
            local_ids.add(node)
            encoded = namespace(board, node)
            item = dict(source, id=encoded, power_w=_number(source.get("power_w", 0), "power_w", nonnegative=True))
            for field in ("ambient_resistance_c_per_w", "thermal_capacitance_j_per_c"):
                if field in source:
                    item[field] = _number(source[field], field, positive=True)
            if "initial_temperature_c" in source:
                item["initial_temperature_c"] = _number(source["initial_temperature_c"], "initial_temperature_c")
                if item["initial_temperature_c"] < -273.15:
                    raise MultiboardThermalError("initial_temperature_c is below absolute zero.")
            identity[encoded] = (board, node)
            elements.append(item)
        local_link_ids: set[str] = set()
        for offset, source in enumerate(_array(model.get("links", []), f"{board}.links")):
            link_id = _id(source.get("id", f"link-{offset}"), "link.id")
            if link_id in local_link_ids:
                raise MultiboardThermalError("Local link IDs must be unique.")
            local_link_ids.add(link_id)
            item = dict(source, id=namespace(board, link_id))
            if "enabled" in source and not isinstance(source["enabled"], bool):
                raise MultiboardThermalError("link.enabled must be a boolean.")
            for field in ("from_id", "to_id"):
                endpoint = source.get(field)
                if not isinstance(endpoint, str) or (endpoint != "ambient" and endpoint not in local_ids):
                    raise MultiboardThermalError(f"{board}.{link_id} references an unknown local node.")
                item[field] = "ambient" if endpoint == "ambient" else namespace(board, endpoint)
            if item["from_id"] == item["to_id"]:
                raise MultiboardThermalError("Thermal links cannot connect a node to itself.")
            for field in ("resistance_c_per_w", "conductance_w_per_k", "conductivity_w_mk", "thermal_conductivity_w_mk", "contact_area_mm2", "thickness_mm"):
                if field in source:
                    item[field] = _number(source[field], field, positive=True)
            links.append(item)
    contacts = {item.id: item for item in assembly.thermal_contacts}
    contact_models = _array(raw.get("contact_models", []), "contact_models")
    if any(not isinstance(item.get("contact_id"), str) for item in contact_models) or len(contact_models) != len(contacts) or {item.get("contact_id") for item in contact_models} != set(contacts):
        raise MultiboardThermalError("contact_models must cover every retained thermal contact exactly once.")
    contact_links = []
    for model in contact_models:
        contact = contacts[model["contact_id"]]
        endpoints = []
        for field, retained in (("from", contact.endpoint_a), ("to", contact.endpoint_b)):
            endpoint = model.get(field)
            if not isinstance(endpoint, Mapping):
                raise MultiboardThermalError("Contact endpoints require board_id and node.")
            board, node = endpoint.get("board_id"), endpoint.get("node")
            if not isinstance(board, str) or board not in boards or not isinstance(node, str) or namespace(board, node) not in identity:
                raise MultiboardThermalError("Contact references an unknown board occurrence or node.")
            if retained != board and not retained.startswith(board + ":"):
                raise MultiboardThermalError("Contact model endpoints must agree with retained assembly contact endpoints.")
            endpoints.append(namespace(board, node))
        if model["from"]["board_id"] == model["to"]["board_id"]:
            raise MultiboardThermalError("Inter-board contact must connect different board occurrences.")
        conductance = _number(model.get("conductance_w_per_k"), "conductance_w_per_k", positive=True)
        contact_links.append({"id": "contact:" + contact.id, "from_id": endpoints[0], "to_id": endpoints[1], "conductance_w_per_k": conductance})
    if not contact_links:
        raise MultiboardThermalError("Coupled thermal analysis needs at least one retained inter-board contact.")
    links.extend(contact_links)
    if len(links) > MAX_LINKS:
        raise MultiboardThermalError(f"Network supports at most {MAX_LINKS} links.")
    run = {}
    if mode == "transient":
        duration = _number(raw.get("duration_s"), "duration_s", positive=True)
        step = _number(raw.get("time_step_s"), "time_step_s", positive=True)
        ratio = duration / step
        if not math.isfinite(ratio) or ratio > MAX_TRANSIENT_STEPS:
            raise MultiboardThermalError(f"Transient supports at most {MAX_TRANSIENT_STEPS} steps.")
        count = max(1, math.ceil(ratio))
        if count * len(elements) ** 3 > MAX_DENSE_WORK:
            raise MultiboardThermalError("Transient exceeds the bounded dense solve work limit; reduce nodes or steps.")
        run = {"end_time_s": duration, "write_interval_s": step}
    scenario = ThermalScenario(scenario_id="multiboard:" + assembly.assembly_id, mode=mode, ambient_temperature_c=ambient,
                               thermal_elements=elements, thermal_links=links, run=run)
    try:
        result = estimate_lumped_thermal_network(scenario)
    except (ValueError, OverflowError, ZeroDivisionError) as exc:
        raise MultiboardThermalError(f"Thermal system could not be solved: {exc}") from exc
    result["contract"] = RESULT_CONTRACT
    result["assembly_id"] = assembly.assembly_id
    result["assembly_digest"] = assembly_physics_digest(raw["assembly"])
    result["production_qualified"] = False
    result["coupled_physics"] = True
    result["coupling_model"] = "explicit_reciprocal_board_rc_network"
    result["board_temperatures_c"] = {}
    if result["status"] == "completed":
        steady = {item["id"]: item["steady_temperature_c"] for item in result["nodes"]}
        final = result["transient"][-1]["temperatures_c"] if result["transient"] else steady
        residual = {item["id"]: item["power_w"] for item in result["nodes"]}
        ambient_flow = 0.0
        for link in result["links"]:
            left, right = link["from_id"], link["to_id"]
            flow = link["conductance_w_per_k"] * (steady[left] - (ambient if right == "ambient" else steady[right]))
            residual[left] -= flow
            if right != "ambient":
                residual[right] += flow
            else:
                ambient_flow += flow
        for item in result["nodes"]:
            board, node = identity[item["id"]]
            item.update(board_id=board, local_node_id=node, temperature_c=final[item["id"]])
            result["board_temperatures_c"].setdefault(board, {})[node] = item["temperature_c"]
        result["contact_heat_flows"] = [{"contact_id": model["contact_id"], "from": dict(model["from"]), "to": dict(model["to"]),
            "conductance_w_per_k": link["conductance_w_per_k"],
            "steady_heat_flow_w": link["conductance_w_per_k"] * (steady[link["from_id"]] - steady[link["to_id"]]),
            "heat_flow_w": link["conductance_w_per_k"] * (final[link["from_id"]] - final[link["to_id"]])}
            for model, link in zip(contact_models, contact_links)]
        result["summary"].update(ambient_heat_flow_w=ambient_flow, energy_balance_residual_w=sum(item["power_w"] for item in result["nodes"]) - ambient_flow,
                                 max_node_residual_w=max(abs(value) for value in residual.values()))
        tolerance = 1e-8 * max(1.0, result["summary"]["total_power_w"])
        if result["summary"]["max_node_residual_w"] > tolerance:
            raise MultiboardThermalError("Thermal solution failed its node energy conservation tolerance; check conditioning and parameter scales.")
    else:
        result["coupled_physics"] = False
        result["contact_heat_flows"] = []
    result["provenance"].update(board_occurrence_ids=sorted(boards), contact_ids=sorted(contacts),
        assumptions=["Constant explicit board RC properties and contact conductances", "Shared fixed ambient", "No geometry extraction, airflow or inter-board radiation", "Power input includes only explicitly supplied node dissipation"])
    try:
        normalized = json.dumps(raw, sort_keys=True, separators=(",", ":"), allow_nan=False)
        json.dumps(result, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise MultiboardThermalError("Inputs and results must be finite JSON data.") from exc
    result["request_digest"] = hashlib.sha256(normalized.encode()).hexdigest()
    result["provenance"]["request_sha256"] = result["request_digest"]
    return result
