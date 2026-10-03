# SPDX-License-Identifier: Apache-2.0
"""DesignIR exchange boundary for KiCad-Prism and existing clients.

The versioned DesignIR payload is decoded into SPIKE's internal SpiDeR model.
This adapter accepts the versioned v1/v2 exchange contracts, not arbitrary source
PCB files or unversioned dictionaries.
"""
from typing import Any, Mapping

from .contracts import CONTRACT_VERSION, ValidationIssue
from .spider import SPIDER_V2_CONTRACT, SpiDeR, SpiDeRV2


def from_designir(payload: Mapping[str, Any]) -> SpiDeR | SpiDeRV2:
    """Decode a versioned DesignIR payload into SpiDeR."""
    if payload.get("contract") == CONTRACT_VERSION:
        values = dict(payload)
        values["issues"] = [
            issue if isinstance(issue, ValidationIssue) else ValidationIssue(**issue)
            for issue in values.get("issues", [])
        ]
        return SpiDeR(**values)
    if payload.get("contract") != SPIDER_V2_CONTRACT:
        raise ValueError("Unsupported DesignIR exchange contract")
    return SpiDeRV2.from_dict(payload)


def to_designir(design: SpiDeR | SpiDeRV2) -> dict[str, Any]:
    """Encode SpiDeR using the existing DesignIR exchange contract."""
    return design.to_dict()
