# SPDX-License-Identifier: Apache-2.0
"""Small deterministic JSON-lines worker used by the native bridge harness."""

from __future__ import annotations

import json
import sys
import time


for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "hang":
        time.sleep(30)
        continue
    if method == "crash":
        raise SystemExit(23)
    if method == "malformed":
        sys.stdout.write("not-json\n")
        sys.stdout.flush()
        continue
    response = {
        "id": request.get("id"),
        "ok": True,
        "result": {"method": method},
        "meta": {"contract": "spike/worker-response-meta/v1"},
    }
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()
