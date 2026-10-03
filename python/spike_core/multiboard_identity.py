# SPDX-License-Identifier: Apache-2.0
"""Stable physical assembly identity independent of retained study outputs."""
import hashlib
import json
import copy
from .spider_v2 import AssemblyIRV1


def _canonical_numbers(value):
    """Remove JSON number spelling differences without rounding geometry.

    JavaScript serializes 1.0 and -0.0 as 1 and 0. Python's JSON encoder
    retains those spellings, so normalize exact integral floats before hashing.
    Keep booleans and nonintegral numbers unchanged.
    """
    if isinstance(value, dict):
        return {key: _canonical_numbers(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_numbers(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_json_digest(value):
    """Hash JSON values using an exact, transport-stable numeric identity."""
    return _json_digest(_canonical_numbers(value))


def _json_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    allow_nan=False).encode()).hexdigest()


def _physical_assembly(raw):
    assembly = AssemblyIRV1.from_dict(raw).to_dict()
    assembly.get("extensions", {}).pop("spike.multiboard-studies", None)
    return assembly


def assembly_physics_digest(raw):
    return canonical_json_digest(_physical_assembly(raw))


def legacy_assembly_physics_digest(raw):
    """Original spelling-sensitive identity, only for verified package migration."""
    return _json_digest(_physical_assembly(raw))


def migrate_legacy_result_assembly_digest(result, original_persisted_assembly):
    """Upgrade bindings only against the authoritative verified package payload.

    Callers must provide the original package assembly and retained study setup
    before browser transport. Never use a UI-supplied assembly as migration
    authority: its original number spellings cannot be recovered reliably.
    Both legacy hashes must match, so changed geometry or setup cannot migrate.
    """
    migrated = copy.deepcopy(result)
    if not isinstance(result, dict):
        return migrated
    contracts = {"spike/multiboard-circuit-result/v1": result.get("domain"),
                 "spike/multiboard-thermal-result/v1": "thermal",
                 "spike/multiboard-em-result/v1": "emi"}
    domain = contracts.get(result.get("contract"))
    if domain not in {"pi", "si", "thermal", "emi"}:
        return migrated
    if result.get("contract") == "spike/multiboard-circuit-result/v1" and domain not in {"pi", "si"}:
        return migrated
    studies = original_persisted_assembly.get("extensions", {}).get("spike.multiboard-studies", {})
    study = studies.get(domain, {})
    request = study.get("request") if isinstance(study, dict) else None
    if not isinstance(request, dict):
        return migrated
    physical = _physical_assembly(original_persisted_assembly)
    bound = {**request, "assembly": physical}
    old_assembly, old_request = _json_digest(physical), _json_digest(bound)
    if result.get("assembly_digest") != old_assembly or result.get("request_digest") != old_request:
        return migrated
    new_assembly, new_request = canonical_json_digest(physical), canonical_json_digest(bound)
    if (old_assembly, old_request) == (new_assembly, new_request):
        return migrated
    migrated.update(assembly_digest=new_assembly, request_digest=new_request)
    migrated["assembly_identity_migration"] = {
        "scheme": "exact-integer-normalization/v1", "from": old_assembly, "to": new_assembly,
        "request_from": old_request, "request_to": new_request}
    if isinstance(migrated.get("provenance"), dict) and migrated["provenance"].get("request_sha256") == old_request:
        migrated["provenance"]["request_sha256"] = new_request
    return migrated
