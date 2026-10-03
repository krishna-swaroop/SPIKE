"""Presentation adapter for the native experiment and the shared SPIKE worker.

The native client retains canonical v2 designs. Existing v1 worker operations
use the authoritative SpiDeRV2 projection instead of a second C++ conversion.
All parsing, validation, solver admission and package writing remain shared.
"""
from __future__ import annotations

from python.spike_core import service
from python.spike_core.spider_v2 import SpiDeRV2


def handle(request: dict) -> dict:
    params = request.get("params")
    if request.get("method") == "validate_design" and isinstance(params, dict):
        design = params.get("design")
        if isinstance(design, dict) and design.get("contract") == "spike/design-ir/v2":
            params = {**params, "design": SpiDeRV2.from_dict(design).to_v1().to_dict()}
            request = {**request, "params": params}
    return service.handle(request)


if __name__ == "__main__":
    raise SystemExit(service.serve_json_lines(handle, service.__version__))
