// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const emerge = read("EMergeExtension.tsx");
assert.match(emerge, /x: points\.map\(point => point\[0\]\), y: points\.map\(point => point\[1\]\), connectgaps: false/, "EMerge plots retain every solved sample in source order");
assert.match(emerge, /setPinnedIndex\(point\.pointNumber\)/, "EMerge pinning uses exact Plotly source identity");
assert.doesNotMatch(emerge, /function plotPath|<svg\b/, "EMerge legacy sampled SVG path is removed");

const manager = read("EMViewportResultManager.tsx");
assert.match(manager, /x: values\.map\(\(_, index\) => index\), y: values, connectgaps: false/, "viewport samples retain null gaps and actual indexes");
assert.match(manager, /onSelect\(point\.pointNumber\)/, "linked viewport clicks select the exact retained index");
assert.match(manager, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/, "linked frequency keyboard stepping is preserved");
assert.doesNotMatch(manager, /<svg\b/, "EM manager legacy quantitative SVGs are removed");

const sparam = read("SParameterWorkbench.tsx");
assert.match(sparam, /x: points\.map\(point => point\.frequencyHz\), y: points\.map\(point => point\.magnitudeDb\), connectgaps: false/, "Touchstone preview retains exact frequency and magnitude arrays");
assert.match(sparam, /xaxis: \{ title: "Frequency \(Hz\)", type: "log" \}/, "Touchstone frequency scale and unit are preserved");
assert.match(sparam, /setSample\(point\.pointNumber\)/, "Touchstone chart clicks update the existing exact sample cursor");
assert.doesNotMatch(sparam, /<svg\b/, "Touchstone legacy SVG chart is removed");

const emi = read("EmiWorkbench.tsx");
assert.match(emi, /type: "scatterpolar"/, "NF2FF cut uses the shared polar chart path");
assert.match(emi, /theta: cutSamples\.map\(sample => sample\.angle\), r: polarDb, connectgaps: false/, "polar chart retains angular sample identity and gaps");
assert.match(emi, /Directivity \(dBi\)/, "polar radial units stay explicit");
assert.doesNotMatch(emi, /className="polar-trace"|<svg\b/, "legacy NF2FF polar SVG is removed");

console.log("RF/SI shared chart adapter assertions passed");
