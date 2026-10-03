// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { demoLayers, binding } from "../demo/fixture";
import { parseVirtualLayers, validateVirtualLayers, VIRTUAL_DATA_LIMITS } from "../src/overlays/validation";
import { layerFromScalarSamples } from "../src/adapters/spike";

test("all primitive types round-trip with provenance, frames and missing data intact", () => {
  const source = demoLayers();
  assert.deepEqual(parseVirtualLayers(JSON.stringify(source), binding), source);
  assert.equal(validateVirtualLayers(source, binding), source);
});
test("data bound to another board or stale revision cannot render", () => {
  for (const b of [{ ...binding, boardId: "another" }, { ...binding, revision: "stale" }]) {
    assert.throws(() => validateVirtualLayers(demoLayers(), b), /identity\/revision mismatch/);
  }
});
test("reject malformed values, topology, identities, units and unknown primitives", () => {
  const mutate = (change: (layers: any[]) => void, expected: RegExp) => { const data = demoLayers(); change(data); assert.throws(() => validateVirtualLayers(data, binding), expected); };
  mutate(data => data[0].frames[0].primitives[0].positionsMm[0][0] = Infinity, /finite/);
  mutate(data => data[0].frames[0].primitives[0].values.pop(), /one value/);
  mutate(data => data[0].frames[0].primitives[0].values[0] = NaN, /finite/);
  mutate(data => data[2].frames[0].primitives[0].triangles[0] = [0,1,99], /vertex indices/);
  mutate(data => data[1].id = data[0].id, /duplicate ID/);
  mutate(data => data[0].unit = null, /text/);
  mutate(data => data[0].frames[0].primitives[0].kind = "volume", /unsupported primitive/);
  mutate(data => data[0].range = [2,1], /range/);
  mutate(data => data[0].opacity = 1.1, /finite/);
  mutate(data => data[0].provenance.status = "assumed-valid", /unknown provenance/);
  mutate(data => data[0].frames[0].primitives[0].color = "url(https://example.invalid)", /color/);
});
test("aggregate budgets include hidden layers and every frame", () => {
  const data = demoLayers().slice(0,1);
  const p = data[0].frames[0].primitives[0];
  p.positionsMm = Array.from({ length: 17000 }, () => [0,0,0]);
  if ("values" in p) p.values = Array(17000).fill(1);
  data[0].frames = [0,1,2].map(i => ({ id: String(i), label: String(i), primitives: [p] }));
  data[0].visible = false;
  assert.throws(() => validateVirtualLayers(data, binding), /aggregate vertex budget/);
  assert.throws(() => parseVirtualLayers(" ".repeat(VIRTUAL_DATA_LIMITS.jsonBytes+1), binding), /exceeds 16 MiB/);
});
test("scalar adapter preserves values and source status and requires an explicit missing z plane", () => {
  const options = { id: "source", label: "Imported field", binding, quantity: "Custom quantity", unit: "mV", source: "external-study", status: "unvalidated" as const };
  assert.throws(() => layerFromScalarSamples([{ x_mm: 10, y_mm: 20, value: 4 }], options), /explicit defaultZMm/);
  const layer = layerFromScalarSamples([{ x_mm: 10, y_mm: 20, value: 4 }, { x_mm: 30, y_mm: 40, z_mm: -2, value: -1 }], { ...options, defaultZMm: 1.6 });
  assert.deepEqual(layer.frames[0].primitives[0].positionsMm, [[10,20,1.6],[30,40,-2]]);
  assert.equal(layer.provenance.status, "unvalidated");
  assert.deepEqual((layer.frames[0].primitives[0] as any).values, [4,-1]);
});
