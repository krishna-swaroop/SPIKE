// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
export function loadTableModule(name, react) {
  const base = name instanceof URL ? name : new URL(`../src/${name}`, import.meta.url);
  const file = [".ts", ".tsx", "/index.ts", "/index.tsx"].map(extension => new URL(base.href + extension)).find(existsSync);
  if (!file) throw new Error(`Missing table fixture module: ${base.href}`);
  if (!react && cache.has(file.href)) return cache.get(file.href);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(dependency => {
    if (dependency.endsWith(".css")) return {};
    if (dependency === "react" && react) return react;
    if (dependency.startsWith("./") || dependency.startsWith("../")) return loadTableModule(new URL(dependency, file), react);
    return require(dependency);
  }, module, module.exports);
  if (!react) cache.set(file.href, module.exports);
  return module.exports;
}
export default function loadDataTable() { return loadTableModule("DataTable").default; }
