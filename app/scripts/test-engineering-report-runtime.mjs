// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const runtimeSource = readFileSync(new URL("../src/engineeringReportRuntime.ts", import.meta.url), "utf8");
const runtimeMatch = runtimeSource.match(/String\.raw`([\s\S]*)`;\s*$/);
assert.ok(runtimeMatch, "the engineering report runtime must remain an exported String.raw script");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = "", attributes = {}) {
    this.id = id;
    this.attributes = new Map(Object.entries(attributes));
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.hidden = false;
    this.textContent = "";
    this.style = {};
    this.children = [];
    this.options = [];
    this.selectedIndex = 0;
    this.value = "";
    this.rect = { width: 0, height: 0, top: 0, left: 0 };
    this.closestTargets = new Map();
    this.scrollCount = 0;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...event });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { this.children.push(...nodes); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  setPointerCapture() {}
  scrollIntoView() { this.scrollCount += 1; }
  closest(selector) { return this.closestTargets.get(selector) ?? null; }
  querySelectorAll() { return []; }
}

function createContext() {
  return {
    clearCount: 0, textRecords: [],
    clearRect() { this.clearCount += 1; this.textRecords = []; },
    fillRect() {}, setTransform() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    fill() {}, stroke() {}, arc() {}, rect() {}, clip() {}, fillText(...args) { this.textRecords.push(args); }, save() {}, restore() {}, translate() {}, rotate() {},
    createRadialGradient() { return { addColorStop() {} }; },
  };
}

class FakeCanvas extends FakeElement {
  constructor(id) {
    super(id);
    this.context = createContext();
    this.width = 0;
    this.height = 0;
  }
  getContext(kind) { return kind === "2d" ? this.context : null; }
}

const elements = new Map();
const add = element => { if (element.id) elements.set(element.id, element); return element; };
const runtimeDiagnostic = add(new FakeElement("report-runtime-diagnostic"));
runtimeDiagnostic.hidden = true;

const reportData = add(new FakeElement("report-data"));
reportData.textContent = JSON.stringify({
  layers: ["F.Cu"], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  outlineLoops: [[[0, 0], [10, 0], [10, 5], [0, 5]]], zones: [], tracks: [], pads: [], vias: [], components: [],
  fields: { voltage_v: [{ value: 1, x_mm: 2, y_mm: 2, layer: "F.Cu" }] }, impedance: [], timeSeries: [],
  datasets: [
    { id: "net-0", fields: { voltage_v: [{ value: 1, x_mm: 2, y_mm: 2, layer: "F.Cu" }] }, impedance: [] },
    { id: "net-1", fields: { voltage_v: [{ value: 2, x_mm: 8, y_mm: 3, layer: "F.Cu" }] }, impedance: [] },
  ],
});
const evidenceData = add(new FakeElement("evidence-data"));
evidenceData.textContent = JSON.stringify({ report_id: "runtime-test" });

const boardCanvas = add(new FakeCanvas("board-canvas"));
const graphCanvas = add(new FakeCanvas("result-chart"));
const visualShell = new FakeElement("visual-shell");
const graphShell = new FakeElement("graph-shell");
boardCanvas.closestTargets.set(".visual-shell", visualShell);
graphCanvas.closestTargets.set(".graph-shell", graphShell);

const metricSelect = add(new FakeElement("viewport-metric"));
metricSelect.value = "voltage_v";
metricSelect.options = [new FakeElement("", { "data-unit": "V" })];
const graphSelect = add(new FakeElement("graph-series"));
graphSelect.value = "voltage_v";
graphSelect.options = [Object.assign(new FakeElement("", { "data-unit": "V" }), { textContent: "Voltage" })];
add(new FakeElement("graph-tooltip"));
add(new FakeElement("viewport-tooltip"));
add(new FakeElement("viewport-colorbar"));
add(new FakeElement("color-min"));
add(new FakeElement("color-max"));
add(new FakeElement("color-unit"));
add(new FakeElement("interaction-hint"));

const netTabs = [
  new FakeElement("", { "data-net-tab": "net-0" }),
  new FakeElement("", { "data-net-tab": "net-1" }),
];
const netPanels = [
  add(new FakeElement("net-panel-0", { "data-net-panel": "net-0" })),
  add(new FakeElement("net-panel-1", { "data-net-panel": "net-1" })),
];
const overview = add(new FakeElement("overview"));
const overviewLink = new FakeElement("", { href: "#overview" });
const net0Link = new FakeElement("", { href: "#net-panel-0", "data-nav-net": "net-0" });
const net1Link = new FakeElement("", { href: "#net-panel-1", "data-nav-net": "net-1" });
const reportNav = new FakeElement("report-nav", { "data-report-nav": "" });
reportNav.querySelectorAll = selector => selector === 'a[href^="#"]' ? [overviewLink, net0Link, net1Link] : [];

const documentListeners = new Map();
const document = {
  body: new FakeElement("body"),
  getElementById: id => elements.get(id) ?? null,
  querySelector: selector => selector === "[data-report-nav]" ? reportNav : null,
  querySelectorAll: selector => ({
    "[data-net-tab]": netTabs,
    "[data-net-panel]": netPanels,
    "[data-board-view]": [],
    "[data-field-display]": [],
  })[selector] ?? [],
  createElement: () => new FakeElement(),
  addEventListener(type, listener) { documentListeners.set(type, listener); },
};

const windowListeners = new Map();
const animationFrames = [];
const resizeObservers = [];
const intersectionObservers = [];
class FakeResizeObserver {
  constructor(callback) { this.callback = callback; this.targets = []; resizeObservers.push(this); }
  observe(target) { this.targets.push(target); }
}
class FakeIntersectionObserver {
  constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; intersectionObservers.push(this); }
  observe(target) { this.targets.push(target); }
}
const location = { hash: "#net-panel-1" };
const window = {
  devicePixelRatio: 1,
  location,
  history: { pushState(_state, _title, hash) { location.hash = hash; } },
  ResizeObserver: FakeResizeObserver,
  IntersectionObserver: FakeIntersectionObserver,
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) ?? [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  },
  requestAnimationFrame(callback) { animationFrames.push(callback); return animationFrames.length; },
  print() {},
  console: { errors: [], error(...args) { this.errors.push(args); } },
};
function dispatchWindow(type, event = {}) {
  for (const listener of windowListeners.get(type) ?? []) listener(event);
}
function flushAnimationFrames() {
  while (animationFrames.length) animationFrames.shift()();
}

vm.runInNewContext(runtimeMatch[1], {
  window, document, ResizeObserver: FakeResizeObserver, IntersectionObserver: FakeIntersectionObserver,
  Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  setTimeout: callback => { callback(); return 1; }, clearTimeout() {}, console: window.console,
});

assert.equal(netTabs[1].getAttribute("aria-selected"), "true", "a direct net hash selects its tab during initialization");
assert.equal(netPanels[0].hidden, true, "direct net navigation hides the other net panel");
assert.equal(netPanels[1].hidden, false, "direct net navigation reveals the requested net panel");
assert.equal(net1Link.getAttribute("aria-current"), "location", "the direct hash marks the matching sidebar link");

assert.equal(boardCanvas.context.clearCount, 0, "a zero-size board canvas is not treated as rendered");
assert.equal(graphCanvas.context.clearCount, 0, "a zero-size result graph is not treated as rendered");
assert.equal(visualShell.getAttribute("data-render-ready"), null, "the board fallback remains eligible while its canvas has no size");
assert.equal(graphShell.getAttribute("data-render-ready"), null, "the graph fallback remains eligible while its canvas has no size");
assert.equal(resizeObservers.length, 1, "one bounded resize observer owns both canvases");
assert.deepEqual(resizeObservers[0].targets, [boardCanvas, graphCanvas]);

boardCanvas.rect = { width: 640, height: 360, top: 100, left: 0 };
graphCanvas.rect = { width: 600, height: 300, top: 500, left: 0 };
resizeObservers[0].callback([{ target: boardCanvas }, { target: graphCanvas }]);
flushAnimationFrames();
assert.ok(boardCanvas.context.clearCount > 0, "ResizeObserver recovers the board canvas after it becomes measurable");
assert.ok(graphCanvas.context.clearCount > 0, "ResizeObserver recovers the graph canvas after it becomes measurable");
assert.equal(visualShell.getAttribute("data-render-ready"), "true", "a successful board draw marks its interactive shell ready");
assert.equal(graphShell.getAttribute("data-render-ready"), "true", "a successful graph draw marks its interactive shell ready");
const graphLabels = () => graphCanvas.context.textRecords.slice(0, 12).map(record => record[0]);
const originalLabels = graphLabels(), originalReportData = reportData.textContent;
let wheelPrevented = false;
graphCanvas.dispatch("wheel", { clientX: 300, clientY: 780, deltaY: -120, deltaMode: 0, preventDefault() { wheelPrevented = true; }, stopPropagation() {} });
assert.equal(wheelPrevented, true);
assert.deepEqual(graphLabels().slice(0, 6), originalLabels.slice(0, 6), "report X-axis wheel leaves Y range unchanged");
assert.notDeepEqual(graphLabels().slice(6), originalLabels.slice(6), "report X-axis wheel zooms X");
graphCanvas.dispatch("dblclick"); assert.deepEqual(graphLabels(), originalLabels, "fit restores the original ranges");
graphCanvas.dispatch("wheel", { clientX: 30, clientY: 620, deltaY: -120, deltaMode: 0, preventDefault() {}, stopPropagation() {} });
assert.notDeepEqual(graphLabels().slice(0, 6), originalLabels.slice(0, 6), "report Y-axis wheel zooms Y");
assert.deepEqual(graphLabels().slice(6), originalLabels.slice(6), "report Y-axis wheel leaves X range unchanged");
graphCanvas.dispatch("keydown", { key: "0", preventDefault() {} }); assert.deepEqual(graphLabels(), originalLabels);
wheelPrevented = false;
graphCanvas.dispatch("wheel", { clientX: 595, clientY: 780, deltaY: -120, preventDefault() { wheelPrevented = true; } });
assert.equal(wheelPrevented, false, "blank report chart margin keeps page scrolling");
assert.equal(reportData.textContent, originalReportData, "report view interactions never change retained evidence");

let prevented = false;
overviewLink.dispatch("click", { preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(location.hash, "#overview");
assert.equal(overview.scrollCount, 1, "ordinary section links scroll to their target");
assert.equal(overviewLink.getAttribute("aria-current"), "location");
assert.equal(net1Link.getAttribute("aria-current"), null, "only one sidebar location marker remains active");

net0Link.dispatch("click", { preventDefault() {} });
assert.equal(netTabs[0].getAttribute("aria-selected"), "true", "a sidebar net link activates the existing net tab");
assert.equal(netPanels[0].hidden, false);
assert.equal(netPanels[1].hidden, true);
assert.equal(netPanels[0].scrollCount, 1, "the selected net panel is scrolled into view");

location.hash = "#net-panel-1";
dispatchWindow("hashchange");
assert.equal(netTabs[1].getAttribute("aria-selected"), "true", "hash changes keep net tab state synchronized");

assert.equal(intersectionObservers.length, 2, "visibility and section tracking use two bounded observers");
intersectionObservers[1].callback([{ target: overview, isIntersecting: true, boundingClientRect: { top: 12 } }]);
assert.equal(overviewLink.getAttribute("aria-current"), "location", "visible sections update the sidebar location marker");

const beforePrintDraws = boardCanvas.context.clearCount;
dispatchWindow("beforeprint");
assert.ok(boardCanvas.context.clearCount > beforePrintDraws, "beforeprint refreshes measurable canvases");
const beforeAfterPrint = boardCanvas.context.clearCount;
dispatchWindow("afterprint");
flushAnimationFrames();
assert.ok(boardCanvas.context.clearCount > beforeAfterPrint, "afterprint restores the interactive canvas dimensions");
assert.equal(window.console.errors.length, 0, "the runtime completes without diagnostics in the supported test fixture");

console.log("engineering report runtime tests passed");
