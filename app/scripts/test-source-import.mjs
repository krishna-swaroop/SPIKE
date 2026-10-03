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
const connectionColumns = load('harnessConnectionColumns.ts', { './importSourceRouting': routing });
const { connectionListHeader, connectionColumnMap } = connectionColumns;
assert.deepEqual(connectionListHeader('\uFEFF"Wire, ID",From,"Pin ""A"""\r\nvalue,row,data', ','), ['Wire, ID', 'From', 'Pin "A"']);
assert.deepEqual(connectionListHeader('wire_id\tfrom_connector\tfrom_pin\r\n', '\t'), ['wire_id', 'from_connector', 'from_pin']);
assert.throws(() => connectionListHeader('a,a\n', ','), /unique/);
assert.throws(() => connectionListHeader('"a\n', ','), /Unterminated/);
assert.throws(() => connectionListHeader('"a"extra,b\n', ','), /Malformed/);
assert.throws(() => connectionListHeader('a'.repeat(65537), ','), /64 KiB/);
const canonicalHeaders = [...routing.HARNESS_COLUMNS, ...connectionColumns.OPTIONAL_HARNESS_COLUMNS];
assert.deepEqual(Object.keys(connectionColumnMap(canonicalHeaders, {})), canonicalHeaders);
assert.throws(() => connectionColumnMap(canonicalHeaders, { from_pin: 'wire_id' }), /more than once/);
assert.throws(() => connectionColumnMap(canonicalHeaders, { length_mm: 'missing' }), /not found/);
assert.equal(connectionColumnMap([...routing.HARNESS_COLUMNS, 'Wire length'], { length_mm: 'Wire length' }).length_mm, 'Wire length');
assert.deepEqual(connectionListHeader('"Wire\nID",From\r\nW1,J1', ','), ['Wire\nID', 'From']);
assert.throws(() => connectionListHeader(Array.from({ length: 257 }, (_, index) => `col${index}`).join(','), ','), /too many/);
for (const [name, expected] of Object.entries({ 'board.KICAD_PCB': 'kicad', 'job.tar.gz': 'odb++', 'job.zip': 'odb++', 'board.xml': 'ipc2581', 'wires.tsv': 'harness', 'case.STP': 'mcad', 'board.spike-design.json': 'normalized', 'project.spike': 'project', 'result.spike-results.json': 'results', 'unknown.json': 'unknown' })) assert.equal(routing.classifyOpenSource(name), expected, name);
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'spike/harness/v1' }), 'harness');
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'spike/result-package/v2' }), 'results');
assert.equal(routing.classifyOpenSource('anything.json', { format: 'spike-project-package/v3' }), 'project');
assert.equal(routing.classifyOpenSource('anything.json', { contract: 'unrelated/v1' }), 'unknown');

const jsx = (type, props) => ({ type, props: props ?? {} });
function harness(kind, worker, apply = async () => {}, bridgeOverrides = {}) {
  const state = [], refs = [], cleanups = [], requests = [], cancelled = [];
  let cursor = 0, refCursor = 0, mounted = false, tree;
  const bridge = { runLocalWorker: async request => { requests.push(request); return worker(request); }, cancelLocalWorker: async id => cancelled.push(id), readApprovedSourceFile: async path => ({ path, fileName: 'sample.csv', contents: 'wire_id,from_connector,Connector A,from_pin,to_connector,to_pin,net,length_mm,resistance_ohm\nW1,J1,J1,1,J2,2,VCC,100,0.1\n' }), ...bridgeOverrides };
  const Component = load('ImportSourceDialog.tsx', {
    react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }, useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; }, useEffect(callback) { if (!mounted) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, './icons': { FolderOpen: 'icon', Upload: 'icon', X: 'icon' }, './workerBridge': bridge, './importSourceRouting': routing, './harnessConnectionColumns': connectionColumns,
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
assert.equal(harnessImport.requests[0].params.context.parameters.column_map.net, 'net');
assert.equal(harnessImport.requests[0].params.context.parameters.column_map.length_mm, 'length_mm');
assert.equal(harnessImport.requests[0].params.context.parameters.column_map.resistance_ohm, 'resistance_ohm');
await harnessImport.click('Apply import');
assert.ok(harnessImport.button('Apply import'), 'Commit failure keeps prepared data for retry');
assert.ok(harnessImport.elements().find(node => node.props?.role === 'alert' && node.props.children.includes('Project busy')));
for (const [document, expectedKind] of [[wires, 'harness'], [snapshot, 'normalized']]) {
  const chosen = harness('kicad', async () => { throw Error('Choosing must not run the importer'); }, undefined, {
    selectNativeWorkbenchFile: async () => ({ path: 'C:/fixtures/vendor.json', fileName: 'vendor.json' }),
    readApprovedSourceFile: async () => ({ contents: JSON.stringify(document) }),
  });
  await chosen.click(' Choose file');
  assert.equal(chosen.elements().find(node => node.type === 'select').props.value, expectedKind);
  assert.equal(chosen.requests.length, 0);
}
const projectChosen = harness('kicad', async () => {}, undefined, {
  selectNativeWorkbenchFile: async () => ({ path: 'C:/fixtures/saved.json', fileName: 'saved.json' }),
  readApprovedSourceFile: async () => ({ contents: JSON.stringify({ format: 'spike-project-package/v3' }) }),
});
await projectChosen.click(' Choose file');
assert.ok(projectChosen.elements().find(node => node.props?.role === 'alert' && node.props.children.includes('Use Open')));

let finishHeader;
const readingHeader = harness('harness', async () => { throw Error('Cancelled header read must not start a worker'); }, undefined, {
  readApprovedSourceFile: () => new Promise(resolve => { finishHeader = resolve; }),
});
const headerPending = readingHeader.click('Prepare import');
await readingHeader.click('Cancel import');
finishHeader({ contents: routing.HARNESS_COLUMNS.join(',') }); await headerPending;
assert.equal(readingHeader.requests.length, 0);
assert.equal(readingHeader.button('Apply import'), undefined);

let finishCancel, finishWorker;
const cancelling = harness('odb++', () => new Promise(resolve => { finishWorker = resolve; }), undefined, {
  cancelLocalWorker: () => new Promise(resolve => { finishCancel = resolve; }),
});
const workPending = cancelling.click('Prepare import');
const cancellationPending = cancelling.click('Cancel import');
assert.equal(cancelling.button('Prepare import').props.disabled, true, 'A second worker cannot start until cancellation finishes');
finishWorker({ ok: true, result: { snapshot } }); await workPending;
assert.equal(cancelling.button('Apply import'), undefined);
finishCancel(true); await cancellationPending;
assert.equal(cancelling.button('Prepare import').props.disabled, false);
console.log('Source import routing, step selection, mapping, prepare/apply, errors, cancellation and stale response checks passed.');
