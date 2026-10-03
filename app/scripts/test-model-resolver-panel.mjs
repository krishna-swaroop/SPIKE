// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { importTestTypescript } from "./import-test-typescript.mjs";

const model = await importTestTypescript("modelResolverPanelModel");
const assigned = { id: "u1", ref: "U1", value: "MCU", library: "Package_QFP:LQFP-48", models: [
  { path: "${KICAD9_3DMODEL_DIR}/Package_QFP.3dshapes/LQFP-48.step", offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] },
  { path: "shield.wrl", offset: [0, 0, 2], scale: [1, 1, 1], rotation: [0, 0, 0] },
] };
const unassigned = { id: "r1", ref: "R1", value: "10k", library: "Resistor_SMD:R_0603_1608Metric" };
assert.deepEqual(model.componentModelPaths(assigned), ["${KICAD9_3DMODEL_DIR}/Package_QFP.3dshapes/LQFP-48.step", "shield.wrl"]);
assert.equal(model.componentNeedsModel(unassigned), true);
assert.equal(model.resolverComponents({ components: [assigned, unassigned] })[0].ref, "R1", "unassigned components are prominent");
assert.deepEqual(model.parseModelCandidates([{ path: "x.step", name: "X", exact: true, confidence: .95 }, { nope: true }]), [
  { path: "x.step", name: "X", format: undefined, root: undefined, reason: undefined, confidence: .95, exact: true },
]);
assert.deepEqual(model.parseModelLibraryResult({ contract: "model_library/v1", models: [{ path: "x.step", name: "X" }], index: { model_count: 12, roots: ["C:/models"], updated_at: "now" } }), {
  candidates: [{ path: "x.step", name: "X", format: undefined, root: undefined, reason: undefined, confidence: undefined, exact: undefined }],
  count: 12, roots: ["C:/models"], indexedAt: "now",
});
assert.equal(model.parseModelLibraryResult({ entries: [{ path: "y.wrl" }], asset_count: 4 }).count, 4);
assert.equal(model.candidateCanOverride({ path: "package.step" }), true);
assert.equal(model.candidateCanOverride({ path: "package.glb", format: "glb" }), false);

const appRoot = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(appRoot, "src", "ModelResolverPanel.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const module = { exports: {} };
const require = createRequire(import.meta.url);
new Function("require", "module", "exports", compiled)(name => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return require("react/jsx-runtime");
  if (name === "./modelResolverPanelModel") return model;
  if (name === "./workerBridge") return { runLocalWorker: async () => ({ ok: true, result: {} }) };
  if (name === "./modelResolverPanel.css") return {};
  return require(name);
}, module, module.exports);
const Panel = module.exports.default;
const board = { components: [assigned, unassigned] };
const markup = renderToStaticMarkup(React.createElement(Panel, {
  boards: [{ id: "occurrence-a", name: "Controller board occurrence with a long retained name", board }],
  onApplied: async () => {}, onClose() {},
}));
assert.match(markup, /Resolve component models/);
assert.match(markup, /Controller board occurrence with a long retained name/);
assert.match(markup, /R1 · 10k · unassigned/);
assert.match(markup, /No source model assigned/);
assert.match(markup, /Board design/);
assert.match(markup, /applies to every occurrence of that design/);
assert.match(markup, /visible body alone does not verify placement/);
assert.match(markup, /Custom model library root/);
assert.match(markup, /disabled="">Apply selected model/);
const targetMarkup = renderToStaticMarkup(React.createElement(Panel, {
  boards: [{ id: "design-a", name: "Controller", board }, { id: "design-b", name: "Shield", board: { components: [{ ...assigned, ref: "J2" }, unassigned] } }],
  initialBoardId: "design-b", initialComponentRef: "J2", onApplied: async () => {}, onClose() {},
}));
assert.match(targetMarkup, /<option value="design-b" selected="">Shield<\/option>/, "notification repair selects the exact retained design");
assert.match(targetMarkup, /<option value="J2" selected="">/, "notification repair focuses the unresolved component even when unassigned parts sort first");
console.log("Model resolver policies, focused rendering and notification repair targets passed");
