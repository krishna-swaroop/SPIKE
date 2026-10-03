// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(name, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name.endsWith('.css')) return {};
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const routing = load('importSourceRouting.ts');
for (const [name, expected] of Object.entries({ 'board.KICAD_PCB': 'kicad', 'job.tar.gz': 'odb++', 'job.zip': 'odb++', 'board.xml': 'ipc2581', 'wires.tsv': 'harness', 'case.STP': 'mcad', 'board.spike-design.json': 'normalized', 'project.spike': 'project', 'result.spike-results.json': 'results', 'unknown.json': 'unknown' })) assert.equal(routing.classifyOpenSource(name), expected, name);
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'spike/harness/v1' }), 'harness');
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'spike/result-package/v2' }), 'results');
assert.equal(routing.classifyOpenSource('anything.json', { format: 'spike-project-package/v3' }), 'project');
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'unrelated/v1' }), 'unknown');

const jsx = (type, props) => ({ type, props: props ?? {} });
function harness(kind, worker, apply = async () => {}) {
  const state = [], refs = [], cleanups = [], requests = [], cancelled = [];
  let cursor = 0, refCursor = 0, mounted = false, tree;
  const bridge = { runLocalWorker: async request => { requests.push(request); return worker(request); }, cancelLocalWorker: async id => cancelled.push(id), readApprovedSourceFile: async path => ({ path, fileName: 'sample.kicad_pcb', contents: '(kicad_pcb)' }) };
  const Component = load('ImportSourceDialog.tsx', {
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }, useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; }, useEffect(callback) { if (!mounted) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, './icons': { FolderOpen: 'icon', Upload: 'icon', X: 'icon' }, './workerBridge': bridge, './importSourceRouting': routing,
  }).default;
  const render = () => { cursor = 0; refCursor = 0; tree = Component({ initialSource: { path: 'C:/fixtures/sample.' + (kind === 'harness' ? 'csv' : 'tgz'), fileName: 'sample.' + (kind === 'harness' ? 'csv' : 'tgz') }, initialKind: kind, onApply: apply, onClose: () => {} }); mounted = true; return tree; };
  const elements = () => { const all = []; const walk = node => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { all.push(node); walk(node.props?.children); } }; walk(render()); return all; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' && node ? text(node.props?.children) : String(node ?? '');
  const button = label => elements().find(node => node.type === 'button' && text(node) === label);
  const click = async label => { const item = button(label); assert.ok(item, `Missing ${label}`); assert.ok(!item.props.disabled, `${label} disabled`); await item.props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { state, requests, cancelled, elements, button, click, unmount: () => cleanups.forEach(fn => fn()) };
}

const snapshot = { contract: 'spike/design-snapshot/v1', design: { contract: 'spike/v1' }, report: { unsupported: ['unresolved model'] } };
let applied;
const odb = harness('odb++', async request => request.method === 'invoke_extension'
  ? { ok: true, result: { data: { steps: ['board', 'panel'], default_step: '' } } }
  : { ok: true, result: { snapshot } }, async source => { applied = source; });
await odb.click('Read job steps');
assert.equal(odb.button('Prepare import').props.disabled, true, 'Multi-step import needs a step');
const select = odb.elements().filter(node => node.type === 'select')[1];
select.props.onChange({ target: { value: 'board' } });
await odb.click('Prepare import');
assert.equal(odb.requests.at(-1).params.options.step, 'board');
assert.equal(applied, undefined, 'Preparation must not modify the project');
await odb.click('Apply import');
assert.equal(applied.kind, 'board'); assert.deepEqual(applied.report, snapshot.report);

const failing = harness('odb++', async () => ({ ok: false, error: 'Corrupt job matrix' }));
await failing.click('Prepare import');
assert.ok(failing.elements().find(node => node.props?.role === 'alert' && node.props.children.includes('Corrupt')));
assert.equal(failing.button('Apply import'), undefined);

let finish;
const delayed = harness('odb++', () => new Promise(resolve => { finish = resolve; }), () => { throw Error('Cancelled import committed'); });
const pending = delayed.click('Prepare import');
await delayed.click('Cancel import');
finish({ ok: true, result: { snapshot } }); await pending;
assert.equal(delayed.button('Apply import'), undefined, 'Late cancelled response discarded');
assert.equal(delayed.cancelled.length, 1);

let finishUnmounted;
const unmounted = harness('odb++', () => new Promise(resolve => { finishUnmounted = resolve; }));
const unmountedPending = unmounted.click('Prepare import');
unmounted.unmount(); finishUnmounted({ ok: true, result: { snapshot } }); await unmountedPending;
assert.equal(unmounted.button('Apply import'), undefined, 'Unmounted import cannot become ready');

const wires = { contract: 'spike/harness/v1', connectors: [], wires: [] };
const harnessImport = harness('harness', async () => ({ ok: true, result: { data: wires } }), async () => { throw Error('Project busy; retry'); });
const column = harnessImport.elements().find(node => node.type === 'input' && node.props.placeholder === 'from_connector');
column.props.onChange({ target: { value: 'Connector A' } });
await harnessImport.click('Prepare import');
assert.equal(harnessImport.requests[0].params.context.parameters.column_map.from_connector, 'Connector A');
assert.equal(harnessImport.requests[0].params.context.parameters.column_map.wire_id, 'wire_id');
await harnessImport.click('Apply import');
assert.ok(harnessImport.button('Apply import'), 'Commit failure keeps prepared data for retry');
assert.ok(harnessImport.elements().find(node => node.props?.role === 'alert' && node.props.children.includes('Project busy')));
console.log('Source import routing, step selection, mapping, prepare/apply, errors, cancellation and stale response checks passed.');
