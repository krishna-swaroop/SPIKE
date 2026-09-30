# SPDX-License-Identifier: Apache-2.0
"""SPIKE Design Reference (SpiDeR), the internal design boundary.

Importers, analysis services, and exporters share these types. Serialized
contract identifiers remain stable for project and DesignIR interoperability.
"""
from .contracts import SpiDeR
from .spider_v2 import SpiDeRV2
from .spider_v2_schema import SPIDER_V2_CONTRACT

__all__ = ["SpiDeR", "SpiDeRV2", "SPIDER_V2_CONTRACT"]
