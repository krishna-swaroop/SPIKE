import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/TetraMeshPanel.tsx", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/focusedMesh.ts", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../../examples/pcb_focus_mesh/whole_board.json", import.meta.url), "utf8"));
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const helperModule = { exports: {} };
new Function("require", "module", "exports", compile(helperSource))(require, helperModule, helperModule.exports);
const helper = helperModule.exports;

let initialText;
let stateIndex = 0;
const fakeReact = {
  ...React,
  useEffect() {},
  useMemo(factory) { return factory(); },
  useRef: initial => ({ current: initial }),
  useState(initial) {
    const value = stateIndex++ === 0 && initialText !== undefined ? initialText : typeof initial === "function" ? initial() : initial;
    return [value, () => {}];
  },
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const uiModule = { exports: {} };
new Function("require", "module", "exports", compiled)(name => {
  if (name === "react") return fakeReact;
  if (name === "./focusedMesh") return helper;
  if (name === "./workerBridge") return { cancelLocalWorker() {}, cancelLocalWorkerCleanup() {}, openNativeTextFile() {}, runLocalWorker() {}, saveNativeTextFile() {} };
  return require(name);
}, uiModule, uiModule.exports);

const render = text => { initialText = text; stateIndex = 0; return renderToStaticMarkup(uiModule.exports.default({ onClose() {}, onStatus() {} })); };
const explicitHtml = render(undefined);
assert.match(explicitHtml, /WHOLE-BOARD TETRAHEDRAL MESH/);
assert.match(explicitHtml, /Generate explicit mesh/);
assert.match(explicitHtml, /does not attach the mesh to an SI, EM, or thermal solver/);
assert.doesNotMatch(explicitHtml, /pinned local CPython|development-only/i);

const focused = helper.validateFocusedPcbMeshRequest(fixture);
const inventory = helper.focusedMeshInventory(focused);
assert.deepEqual(inventory.nets, ["GND", "OTHER", "SIG"]);
assert.equal(inventory.sources.length, fixture.model.copper.length + fixture.model.vias.length);
const focusedHtml = render(JSON.stringify(fixture));
assert.match(focusedHtml, /Focus selection/);
assert.match(focusedHtml, /Coarse background/);
assert.match(focusedHtml, /Source traces and vias/);
assert.match(focusedHtml, /Add manual region/);
assert.match(focusedHtml, /Prepare whole-board mesh/);
assert.match(focusedHtml, /Generate prepared mesh/);

const manualOnly = helper.updateFocusedSizing(focused, { net_names: [], source_ids: [], regions: [{ id: "box", bounds_mm: [[0, 0, 0], [1, 2, 1]], target_size_mm: 0.25 }] });
assert.equal(helper.validateFocusedPcbMeshRequest(manualOnly).sizing.regions[0].id, "box");
assert.throws(() => helper.validateFocusedPcbMeshRequest(helper.updateFocusedSizing(focused, { net_names: ["UNKNOWN"] })), /unknown net or source/);
assert.throws(() => helper.validateFocusedPcbMeshRequest(helper.updateFocusedSizing(focused, { net_names: [], source_ids: [], regions: [] })), /Select at least one/);
const feedback = helper.focusedMeshFeedback({ whole_model_retained: true, mesh: { object_map: { a: {}, b: {} } }, metrics: { cad_volume_mm3: 10, tetrahedron_volume_mm3: 9.9, minimum_mean_ratio_quality: 0.42, source_cad_volumes_mm3: { a: 1, b: 2 } }, focus_assessment: { counts: { near_focus: 4, far_field: 6, above_target: 1 }, maximum_edge_to_target_ratio: 1.2 } });
assert.equal(feedback.wholeModelRetained, true);
assert.equal(feedback.coveredSources, 2);
assert.ok(Math.abs(feedback.volumeError - 0.01) < 1e-12);
assert.match(source, /disabled=\{busy\} value=\{text\}/);
assert.match(source, /Unverified imported claim/);
assert.match(source, /saveNativeTextFile\([\s\S]*?\.catch\(caught => setError/);
assert.match(source, /method: "prepare_pcb_volume_mesh"/);
assert.match(source, /method: "generate_tetrahedral_mesh"/);
assert.match(source, /timeout_s: 180, memory_limit_mb: 2048/);
assert.match(source, /counts\.vertices !== mesh\.vertices\.length/);
assert.match(source, /64 MiB UI exchange limit/);
assert.throws(() => uiModule.exports.parseTetraMeshRequest(JSON.stringify({ contract: "spike/gmsh-occ-mesh/v1", solids: [], mesh: {} })), /1–64 explicit solids/);
assert.equal(uiModule.exports.parseTetraMeshRequest(JSON.stringify(fixture)).contract, "spike/pcb-volume-mesh-request/v1");
console.log("Whole-board focused and explicit tetrahedral mesh controls validate, render, and report coverage evidence.");

const boundedResult = { contract: "spike/gmsh-occ-mesh-result/v2", mesh: { contract: "spike/solver-mesh/v1", vertices: Array(4).fill({}), cells: Array(4).fill({}), counts: { vertices: 4, cells: 4 } } };
assert.equal(uiModule.exports.normalizeTetraMeshResult(boundedResult).contract, "spike/gmsh-occ-mesh-result/v2");
assert.throws(() => uiModule.exports.normalizeTetraMeshResult({ ...boundedResult, contract: "spike/gmsh-occ-mesh-result/v99" }), /Expected/);
