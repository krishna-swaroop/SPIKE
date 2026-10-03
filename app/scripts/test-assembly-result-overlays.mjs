// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const generated = new URL(".test-assemblyResultOverlays.mjs", import.meta.url);
const transpiled = ts.transpileModule(readFileSync(new URL("src/assemblyResultOverlays.ts", root), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(generated, transpiled);
const { normalizeAssemblyResultOverlays, attachAssemblyResultOverlay } = await import(`${generated}?${Date.now()}`);
// Small deterministic contracts keep this adapter check independent of ignored CAD downloads.
const boardIds = ["uno-r4-minima", "relay-shield"];
const status = { status: "completed", model_status: "experimental", production_qualified: false };
const pi = { ...status, contract: "spike/multiboard-circuit-result/v1", domain: "pi", native_result: { data: { element_power_w: Object.fromEntries(boardIds.map((id, i) => [`element["${id}","load"]`, .4 + i])) } } };
const si = { ...status, contract: "spike/multiboard-circuit-result/v1", domain: "si", node_map: Object.fromEntries(boardIds.map(id => [id, { VCC: id }])), native_result: { data: { frequency_hz: [1e3, 1e6], node_voltage_v: Object.fromEntries(boardIds.map(id => [id, { magnitude: [1,.8] }])) } } };
const thermal = { ...status, contract: "spike/multiboard-thermal-result/v1", nodes: boardIds.map((board_id,i) => ({ board_id, local_node_id: "board", temperature_c: 33 + i * 6 })) };
const em = { ...status, contract: "spike/multiboard-em-result/v1", samples: [{ frequency_hz: 1e6, loops: boardIds.map(board_id => ({ board_id, loop_id: "supply", current_magnitude_a: .05, loss_w: .01 })) }] };
const payloads = [pi, si, thermal, em, { contract: "spike/full-wave-em-result/v1", status: "unsupported" }];
const normalized = normalizeAssemblyResultOverlays(payloads);
assert.deepEqual(normalized.map(row => row.boardOccurrenceId).sort(), ["relay-shield", "uno-r4-minima"]);
for (const row of normalized) for (const metric of row.metrics) if (metric.value !== undefined) assert.ok(Number.isFinite(metric.value));
assert.ok(normalized.every(row => row.provenance.every(item => item.contract && item.modelStatus)));
assert.ok(normalized.flatMap(row => row.metrics).some(metric => metric.kind === "uniform_lumped_temperature" && metric.unit === "degC"));
assert.ok(normalized.flatMap(row => row.metrics).some(metric => metric.kind === "board_power" && metric.unit === "W"));
assert.ok(normalized.flatMap(row => row.metrics).some(metric => metric.kind === "si_channel" && metric.scope.startsWith(`${normalized.find(row => row.metrics.includes(metric)).boardOccurrenceId}:`)));
assert.ok(normalized.flatMap(row => row.metrics).some(metric => metric.kind === "em_loop" && metric.unit === "A"));
assert.equal(normalizeAssemblyResultOverlays([{ ...payloads[2], nodes: [{ board_id: "bad", temperature_c: Number.NaN }] }]).length, 0);
assert.equal(normalizeAssemblyResultOverlays([{ contract: "spike/full-wave-em-result/v1", status: "completed", board_id: "uno-r4-minima", electric_field_v_m: 12 }]).length, 0);

const sameNames = normalizeAssemblyResultOverlays([{ contract: "spike/multiboard-circuit-result/v1", status: "completed", domain: "si", model_status: "experimental", node_map: { a: { VCC: "a" }, b: { VCC: "b" } }, native_result: { data: { frequency_hz: [1], node_voltage_v: { a: { magnitude: [1] }, b: { magnitude: [2] } } } } }]);
assert.deepEqual(sameNames.map(row => row.metrics[0].scope).sort(), ["a:VCC", "b:VCC"]);

const THREE = await import("three");
const occurrence = new THREE.Group();
occurrence.position.set(4, 5, 6);
const visual = { id: "uno-r4-minima", localCenterMm: [5, 5, 0], thicknessMm: 1.6 };
const board = { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };
const overlay = attachAssemblyResultOverlay(occurrence, { sourceParsedBoard: board, visual, summary: normalized.find(row => row.boardOccurrenceId === visual.id) });
assert.equal(overlay.parent, occurrence);
occurrence.updateMatrixWorld(true);
const before = overlay.getWorldPosition(new THREE.Vector3()).clone();
occurrence.position.x += 9;
occurrence.updateMatrixWorld(true);
assert.equal(overlay.getWorldPosition(new THREE.Vector3()).x, before.x + 9);
assert.equal(overlay.getObjectByName("uniform-lumped-board-temperature").userData.spatialField, false);
unlinkSync(generated);
console.log("assembly result overlay checks passed");
