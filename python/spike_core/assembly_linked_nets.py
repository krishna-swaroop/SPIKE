# SPDX-License-Identifier: Apache-2.0
"""Occurrence-aware net traversal through explicitly retained connector pins."""
from collections import defaultdict
from .spider_v2 import AssemblyIRV1
from .harness_authoring import validate_harness_connections


def linked_assembly_nets(raw):
    if not isinstance(raw, dict) or set(raw) != {"assembly", "designs", "board_id", "net_id"}:
        raise ValueError("Linked selection requires assembly, designs, board_id and net_id.")
    assembly = AssemblyIRV1.from_dict(raw["assembly"])
    validate_harness_connections(assembly)
    if not isinstance(raw["designs"], dict) or len(raw["designs"]) > 30:
        raise ValueError("Retain a bounded mapping of assembly designs.")
    nets, pin_nets = {}, {}
    for board in assembly.boards:
        design = raw["designs"].get(board.design_id)
        if not isinstance(design, dict): raise ValueError("Retain every board design for linked net selection.")
        nets[board.id] = {n["id"]: n.get("name", n["id"]) for n in design.get("nets", [])}
    for mapping in assembly.connector_mappings:
        data = mapping.data
        board, connector = data.get("board_id"), data.get("connector_id")
        if board not in nets or not connector or not isinstance(data.get("pins"), dict): continue
        for pin, value in data["pins"].items():
            matches = [value] if value in nets[board] else [identity for identity, name in nets[board].items() if name == value]
            if len(matches) == 1: pin_nets[(board, connector, pin)] = (board, matches[0])
    adjacent = defaultdict(set)
    links = [(h.endpoint_a, h.endpoint_b, h.pin_map) for h in assembly.harnesses]
    links += [(m.data["endpoint_a"], m.data["endpoint_b"], m.data["pin_map"])
              for m in assembly.connector_mappings if m.kind == "connector-mate"]
    unresolved = []
    for a, b, pins in links:
        left = tuple(a.split("::" if "::" in a else ":", 1)); right = tuple(b.split("::" if "::" in b else ":", 1))
        for pa, pb in pins.items():
            na, nb = pin_nets.get((*left, pa)), pin_nets.get((*right, pb))
            if na is None or nb is None:
                unresolved.append({"endpoint_a": a, "pin_a": pa, "endpoint_b": b, "pin_b": pb})
                continue
            adjacent[na].add(nb); adjacent[nb].add(na)
    seed = (raw["board_id"], raw["net_id"])
    if seed[0] not in nets or seed[1] not in nets[seed[0]]: raise ValueError("Selection must identify a retained occurrence and canonical net ID.")
    seen, pending = set(), [seed]
    while pending:
        node = pending.pop()
        if node not in seen:
            seen.add(node); pending.extend(adjacent[node] - seen)
    return {"contract": "spike/assembly-linked-net-selection/v1", "nodes": [
        {"board_id": board, "net_id": net, "net_name": nets[board][net]} for board, net in sorted(seen)],
        "unresolved_pin_links": unresolved, "electrical_solver_executed": False}
