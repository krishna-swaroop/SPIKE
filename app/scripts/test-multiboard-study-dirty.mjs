// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/MultiboardStudyEditor.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", js)(name => {
  if (name === "react") return require("react");
  if (name === "./DataTable") return { default: () => null };
  if (name === "./AssemblyMechanicalStudyModels") return { default: () => null, studyOwnerName: () => "" };
  if (name === "./workerBridge") return {};
  if (name === "./multiboardStudyPresentation") return {};
  if (name.endsWith(".css")) return {};
  return require(name);
}, module, module.exports);

const { studyEditorStateDirty } = module.exports;
const prepared = { rawDraft: '{"value":1}', result: null };
assert.equal(studyEditorStateDirty(prepared, prepared), false, "prepared study starts clean");
assert.equal(studyEditorStateDirty({ ...prepared, rawDraft: '{"value":2}' }, prepared), true, "setup edits are dirty");
assert.equal(studyEditorStateDirty({ ...prepared, rawDraft: "{" }, prepared), true, "unapplied JSON edits are dirty");
const solved = { ...prepared, result: { status: "ok", value: 2 } };
assert.equal(studyEditorStateDirty(solved, prepared), true, "a new result is dirty until saved");
assert.equal(studyEditorStateDirty(solved, solved), false, "saving setup and result establishes a clean baseline");
assert.equal(studyEditorStateDirty(prepared, prepared), false, "resetting to the baseline is clean");
console.log("Multiboard study prepared, edited, solved, saved, and reset dirty states passed");
