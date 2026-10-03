// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = await build({ entryPoints: [fileURLToPath(new URL("../src/engineeringReportFixture.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].contents).toString("base64")}`;
const destination = process.argv.find(arg => arg.startsWith("--output-dir="))?.slice("--output-dir=".length);
for (const domain of ["pi", "si", "thermal", "emi"]) {
  let document = "";
  globalThis.location = { search: `?domain=${domain}` };
  globalThis.document = { open() {}, close() {}, write(markup) { document = markup; } };
  await import(`${moduleUrl}#${domain}`);
  assert.match(document, /data-report-nav aria-label="Report sections"/);
  assert.match(document, /class="print-cover"/);
  assert.match(document, /Table of contents/);
  assert.match(document, /id="report-opening"/);
  assert.match(document, /id="report-closing"/);
  assert.match(document, /id="study-setup"/);
  assert.match(document, /Solver provenance records the executed model/);
  assert.match(document, /id="design-stackup"/);
  assert.match(document, /class="report-static-figure"/);
  assert.match(document, /Board dimensions 42\.000 x 24\.000 mm/);
  assert.match(document, /No values|no values|no new solver values/i);
  assert.match(document, /synthetic_ui_fixture_not_validated/);
  assert.match(document, /break-inside:auto/);
  assert.doesNotMatch(document, /section\{content-visibility:auto/);
  const ids = [...document.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${domain} report IDs must be unique`);
  const nav = document.match(/<nav data-report-nav[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav);
  for (const link of nav.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(link[1]), `${domain} navigation target ${link[1]} must exist`);
  assert.match(nav, /data-nav-net="net-1"/);
  assert.match(document, /id="net-panel-1" data-net-panel="net-1">/);
  assert.match(document, /\.net-panel,\.net-panel\[hidden\]\{display:block!important;break-before:page/);
  if (domain === "pi") assert.match(document, /Voltage-drop limit \(mV\)/);
  if (domain === "emi") assert.match(document, /Resolution Mm/);
  if (destination) {
    const dir = resolve(destination); await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `report-fixture-${domain}.html`), document);
  }
}
delete globalThis.document; delete globalThis.location;
const setupBundle = await build({ entryPoints: [fileURLToPath(new URL("../src/engineeringReportSetup.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const { buildReportSetupSection } = await import(`data:text/javascript;base64,${Buffer.from(setupBundle.outputFiles[0].contents).toString("base64")}`);
const assemblySetup = buildReportSetupSection({ boardFile: "assembly-fixture", analysisMode: "dc_ir_drop", setup: {}, limits: {},
  projectPayload: { assembly_ir: { boards: [{ name: "Controller", frame: { transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] } }, { name: "Shield" }],
    extensions: { "spike.multiboard-studies": { pi: { model: { frequency_hz: 42 }, result: { evidence: "DO_NOT_PRINT_RESULT" } } } } },
    studies: [{ cases: [{ setup: { load_current_a: .5 }, resultSnapshot: { evidence: "DO_NOT_PRINT_RESULT" }, resultRef: "DO_NOT_PRINT_RESULT" }] }] } }, "pi");
assert.match(assemblySetup, /Controller/);
assert.match(assemblySetup, /XYZ \(0\.000, 0\.000, 0\.000\) mm/);
assert.match(assemblySetup, /Placement not recorded/);
assert.match(assemblySetup, /Coupled Study Model[\s\S]*42/);
assert.match(assemblySetup, /Load Current A<\/th><td>0\.5/);
assert.doesNotMatch(assemblySetup, /DO_NOT_PRINT_RESULT/);
console.log("PI/SI/thermal/EM reports: navigable sections, all nets, setup, print front matter, static figures and validity preserved.");
