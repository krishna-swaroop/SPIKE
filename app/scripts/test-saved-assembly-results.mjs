// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/SavedAssemblyResults.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

let slots = [], cursor = 0, effects = [], workerMode = "valid", openCalls = 0, workerCalls = [], fileValue = null;
const hooks = {
  useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }]; },
  useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
  useEffect(fn, deps) { const i = cursor++; const prior = slots[i]; if (!prior || deps.some((value, index) => value !== prior.deps[index])) { slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = fn(); }); } },
};
const worker = async operation => {
  workerCalls.push(operation.method);
  if (operation.method === "prepare_multiboard_study") return { ok: true, result: { assembly_digest: "current", request: { assembly: operation.params.request.assembly } } };
  return workerMode === "reject" ? { ok: false, error: "Result topology validation failed; review and rerun." } : { ok: true, result: {} };
};
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(name => name === "react" ? hooks
  : name === "./automaticWorkerQueue" ? { runSerializedAutomaticWorker: (work, isCurrent) => isCurrent() ? work() : Promise.resolve(undefined) }
    : name === "./CoupledStudyResultTables" ? { default: ({ domain, result }) => React.createElement("div", { "data-testid": "result-tables" }, `${domain}:${result.native_result.data.value}`) }
      : name === "./multiboardStudyPresentation" ? { studyDraft: value => value }
        : name === "./workerBridge" ? { runLocalWorker: worker, openNativeTextFile: async () => { openCalls++; return fileValue; } }
          : name.endsWith(".css") ? {} : require(name), module, module.exports);
const Panel = module.exports.default;

const request = { contract: "spike/multiboard-circuit-request/v1", domain: "pi" };
const result = { status: "completed", model_status: "experimental", native_result: { data: { value: 4.99 } } };
const base = { contract: "spike/assembly-ir/v1", assembly_id: "A", name: "A", boards: [{ id: "one" }, { id: "two" }], parts: [] };
const assembly = study => ({ ...base, extensions: { "spike.multiboard-studies": { pi: study } } });
let props, tree;
function reset(nextProps) { slots = []; cursor = 0; effects = []; workerCalls = []; openCalls = 0; fileValue = null; workerMode = "valid"; props = nextProps; render(); }
function render() { cursor = 0; tree = Panel(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; }
async function settle() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
function nodes(value) { return !value || typeof value !== "object" ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(nodes)]; }
function button(label) { return nodes(tree).find(node => node.type === "button" && String(node.props.children).includes(label)); }

reset({ assembly: assembly({ assembly_digest: "current", request, result }), manifestDigest: "one" });
assert.match(renderToStaticMarkup(tree), /completed · experimental/);
button("Show PI result").props.onClick();
await settle();
assert.deepEqual(workerCalls, ["prepare_multiboard_study", "validate_multiboard_study_result"]);
assert.equal(openCalls, 0, "a retained result never opens a native file dialog");
assert.match(renderToStaticMarkup(tree), /pi:4.99/, "validated saved values are delegated to the shared numerical table");
props = { assembly: assembly({ assembly_digest: "current", request }), manifestDigest: "changed" };
cursor = 0; tree = Panel(props);
assert.doesNotMatch(renderToStaticMarkup(tree), /pi:4.99/, "a prior result cannot flash while changed assembly effects are pending");
effects.splice(0).forEach(effect => effect());

reset({ assembly: assembly({ assembly_digest: "old", request, result }), manifestDigest: "two" });
button("Show PI result").props.onClick(); await settle();
assert.match(renderToStaticMarkup(tree), /older assembly revision.*Review the setup and rerun/);
assert.equal(openCalls, 0, "a stale saved result is withheld instead of falling back to file browsing");

reset({ assembly: assembly({ assembly_digest: "current", request, result }), manifestDigest: "three" });
workerMode = "reject"; button("Show PI result").props.onClick(); await settle();
assert.match(renderToStaticMarkup(tree), /validation failed; review and rerun/);
assert.doesNotMatch(renderToStaticMarkup(tree), /data-testid="result-tables"/);
assert.equal(openCalls, 0, "an invalid saved result remains a review/rerun error");

reset({ assembly: assembly({ assembly_digest: "current", request }), manifestDigest: "four" });
assert.ok(button("Find result file"), "a setup with no retained result offers explicit file selection");
button("Find result file").props.onClick(); await settle();
assert.equal(openCalls, 1);
assert.doesNotMatch(renderToStaticMarkup(tree), /role="alert"/, "canceling file selection is quiet");
assert.deepEqual(workerCalls, [], "canceling file selection starts no validation worker");

reset({ assembly: assembly({ assembly_digest: "current", request, result: { artifact_ref: "results/pi.json" } }), manifestDigest: "five" });
assert.ok(button("Show PI result"), "an available but unhydrated result is not presented as missing");
button("Show PI result").props.onClick(); await settle();
assert.match(renderToStaticMarkup(tree), /result data is unavailable or malformed.*Reopen the project.*rerun/);
assert.equal(openCalls, 0, "an unhydrated saved result never silently falls back to file browsing");

reset({ assembly: { ...base, extensions: {} }, manifestDigest: "empty" });
assert.equal(nodes(tree).filter(node => node.type === "button" && node.props.children === "Find result file").length, 4,
  "a project with no saved studies offers explicit file fallback for each supported domain");
fileValue = { contents: JSON.stringify({ contract: "spike/multiboard-study-file/v1", domain: "pi", assembly_digest: "current", request, result }) };
button("Find result file").props.onClick(); await settle();
assert.equal(openCalls, 1);
assert.match(renderToStaticMarkup(tree), /pi:4.99/, "missing embedded results can be opened from a validated external study file");

reset({ assembly: { ...base, extensions: {} }, manifestDigest: "bad-file" });
fileValue = { contents: "broken JSON" };
button("Find result file").props.onClick(); await settle();
assert.match(renderToStaticMarkup(tree), /role="alert"/);
assert.deepEqual(workerCalls, [], "malformed external files are rejected before worker admission");
console.log("Saved assembly results validate retained values inline, withhold stale or rejected data, and handle missing or canceled files honestly.");
