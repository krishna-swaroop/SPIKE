// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import React from "react";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { importTestTypescript } from "./import-test-typescript.mjs";
const require = createRequire(import.meta.url);
const model = await importTestTypescript("assemblyFieldStudyPresentation");
const assembly = { boards: [{ id: "board:a", name: "Controller" }], parts: [{ id: "part:a", name: "Casing" }], extensions: {} };
const request = { domain: "thermal", assembly, bodies: [] };
const problem = { boundaries: [{ face: { occurrence_id: "board:a", face_id: "outside" }, type: "temperature", temperature_k: 300 }], contacts: [], heat_sources: [] };
const result = { contract: "spike/assembly-field-thermal-result/v1", production_qualified: false, model_status: "experimental", occurrence_temperatures: { "board:a": { minimum_k: 300, maximum_k: 340 }, "part:a": { minimum_k: 360, maximum_k: 400 } }, field_result: { heat_balance: { imbalance_w: 0 } } };
const saved = { contract: "spike/assembly-field-study-file/v1", request, problem, result, file_digest: "fixture-digest" };
const handoff = { domain: "thermal", mesh: { counts: { cells: 12, vertices: 16 } }, source_traceability: [{}, {}], execution_issues: [] };
assert.doesNotThrow(() => model.assertFieldAssembly(request, { parts: assembly.parts, boards: assembly.boards, extensions: {} }));
assert.throws(() => model.assertFieldAssembly(request, { ...assembly, boards: [{ id: "other", name: "Controller" }] }), /ASSEMBLY_FIELD_STALE/);
assert.equal(model.fieldCanRun(request, handoff, false), true);
assert.equal(model.fieldCanRun(request, { ...handoff, execution_issues: [{ code: "missing-link" }] }, false), false);
assert.equal(model.fieldCanRun({ ...request, domain: "si" }, handoff, false), false);
assert.equal(model.fieldCanRun(request, handoff, true), false);
assert.deepEqual(model.fieldTemperatureRows(result, assembly).map(row => row.name), ["Controller", "Casing"]);
let slots = [], cursor = 0, queuedEffects = [], requests = [], selectedFile = null, exported = [], dirtyStates = [];
const hooks = {
  useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }]; },
  useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
  useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) slots[i] = { deps, value: fn() }; return slots[i].value; },
  useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) { const previous = slots[i]; slots[i] = { deps }; queuedEffects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
};
let solve = async () => result;
const worker = async operation => {
  requests.push(operation);
  const { method, params } = operation;
  const value = method === "read_assembly_field_study_in_project" ? { state: "current", record: saved, assembly }
    : method === "prepare_assembly_field_handoff" ? handoff
    : method === "import_assembly_field_study" ? params.record
    : method === "export_assembly_field_study" ? { ...saved, request: params.request, problem: params.problem, result: params.include_results === false ? null : params.result ?? null }
    : method === "run_assembly_field_thermal" ? await solve()
    : method === "save_assembly_field_study_in_project" ? { record: params.record, manifest: {} } : null;
  return { ok: true, result: value };
};
const code = ts.transpileModule(readFileSync(new URL("../src/AssemblyFieldStudyEditor.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => name === "react" ? hooks
  : name === "./assemblyFieldStudyPresentation" ? model : name === "./DataTable" ? { default: "table" }
    : name === "./workerBridge" ? { runLocalWorker: worker, runNativeProjectWorker: worker, openNativeTextFile: async () => selectedFile, saveNativeTextFile: async (...args) => exported.push(args) }
      : name.endsWith(".css") ? {} : require(name), module, module.exports);
const props = { assembly, projectPath: "fixture.spike", manifestDigest: "a".repeat(64), disabled: false, onUpdated: async () => {}, onStatus: () => {}, onDirtyChange: dirty => dirtyStates.push(dirty) };
let tree;
function render() { cursor = 0; tree = module.exports.default(props); const effects = queuedEffects; queuedEffects = []; effects.forEach(fn => fn()); return tree; }
async function settle() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
function nodes(value) { return !value || typeof value !== "object" ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(nodes)]; }
const button = text => nodes(tree).find(node => node.type === "button" && node.props.children === text);
const temperatures = () => nodes(tree).filter(node => node.type === "td" && ["Controller", "Casing"].includes(node.props.children));
render(); await settle();
assert.equal(temperatures().length, 2, "manifest-bound saved result is shown with occurrence names");
const boundaryInput = nodes(tree).find(node => node.type === "input" && node.props.type === "number");
boundaryInput.props.onChange({ target: { value: "310" } }); render();
assert.equal(temperatures().length, 0, "editing a boundary immediately retires its result");
assert.equal(dirtyStates.at(-1), true);
button("Reset drafts").props.onClick(); render();
assert.equal(temperatures().length, 2, "reset restores the admitted saved result, not a null-result dirty baseline");
assert.equal(dirtyStates.at(-1), false);
selectedFile = { contents: JSON.stringify({ ...saved, request: { ...request, assembly: { ...assembly, boards: [{ id: "wrong", name: "Controller" }] } } }) };
button("Open volume study").props.onClick(); await settle();
assert.ok(nodes(tree).some(node => node.props?.role === "alert" && String(node.props.children).includes("ASSEMBLY_FIELD_STALE")));
assert.equal(requests.filter(item => item.method === "import_assembly_field_study").length, 0, "other-project geometry is rejected before imported results can appear");
button("Export setup").props.onClick(); await settle();
assert.equal(JSON.parse(exported[0][1]).result, null, "standalone setup export strips results through worker admission");
button("Save setup").props.onClick(); await settle();
assert.equal(requests.at(-1).method, "save_assembly_field_study_in_project");
assert.equal(requests.at(-1).params.record.result, null);
assert.equal(temperatures().length, 0, "setup-only save drops the local active result too");
let resolveSolve;
solve = () => new Promise(resolve => { resolveSolve = resolve; });
button("Run steady thermal").props.onClick(); await settle();
props.manifestDigest = "b".repeat(64); render(); await settle();
resolveSolve({ ...result, occurrence_temperatures: { "board:a": { minimum_k: 900, maximum_k: 1000 } } });
await settle();
assert.equal(nodes(tree).some(node => node.type === "td" && node.props.children === "1000.000"), false, "late run output cannot overwrite the newly opened manifest");
assert.equal(button("Run steady thermal").props.disabled, false);
console.log("Field study binding, execution blockers, boundary invalidation, result reset, export/save modes and late-response admission passed");
