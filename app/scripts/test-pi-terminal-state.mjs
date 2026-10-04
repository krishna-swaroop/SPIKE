// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { piTerminalPosition, removePiTerminal } from '../src/piTerminalState.ts';
assert.equal(piTerminalPosition({ x: '', y: '' }), null);
assert.equal(piTerminalPosition({ x: ' ', y: '10' }), null);
assert.equal(piTerminalPosition({ x: 'NaN', y: '10' }), null);
assert.deepEqual(piTerminalPosition({ x: '0', y: '0' }), [0, 0]);
assert.deepEqual(piTerminalPosition({ x: '-12.5', y: ' 10 ' }), [-12.5, 10]);
const setup = { sources: [{ id: 'same' }], loads: [{ id: 'same' }],
  returnPath: { sources: [{ id: 'same' }], loads: [{ id: 'same' }] }, batchJobs: [{ id: 'batch' }] };
for (const role of ['source', 'load', 'source_return', 'load_return']) {
  const next = removePiTerminal(setup, role, 'same');
  const values = [next.sources, next.loads, next.returnPath.sources, next.returnPath.loads];
  assert.equal(values.filter(items => !items.length).length, 1, 'only the clicked role is deleted');
  assert.equal(next.batchJobs, setup.batchJobs);
  assert.equal(setup.sources.length, 1, 'original snapshot remains usable for undo');
}
assert.equal(removePiTerminal(setup, 'source', 'missing').sources.length, 1);
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const menuSource = app.slice(app.indexOf('function ViewportContextMenu('), app.indexOf('function StackupManager('));
const compiled = ts.transpileModule(menuSource.replace('function ViewportContextMenu', 'export function ViewportContextMenu'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const icons = ['Focus', 'Crosshair', 'Orbit', 'Layers3', 'Copy', 'SquareTerminal', 'RadioTower', 'ListTree', 'X', 'Play'];
const module = { exports: {} }, require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', 'window', 'document', 'useRef', 'useEffect', ...icons, compiled)(
  require, module, module.exports, { innerWidth: 1200, innerHeight: 800 }, { activeElement: null },
  value => ({ current: value }), () => {}, ...icons.map(() => () => null));
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
for (const [role, label] of [['source', 'Delete source'], ['load', 'Delete sink'], ['source_return', 'Delete source return'], ['load_return', 'Delete sink return']]) {
  let deleted = 0, closed = 0;
  const tree = module.exports.ViewportContextMenu({ request: { clientX: 100, clientY: 100,
    object: { id: 'analysis-terminal:same', type: 'terminal', terminalRole: role, name: 'Terminal' } },
    tab: 'EM', viewMode: '3D', isolated: false, onDeleteTerminal: () => deleted++, onClose: () => closed++ });
  const button = nodes(tree).find(node => node.type === 'button' && [node.props.children].flat(Infinity).filter(v => typeof v === 'string').join('').trim() === label);
  assert.ok(button, `${label} is available even outside the PI tab`);
  button.props.onClick(); assert.equal(deleted, 1); assert.equal(closed, 1);
}
console.log('PI terminal coordinates and role-scoped deletion passed.');
