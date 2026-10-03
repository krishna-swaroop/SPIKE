// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, writeFile } from "node:fs/promises";
const plotlyStub = { name: "chart-dependency-stubs", setup(build) {
  build.onResolve({ filter: /^\.\/PlotlyChart$/ }, () => ({ path: "PlotlyChart", namespace: "test-stub" }));
  build.onResolve({ filter: /^\.\/DataTable$/ }, () => ({ path: "DataTable", namespace: "test-stub" }));
  build.onLoad({ filter: /^PlotlyChart$/, namespace: "test-stub" }, () => ({ contents: "export default function PlotlyChart(){ return null; }", loader: "js" }));
  build.onLoad({ filter: /^DataTable$/, namespace: "test-stub" }, () => ({ contents: "import React from 'react'; export default function DataTable({children,label}){ return React.createElement('table',{'aria-label':label},children); }", loader: "js" }));
} };
const bundle = await build({ entryPoints:[fileURLToPath(new URL("../src/ACPowerIntegrityEffects.tsx",import.meta.url))],bundle:true,write:false,format:"esm",platform:"node",external:["react"],loader:{".css":"empty"},plugins:[plotlyStub] });
const code = bundle.outputFiles[0].text.replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(new URL("../node_modules/react/jsx-runtime.js",import.meta.url).href)}`).replaceAll('from "react"',`from ${JSON.stringify(new URL("../node_modules/react/index.js",import.meta.url).href)}`);
const {defaultACPIForm,buildACPIRequest,acpiFormat,ACPISampleChart,ACPISamplePlots,ACPowerIntegrityEffects} = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const form = {...defaultACPIForm(),length_mm:"100",R:".1",L_nh:"250",G:"0",C_pf:"100",start:"1000",stop:"1000000",points:"4"};
const request = buildACPIRequest(form);
assert.equal(request.length_m,.1); assert.ok(Math.abs(request.L_h_per_m-250e-9)<1e-20); assert.ok(Math.abs(request.C_f_per_m-100e-12)<1e-23);
assert.equal(request.load_impedance_ohm,null); assert.deepEqual(request.source_impedance_ohm,[0,0]);
assert.equal(request.frequencies_hz.length,4); assert.equal(request.frequencies_hz[0],1000); assert.equal(request.frequencies_hz[3],1e6);
assert.ok(Math.abs(request.frequencies_hz[1]-1e4)<1e-8);
assert.deepEqual(buildACPIRequest({...form,sweep:"list",frequencies:"0, 1000; 10000",load:"short"}).load_impedance_ohm,[0,0]);
assert.deepEqual(buildACPIRequest({...form,load:"complex",load_real:"20",load_imag:"-5"}).load_impedance_ohm,[20,-5]);
const slab = buildACPIRequest({...form,slab:true,width_mm:"1",thickness_um:"35",conductivity:"58000000",bias_real:"2",bias_imag:"-1"}).conductor;
assert.equal(slab.width_m,.001); assert.ok(Math.abs(slab.thickness_m-35e-6)<1e-18); assert.deepEqual(slab.field_bias_ratio,[2,-1]);
for (const patch of [{R:""},{length_mm:"0"},{C_pf:"-1"},{source_real:"-1"},{points:"2.5"},{points:"2049"},{stop:"100"},{start:"0"},{sweep:"list",frequencies:"1000,1000"},{sweep:"list",frequencies:"NaN"},{slab:true},{load:"complex",load_real:""}]) assert.throws(()=>buildACPIRequest({...form,...patch}));
assert.equal(acpiFormat(null),"—"); assert.equal(acpiFormat(Infinity),"—"); assert.equal(acpiFormat(1),"1.0000");
const empty = renderToStaticMarkup(React.createElement(ACPowerIntegrityEffects,{callWorker:async()=>({ok:false,error:"not called during SSR"})}));
assert.match(empty,/Run AC analysis/); assert.match(empty,/<button[^>]*disabled=""/); assert.match(empty,/requires no board/); assert.match(empty,/Load boundary/); assert.doesNotMatch(empty,/textarea[^>]*JSON/);
const ready = renderToStaticMarkup(React.createElement(ACPowerIntegrityEffects,{callWorker:async()=>({ok:false}),initialRequest:request}));
assert.doesNotMatch(ready,/<button[^>]*disabled=""/); assert.match(ready,/Ascending frequencies/);
const chart = renderToStaticMarkup(React.createElement(ACPISampleChart,{frequencies:[1,2,3],series:[{label:"actual",color:"red",values:[1,null,2]}],title:"Gap fixture",unit:"V/V",interactive:false}));
assert.match(chart,/data-series="actual" d="M[^L]+M/); assert.match(chart,/singular samples leave gaps/);
assert.match(chart,/data-frequency-hz="1" data-value="1"/); assert.match(chart,/data-frequency-hz="3" data-value="2"/);
assert.match(chart,/data-spike-plot=/); assert.match(chart,/data-plot-traces/); assert.match(chart,/data-plot-ticks/);
const sample = {frequency_hz:1e3,status:"computed",load_to_source_voltage_gain:1.2,load_to_sending_voltage_gain:1.1,input_impedance_ohm:[3,4],R_ohm_per_m:.1,load_voltage_v_rms:[0,1],denominator_relative_margin:.2};
const html = renderToStaticMarkup(React.createElement(ACPISamplePlots,{result:{contract:"spike/ac-pi-result/v1",model_status:"experimental",source_voltage_v_rms:[1,0],samples:[sample,{frequency_hz:2e3,status:"singular_source_load_resonance"}]}}));
assert.match(html,/Not reported/); assert.doesNotMatch(html,/Reported voltage rise<\/td>/); assert.match(html,/singular_source_load_resonance/); assert.match(html,/5.0000/); assert.match(html,/90.000/);
const rise = renderToStaticMarkup(React.createElement(ACPISamplePlots,{result:{contract:"spike/ac-pi-result/v1",samples:[{...sample,voltage_rise_above_sending:true}]}}));
assert.match(rise,/Reported voltage rise/);
if (process.argv[2]) {
  const actual = JSON.parse(await readFile(process.argv[2],"utf8"));
  assert.equal(actual.contract,"spike/ac-pi-result/v1");
  const rendered = renderToStaticMarkup(React.createElement(ACPowerIntegrityEffects,{callWorker:async()=>({ok:false}),initialRequest:actual.provenance.request,initialResult:actual}));
  assert.match(rendered,/Voltage gain/); assert.match(rendered,/Input impedance phase/);
  if (process.argv[3]) {
    const css = await readFile(new URL("../src/ACPowerIntegrityEffects.css",import.meta.url),"utf8");
    await writeFile(process.argv[3],`<!doctype html><html lang="en"><meta charset="utf-8"><title>Actual AC PI samples</title><style>body{background:#17202d;color:#eef3fc;font:14px sans-serif}input,select,textarea{background:#263548;color:#fff;border:1px solid #62738a}${css}</style>${rendered}</html>`);
  }
  console.log(`Actual backend result rendered: ${actual.samples.length} samples; no solve performed by UI.`);
}
console.log("AC PI UI: SI conversion, explicit loads/slab fields, strict sweep input, restored request, actual samples and singular gaps passed.");
