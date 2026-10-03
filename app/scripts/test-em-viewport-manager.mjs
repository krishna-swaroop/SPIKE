// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/EMViewportResultManager.tsx", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", loader: { ".css": "empty" }, external: ["react", "react-dom", "react-dom/server", "plotly.js-dist-min", "lucide-react"] });
const file = new URL("../.em-viewport-test-ui.mjs", import.meta.url);
writeFileSync(file, bundle.outputFiles[0].contents);
try {
  const { default: Manager } = await import(file.href);
  const dataBundle = await build({ entryPoints: [fileURLToPath(new URL("../src/emViewportResults.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
  const { buildEMViewportData, defaultEMViewportSettings } = await import(`data:text/javascript;base64,${Buffer.from(dataBundle.outputFiles[0].contents).toString("base64")}`);
  const plane = { frequency_hz: 1e9, grid_shape: [3, 3], coordinates_mm: Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3), 2]), valid: [true, true, true, true, false, true, true, true, true], e_v_m: Array.from({ length: 9 }, (_, i) => i === 4 ? null : [[i + 1, 0], [0, 0], [0, 0]]), h_a_m: Array.from({ length: 9 }, (_, i) => i === 4 ? null : [[0, 0], [1, 0], [0, 0]]) };
  const radiation = { frequencies_hz: [1e9], cuts: [{ frequency_hz: 1e9, angles_deg: [0, 90, 180], relative_amplitude_db: [-10, 0, -10] }] };
  const result = { status: "completed", model_status: "unvalidated", fields: {}, em_fields: { nearfield: { contract: "spike/emerge-nearfield-plane/v1", frequencies_hz: [1e9], planes: [plane] }, radiation }, em_networks: { s_parameters: { frequencies_hz: [1e9, 2e9], ports: ["P1"], reference_impedance_ohm: 50, values: [[[[0.5, 0]]], [[[0.25, 0]]]] } }, summary: {}, issues: [], provenance: {} };
  const record = { id: "em-1", label: "Antenna solve", result };
  const settings = { ...defaultEMViewportSettings, quantity: "near_e", selectedSample: 4 };
  const data = buildEMViewportData(record, settings);
  assert.ok(data);
  assert.equal(data.values[4], null);
  const html = renderToStaticMarkup(createElement(Manager, { records: [record], activeRecordId: "em-1", settings, data, onSelectRecord() {}, onSettingsChange() {}, onClose() {} }));
  assert.match(html, /aria-label="EM viewport result manager"/);
  assert.match(html, /Antenna solve/);
  assert.match(html, /invalid \/ unavailable/);
  assert.match(html, /Invalid solver samples leave gaps/);
  assert.match(html, /Linked radiation cuts/);
  assert.match(html, /S-parameter sweep/);
  assert.match(html, /Click a frequency or use arrow keys to update the viewport/);
  assert.match(html, /candidate nodes\/antinodes, not certified/);
  const phaseSettings = { ...settings, projection: "phase", component: "x" };
  const phaseHtml = renderToStaticMarkup(createElement(Manager, { records: [record], activeRecordId: "em-1", settings: phaseSettings, data: buildEMViewportData(record, phaseSettings), onSelectRecord() {}, onSettingsChange() {}, onClose() {} }));
  assert.match(phaseHtml, /<option value="norm" disabled="">Vector norm/);
  assert.match(phaseHtml, /<input type="checkbox" disabled=""\/>Low amplitude/);
  const empty = renderToStaticMarkup(createElement(Manager, { records: [], activeRecordId: "", settings, data: null, onSelectRecord() {}, onSettingsChange() {}, onClose() {} }));
  assert.match(empty, /Run a supported EM extension/);
  const source = readFileSync(new URL("../src/EMViewportResultManager.tsx", import.meta.url), "utf8");
  assert.match(source, /y: values, connectgaps: false/, "invalid field samples remain null gaps");
  assert.match(source, /onSelect\(point\.pointNumber\)/, "plot clicks preserve the exact source sample index");
  assert.match(source, /traces\.map\(trace => \(\{ type: "scatter"/, "every enabled EM trace reaches the shared plot");
  assert.doesNotMatch(source, /<svg\b/, "legacy quantitative SVG plots are removed");
  assert.match(source, /selectedSample: index/);
  assert.match(source, /onFrequencyChange.*frequencyIndex: index/);
  assert.match(source, /onKeyDown/);
  console.log("EM viewport manager: actual fields, preserved EM data, invalid gaps, linked probes, graph frequency controls and honest extrema labels passed.");
} finally { unlinkSync(file); }
