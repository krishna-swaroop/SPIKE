# SPDX-License-Identifier: Apache-2.0
"""Assembly-derived study drafts and manifest-bound study persistence."""
import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from .spider_v2 import AssemblyIRV1
from .multiboard_identity import assembly_physics_digest, canonical_json_digest
from .harness_authoring import validate_harness_connections
from .project_package import ProjectPackageError, read_project, write_spike_package

STUDIES_KEY = "spike.multiboard-studies"
RESULTS = {"pi": "spike/multiboard-circuit-result/v1", "si": "spike/multiboard-circuit-result/v1",
           "thermal": "spike/multiboard-thermal-result/v1", "emi": "spike/multiboard-em-result/v1"}


def physical_assembly(raw):
    value = AssemblyIRV1.from_dict(raw).to_dict()
    value["extensions"].pop(STUDIES_KEY, None)
    return value


def prepare_multiboard_study(raw):
    if not isinstance(raw, dict) or set(raw) != {"assembly", "domain"} or raw["domain"] not in RESULTS:
        raise ValueError("Study draft requires assembly and domain pi, si, thermal, or emi.")
    assembly = AssemblyIRV1.from_dict(raw["assembly"])
    validate_harness_connections(assembly)
    parts = [part for part in assembly.parts if part.part_type != "subassembly" or part.model_id]
    if not assembly.boards or len(assembly.boards) + len(parts) < 2:
        raise ValueError("A coupled study requires a board and another board or physical mechanical part.")
    domain = raw["domain"]
    value = {"assembly": physical_assembly(raw["assembly"])}
    if domain in {"pi", "si"}:
        links = [{"id": h.id, "kind": "harness", "pin_map": h.pin_map} for h in assembly.harnesses]
        links += [{"id": m.id, "kind": "mate", "pin_map": m.data["pin_map"]}
                  for m in assembly.connector_mappings if m.kind == "connector-mate"]
        value.update(contract="spike/multiboard-circuit-request/v1", domain=domain,
                     board_models=[{"board_id": b.id, "elements": []} for b in assembly.boards],
                     link_models=[{"link_id": link["id"], "kind": link["kind"], "pins": [
                         {"source_pin": a, "target_pin": b, "resistance_ohm": None, "inductance_h": None,
                          "contact_a_resistance_ohm": None, "contact_b_resistance_ohm": None,
                          "contact_a_inductance_h": None, "contact_b_inductance_h": None}
                         for a, b in link["pin_map"].items()]} for link in links],
                     ground={"board_id": assembly.boards[0].id, "node": ""},
                     analysis={"mode": "operating_point"} if domain == "pi" else
                              {"mode": "ac", "start_hz": None, "stop_hz": None, "points": 64, "scale": "log"})
        if parts:
            value["part_models"] = [{"part_id": p.id, "elements": []} for p in parts]
        if assembly.electrical_bonds:
            value["electrical_bond_models"] = [{"bond_id": b.id,
                "endpoint_a": _draft_endpoint(b.endpoint_a, assembly, parts, "chassis"),
                "endpoint_b": _draft_endpoint(b.endpoint_b, assembly, parts, "chassis"),
                "resistance_ohm": None, "inductance_h": None} for b in assembly.electrical_bonds]
    elif domain == "thermal":
        value.update(contract="spike/multiboard-thermal-request/v1", ambient_temperature_c=25., mode="steady_state",
                     board_models=[{"board_id": b.id, "elements": [{"id": "board", "power_w": None,
                         "ambient_resistance_c_per_w": None}], "links": []} for b in assembly.boards],
                     contact_models=[{"contact_id": c.id, "from": _draft_endpoint(c.endpoint_a, assembly, parts, "body", "board"),
                         "to": _draft_endpoint(c.endpoint_b, assembly, parts, "body", "board"),
                         "conductance_w_per_k": None} for c in assembly.thermal_contacts])
        if parts:
            value["part_models"] = [{"part_id": p.id, "elements": [{"id": "body", "power_w": None,
                "ambient_resistance_c_per_w": None}], "links": []} for p in parts]
    else:
        owners = [{"board_id": b.id} for b in assembly.boards] + [{"part_id": p.id} for p in parts]
        loop_ids = [next(iter(owner.values())) for owner in owners]
        value.update(contract="spike/multiboard-em-request/v1", frequency_hz=[], connector_models=[],
                     loops=[{"loop_id": loop_id, **owner, "resistance_ohm": None, "self_inductance_h": None,
                             "voltage_real_v": None, "voltage_imag_v": None} for loop_id, owner in zip(loop_ids, owners)],
                     mutual_inductances=[{"loop_a": a, "loop_b": b, "mutual_inductance_h": None}
                         for i, a in enumerate(loop_ids) for b in loop_ids[i+1:]])
    return {"contract": "spike/multiboard-study-draft/v1", "request": value,
            "assembly_digest": assembly_physics_digest(value["assembly"]),
            "missing_properties_require_review": True}


def _draft_endpoint(endpoint, assembly, parts, part_node, board_node=""):
    owners = {item.id for item in [*assembly.boards, *parts]}
    matches = [endpoint] if endpoint in owners else [owner for owner in owners if endpoint.startswith(owner + ":")]
    if len(matches) != 1:
        raise ValueError("Study contact/bond endpoint requires an unambiguous physical occurrence owner.")
    owner = matches[0]
    is_part = owner in {part.id for part in parts}
    return {"part_id" if is_part else "board_id": owner, "node": part_node if is_part else board_node}


def validate_study_result(assembly_raw, domain, request, result):
    if domain not in RESULTS or not isinstance(request, dict):
        raise ValueError("Unknown study domain or invalid request.")
    expected_request = RESULTS[domain].replace("-result/", "-request/")
    if request.get("contract") != expected_request or (domain in {"pi", "si"} and request.get("domain") != domain):
        raise ValueError("Study request contract or domain does not match.")
    # Persist unfinished, structurally valid models. Numerical admission still
    # uses the strict solver contract at execution; blanks are never solved.
    filename = "multiboard-" + ("circuit" if domain in {"pi", "si"} else "em" if domain == "emi" else "thermal") + "-request-v1.schema.json"
    schema = json.loads((Path(__file__).resolve().parents[2] / "schemas" / filename).read_text())
    def draft_schema(value):
        if isinstance(value, list):
            return [draft_schema(item) for item in value]
        if not isinstance(value, dict):
            return value
        value = {key: draft_schema(item) for key, item in value.items() if key not in {"if", "then", "else"}}
        if isinstance(value.get("type"), str) and value["type"] in {"number", "integer"}:
            value["type"] = [value["type"], "null"]
        if "minItems" in value: value["minItems"] = 0
        if "minLength" in value: value["minLength"] = 0
        return value
    # AssemblyIR is validated by its typed constructor above. Replace the
    # external schema reference so draft validation remains entirely offline.
    schema["properties"]["assembly"] = {"type": "object"}
    bound = {**request, "assembly": physical_assembly(assembly_raw)}
    error = next(Draft202012Validator(draft_schema(schema)).iter_errors(bound), None)
    if error:
        raise ValueError(f"Invalid study setup at {list(error.path)}: {error.message}")
    digest = assembly_physics_digest(assembly_raw)
    if result is not None:
        physical_parts = {p.id for p in AssemblyIRV1.from_dict(assembly_raw).parts if p.part_type != "subassembly" or p.model_id}
        owners = request.get("loops", []) if domain == "emi" else request.get("part_models", [])
        modeled_parts = {row["part_id"] for row in owners if isinstance(row, dict) and isinstance(row.get("part_id"), str)}
        if physical_parts != modeled_parts:
            raise ValueError("Saved results require explicit models for every physical mechanical part. Review structure models and rerun.")
        if not isinstance(result, dict) or result.get("contract") != RESULTS[domain] or result.get("assembly_digest") != digest:
            raise ValueError("Results belong to a different physical assembly or result contract.")
        if result.get("production_qualified") is not False or result.get("model_status") not in {"experimental", "approximate"}:
            raise ValueError("Coupled results must retain their unqualified model status.")
        if result.get("status") not in {"completed", "failed", "blocked"}:
            raise ValueError("Invalid coupled result execution status.")
        if result["status"] == "completed":
            if domain == "emi":
                tables = [{row.get("part_id") for row in sample.get("loops", []) if isinstance(row, dict) and "part_id" in row}
                          for sample in result.get("samples", []) if isinstance(sample, dict)]
            else:
                part_field = "part_temperatures_c" if domain == "thermal" else "part_node_map"
                table = result.get(part_field, {})
                tables = [set(table) if isinstance(table, dict) else set()]
            if any(table != physical_parts for table in tables):
                raise ValueError("Completed results omit or misidentify physical mechanical parts. Rerun the assembly study.")
        json.dumps(result, allow_nan=False)
        if domain in {"pi", "si"}:
            if result.get("domain") != domain or not isinstance(result.get("native_result"), dict) or not isinstance(result.get("node_map"), dict):
                raise ValueError("Circuit result requires its domain, native result and occurrence node map.")
            if any(not isinstance(nodes, dict) or any(not isinstance(node, str) for node in nodes.values()) for nodes in result["node_map"].values()):
                raise ValueError("Malformed circuit result node map.")
            part_map = result.get("part_node_map", {})
            if not isinstance(part_map, dict) or any(not isinstance(nodes, dict) or any(not isinstance(node, str) for node in nodes.values()) for nodes in part_map.values()):
                raise ValueError("Malformed mechanical circuit result node map.")
            data = result["native_result"].get("data", {})
            if not isinstance(data, dict) or not isinstance(data.get("node_voltage_v", {}), dict) or not isinstance(data.get("frequency_hz", []), list):
                raise ValueError("Malformed circuit result traces.")
        elif domain == "thermal":
            for temperatures in (result.get("board_temperatures_c"), result.get("part_temperatures_c", {})):
                if not isinstance(temperatures, dict) or any(not isinstance(nodes, dict) or any(type(value) not in (float, int) for value in nodes.values()) for nodes in temperatures.values()):
                    raise ValueError("Malformed thermal result temperature table.")
        else:
            samples = result.get("samples")
            if not isinstance(samples, list) or not samples or len(samples) > 4096:
                raise ValueError("Malformed EM frequency samples.")
            for sample in samples:
                if not isinstance(sample, dict) or type(sample.get("frequency_hz")) not in (int, float) or not isinstance(sample.get("loops"), list):
                    raise ValueError("Malformed EM loop sample.")
                for loop in sample["loops"]:
                    if not isinstance(loop, dict) or not isinstance(loop.get("loop_id"), str) or (isinstance(loop.get("board_id"), str) == isinstance(loop.get("part_id"), str)) or type(loop.get("current_magnitude_a")) not in (int, float):
                        raise ValueError("Malformed EM current table.")
        if result.get("request_digest") != canonical_json_digest(bound):
            raise ValueError("The setup changed after execution; rerun before retaining these results.")
    return digest


def save_multiboard_study_in_project(params, *, application_version):
    required = {"project_path", "expected_manifest_payload_sha256", "domain", "request", "result", "assembly_digest"}
    if not isinstance(params, dict) or set(params) != required:
        raise ProjectPackageError("Study save requires exact project identity, domain, request, result, and assembly digest.")
    encoded = json.dumps(params, allow_nan=False).encode()
    if len(encoded) > 8 * 1024**2:
        raise ProjectPackageError("Study save exceeds 8 MiB.")
    path = Path(params["project_path"])
    opened = read_project(path, include_members=True)
    if opened.migrated or opened.manifest.get("manifest_payload_sha256") != params["expected_manifest_payload_sha256"]:
        raise ProjectPackageError("Project changed or requires upgrade; reopen before saving the study.")
    payload = copy.deepcopy(opened.payload)
    assembly = payload.get("assembly_ir")
    if not assembly or assembly_physics_digest(assembly) != params["assembly_digest"]:
        raise ProjectPackageError("Assembly changed since this study was prepared.")
    request = copy.deepcopy(params["request"])
    request.pop("assembly", None)
    validate_study_result(assembly, params["domain"], request, params["result"])
    assembly.setdefault("extensions", {}).setdefault(STUDIES_KEY, {})[params["domain"]] = {
        "assembly_digest": params["assembly_digest"], "request": request, "result": params["result"]}
    payload.setdefault("audit", []).append({"event": "multiboard_study_saved", "domain": params["domain"],
        "assembly_digest": params["assembly_digest"], "has_results": params["result"] is not None})
    from .service_project_persistence import prepare_persistent_state
    payload, members = prepare_persistent_state(payload, None, opened.members)
    manifest = write_spike_package(path, payload, profile=opened.manifest["profile"],
                                   preserved_members=members, application_version=application_version)
    return {"contract": "spike/multiboard-study-save-result/v1", "manifest": manifest, "project_path": str(path.resolve())}
