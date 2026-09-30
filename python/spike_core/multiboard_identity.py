# SPDX-License-Identifier: Apache-2.0
"""Stable physical assembly identity independent of retained study outputs."""
import hashlib
import json
from .spider_v2 import AssemblyIRV1


def assembly_physics_digest(raw):
    assembly = AssemblyIRV1.from_dict(raw).to_dict()
    assembly.get("extensions", {}).pop("spike.multiboard-studies", None)
    return hashlib.sha256(json.dumps(assembly, sort_keys=True, separators=(",", ":"),
                                    allow_nan=False).encode()).hexdigest()
