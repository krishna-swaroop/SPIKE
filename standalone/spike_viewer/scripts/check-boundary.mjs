// SPDX-License-Identifier: Apache-2.0
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
const root = resolve('.');
let count = 0;
const problems = [];
function scan(folder) {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, item.name);
    if (item.isDirectory()) { scan(path); continue; }
    if (!/\.(ts|tsx)$/.test(path)) continue;
    count++;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let value;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) value = node.moduleSpecifier?.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) value = node.arguments[0]?.text;
      if (typeof value === 'string') {
        if (value.startsWith('.') && relative(root, resolve(dirname(path), value)).startsWith('..')) problems.push(`${path}: outside-project import ${value}`);
        if (!value.startsWith('.') && !/^(react|react-dom|three)(\/|$)/.test(value)) problems.push(`${path}: undeclared engine dependency ${value}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (/__TAURI__|@tauri-apps|workerBridge|\bfetch\s*\(\s*["']https?:/.test(source.text)) problems.push(`${path}: native worker or remote service dependency`);
  }
}
scan(resolve('src'));
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Portable boundary verified across ${count} source modules.`);
