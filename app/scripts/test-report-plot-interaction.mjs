// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/reportPlotInteraction.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { reportPlotRuntime, reportPlotAttributes } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
class Node {
  constructor(name) { this.name = name; this.attrs = {}; this.children = []; this.listeners = {}; this.value = 'auto'; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  appendChild(child) { if(child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  insertBefore(child, before) { const index = this.children.indexOf(before); this.children.splice(index, 0, child); child.parentNode = this; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  get firstChild() { return this.children[0]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
const svg = new Node('svg'), traces = new Node('g'), ticks = new Node('g'), parent = new Node('figure');
parent.appendChild(svg); svg.appendChild(traces); svg.appendChild(ticks);
const raw = JSON.stringify({ frame: [60, 30, 460, 230], x: [0, 10], y: [10, -10] });
svg.attrs['data-spike-plot'] = raw;
svg.querySelector = selector => selector === '[data-plot-traces]' ? traces : selector === '[data-plot-ticks]' ? ticks : null;
svg.getScreenCTM = () => ({ inverse: () => ({}) });
svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return this; } });
const win = new Node('window');
vm.runInNewContext(reportPlotRuntime, { document: { querySelectorAll: () => [svg], createElement: name => new Node(name), createElementNS: (_ns, name) => new Node(name) }, window: win });
const transform = () => traces.getAttribute('transform').match(/[-+\d.e]+/g).map(Number);
let prevented = false;
const wheel = (x, y) => svg.listeners.wheel({ clientX:x, clientY:y, deltaY:-120, deltaMode:0, preventDefault(){prevented=true;}, stopPropagation(){} });
wheel(140, 250);
assert.equal(prevented, true); assert.ok(transform()[0] > 1); assert.equal(transform()[3], 1, 'report SVG X axis zoom leaves Y unchanged');
const afterX = transform();
svg.listeners.dblclick(); assert.deepEqual(transform(), [1, 0, 0, 1, 0, 0]);
wheel(35, 130); assert.equal(transform()[0], 1); assert.ok(transform()[3] > 1, 'reversed Y range is zoomed without reversing data');
const tools = parent.children[0], select = tools.children[1].children[0];
select.value = 'x'; svg.listeners.dblclick(); wheel(260, 130); assert.equal(transform()[3], 1, 'explicit target is honored inside plot');
select.value = 'auto'; svg.listeners.dblclick(); wheel(140, 250); assert.deepEqual(transform(), afterX);
win.listeners.beforeprint(); assert.deepEqual(transform(), [1, 0, 0, 1, 0, 0], 'print always uses full retained figure');
win.listeners.afterprint(); assert.deepEqual(transform(), afterX, 'screen zoom restores after print');
prevented = false; wheel(490, 260); assert.equal(prevented, false, 'blank margins retain document scroll');
assert.equal(svg.getAttribute('data-spike-plot'), raw, 'view operations do not change original range metadata');
assert.equal(ticks.children.length, 10, 'zoom regenerates bounded engineering tick labels');
assert.ok(reportPlotAttributes({ frame: [0,0,1,1], x: [0,1], y:[0,1] }).includes('&quot;'));
console.log('Offline report axis wheel zoom, explicit targeting, clipping and print restoration passed.');
