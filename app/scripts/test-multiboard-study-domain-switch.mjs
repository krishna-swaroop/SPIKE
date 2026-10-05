// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { importTestTypescript } from "./import-test-typescript.mjs";

const require = createRequire(import.meta.url);
const presentation = await importTestTypescript("multiboardStudyPresentation");
const tableModule = { exports: {} };
const tableCode = ts.transpileModule(readFileSync(new URL("../src/CoupledStudyResultTables.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function("require", "module", "exports", tableCode)(name => name === "./DataTable" ? { default: "table" }
  : name === "./AssemblyMechanicalStudyModels" ? { studyOwnerName: (_assembly, row) => row.board_id ?? row.part_id }
    : name === "./multiboardStudyPresentation" ? presentation : name.endsWith(".css") ? {} : require(name), tableModule, tableModule.exports);
const circuit = domain => ({ contract: "spike/multiboard-circuit-request/v1", domain,
  ground: { board_id: "uno", node: "J1:2" }, analysis: domain === "si" ? { mode: "ac", start_hz: 1e3, stop_hz: 1e6, points: 5 } : { mode: "operating_point" },
  board_models: [{ board_id: "uno", elements: [] }, { board_id: "shield", elements: [] }], link_models: [] });
const thermal = { contract: "spike/multiboard-thermal-request/v1", mode: "steady_state", ambient_temperature_c: 25,
  board_models: [{ board_id: "uno", elements: [{ id: "board", power_w: .35, ambient_resistance_c_per_w: 18, thermal_capacitance_j_per_c: 18 }], links: [] },
    { board_id: "shield", elements: [{ id: "board", power_w: 1, ambient_resistance_c_per_w: 22, thermal_capacitance_j_per_c: 12 }], links: [] }],
  contact_models: [{ contact_id: "stacked-headers", from: { board_id: "uno", node: "board" }, to: { board_id: "shield", node: "board" }, conductance_w_per_k: .025 }],
  radiation_surfaces: [{ id: "uno-facing", board_id: "uno", node: "board", area_mm2: 3658, emissivity: .85, view_factors: { "shield-facing": .55, ambient: .45 } },
    { id: "shield-facing", board_id: "shield", node: "board", area_mm2: 3658, emissivity: .85, view_factors: { "uno-facing": .55, ambient: .45 } }] };
const assembly = { boards: [{ id: "uno", name: "Arduino UNO R4 Minima" }, { id: "shield", name: "Arduino 4 Relays Shield" }], parts: [],
  extensions: { "spike.multiboard-studies": {
    pi: { assembly_digest: "fixture", request: circuit("pi"), result: { status: "completed", model_status: "experimental", production_qualified: false, analysis: { mode: "operating_point" },
      node_map: { shield: { "J1:1": "private-node" } }, element_map: { shield: { load: "private-element" } },
      native_result: { data: { node_voltage_v: { "private-node": 4.99 }, element_current_a: { "private-element": .2 }, element_power_w: { "private-element": .998 } } } } },
    si: { assembly_digest: "fixture", request: circuit("si") },
    thermal: { assembly_digest: "fixture", request: thermal },
  } } };

let slots = [], cursor = 0, queuedEffects = [];
const hooks = {
  useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }]; },
  useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
  useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) { const previous = slots[i]; slots[i] = { deps }; queuedEffects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
};
const worker = async operation => operation.method === "prepare_multiboard_study"
  ? { ok: true, result: { request: { ...({ pi: circuit("pi"), si: circuit("si"), thermal }[operation.params.request.domain]), assembly }, assembly_digest: "fixture" } }
  : { ok: true, result: {} };
const source = readFileSync(new URL("../src/MultiboardStudyEditor.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => name === "react" ? hooks
  : name === "./CoupledStudyResultTables" ? tableModule.exports
  : name === "./DataTable" ? { default: "table" }
    : name === "./AssemblyMechanicalStudyModels" ? { default: () => null, studyOwnerName: (_assembly, row) => row.board_id ?? row.part_id }
      : name === "./workerBridge" ? { runLocalWorker: worker, runNativeProjectWorker: worker, openNativeTextFile: async () => null, saveNativeTextFile: async () => undefined }
        : name === "./multiboardStudyPresentation" ? presentation : name.endsWith(".css") ? {} : require(name), module, module.exports);
const props = { assembly, projectPath: "fixture.spike", manifestDigest: "a".repeat(64), disabled: false, onUpdated: async () => {}, onStatus: () => {} };
let tree;
function render() { cursor = 0; tree = module.exports.default(props); const effects = queuedEffects; queuedEffects = []; effects.forEach(effect => effect()); return tree; }
async function settle() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
function nodes(value) { return !value || typeof value !== "object" ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(nodes)]; }
const studySelector = () => nodes(tree).find(node => node.type === "select" && node.props.value && ["pi", "si", "thermal", "emi"].includes(node.props.value));

render(); await settle();
assert.equal(studySelector().props.value, "pi");
let markup = renderToStaticMarkup(tree);
assert.match(markup, /PI results/);
assert.match(markup, /0.998/);
assert.match(markup, /Element currents and power/);
assert.doesNotMatch(markup, /private-element|private-node/, "result tables display local node/element names, not backend identities");
assert.ok(markup.indexOf('aria-label="Coupled study results"') < markup.indexOf('<fieldset'), "saved results appear before the long setup forms");
const acElement = { status: "completed", analysis: { mode: "ac" }, element_map: { shield: { load: "id" } }, native_result: { data: {
  element_current_a: { id: { real: [1, 2], imaginary: [-.1, -.2] } }, element_complex_power_va: { id: { real: [3, 4], imaginary: [.3, .4] } },
} } };
assert.deepEqual(presentation.studyElementResultRows(acElement, 1).map(row => [row.quantity, row.value, row.unit]),
  [["Current, real", 2, "A RMS"], ["Current, imaginary", -.2, "A RMS"], ["Active power", 4, "W"], ["Reactive power", .4, "var"]]);
assert.deepEqual(presentation.studyElementResultRows(acElement, 2), [], "missing sweep points never become fabricated zeros");
assert.deepEqual(presentation.studyElementResultRows({ ...acElement, status: "failed" }), [], "failed results expose no active element quantities");
studySelector().props.onChange({ target: { value: "si" } });
assert.doesNotThrow(render, "PI to SI retires the previous retained draft before rendering the new domain");
await settle();
assert.equal(studySelector().props.value, "si");
studySelector().props.onChange({ target: { value: "thermal" } });
assert.doesNotThrow(render, "SI to thermal never renders the circuit draft as a thermal request");
await settle();
assert.equal(studySelector().props.value, "thermal");
assert.match(renderToStaticMarkup(tree), /Contact conductance \(W\/K\)/, "retained thermal contact renders after admission");
assert.match(JSON.stringify(thermal), /radiation_surfaces/, "retained fixture includes the installed curated radiation shape");
console.log("Retained coupled PI, SI and thermal domain switching renders without stale cross-domain drafts");
