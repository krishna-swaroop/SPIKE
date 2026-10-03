// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundle=await build({entryPoints:[fileURLToPath(new URL("../src/extensionWorkflowSettings.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"node",external:["react","react-dom","lucide-react","plotly.js-dist-min"],loader:{".css":"empty"}});
let code=bundle.outputFiles[0].text.replaceAll('from "react"',`from ${JSON.stringify(new URL("../node_modules/react/index.js",import.meta.url).href)}`).replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(new URL("../node_modules/react/jsx-runtime.js",import.meta.url).href)}`);
for (const [name,file] of [["react-dom","react-dom/index.js"],["lucide-react","lucide-react/dist/cjs/lucide-react.js"]]) code=code.split(`from "${name}"`).join(`from ${JSON.stringify(new URL("../node_modules/"+file,import.meta.url).href)}`);
const {normalizeEMergeSetup,normalizeOpenEMSSetup}=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const emDefaults=normalizeEMergeSetup(null),openDefaults=normalizeOpenEMSSetup(null);
for(const malformed of [null,undefined,[],false,1,"settings"]) {
  assert.deepEqual(normalizeEMergeSetup(malformed),emDefaults);
  assert.deepEqual(normalizeOpenEMSSetup(malformed),openDefaults);
}
const port={start:["0","1","2"],stop:["0","1","-1"],direction:"z",impedance_ohm:"50",excite:true};
const saved={net_names:["SIG","GND"],ports:[port],boundary_conditions:["MUR","PEC","PMC","PML_1","PML_8","PML_99"],center_mm:["1","2","3"],frequency_start_hz:"1e8",frequency_stop_hz:"1e9",far_field_enabled:true,far_field_frequencies_hz:"1e8, 2e8",unknown:"discard"};
const restored=normalizeOpenEMSSetup(saved);
assert.equal(restored.frequency_start_hz,"1e8"); assert.equal(restored.far_field_enabled,true);
assert.deepEqual(restored.ports,[port]); assert.deepEqual(restored.net_names,["SIG","GND"]);
assert.deepEqual(normalizeOpenEMSSetup(restored),restored,"restoration is idempotent");
assert.ok(!("unknown" in restored));
restored.ports[0].start[0]="99";restored.center_mm[0]="99";restored.net_names.push("OTHER");restored.boundary_conditions[0]="PEC";
assert.equal(saved.ports[0].start[0],"0");assert.equal(saved.center_mm[0],"1");assert.equal(saved.net_names.length,2);assert.equal(saved.boundary_conditions[0],"MUR");
for(const malformed of [null,{},["SIG",null],["SIG","SIG"],[""],["x".repeat(1025)],new Array(4097).fill("SIG")]) assert.deepEqual(normalizeOpenEMSSetup({net_names:malformed}).net_names,[]);
for(const malformed of [null,{},[null],[{...port,start:["0"]}],[{...port,start:[0,"1","2"]}],[{...port,stop:["NaN","1","2"]}],
  [{...port,direction:["z"]}],[{...port,excite:"true"}],[{...port,impedance_ohm:"Infinity"}],new Array(9).fill(port)]) assert.deepEqual(normalizeOpenEMSSetup({ports:malformed}).ports,[],"malformed port lists reset atomically rather than dropping or fabricating ports");
for(const malformed of [null,["PEC"],new Array(6).fill("PML_100"),["PEC","PEC","PEC","PEC","PEC",null]]) assert.deepEqual(normalizeOpenEMSSetup({boundary_conditions:malformed}).boundary_conditions,openDefaults.boundary_conditions);
for(const malformed of [["1"],"1,2,3",[1,2,3],["0","0","Infinity"]]) assert.deepEqual(normalizeOpenEMSSetup({center_mm:malformed}).center_mm,openDefaults.center_mm);
const bad=normalizeOpenEMSSetup({mesh_resolution_mm:{},frequency_points:"2.5",threads:"-1",radius_m:"Infinity",far_field_enabled:"true",theta_points:"99999",max_far_field_samples:0,far_field_frequencies_hz:"NaN"});
for(const key of ["mesh_resolution_mm","frequency_points","threads","radius_m","far_field_enabled","theta_points","max_far_field_samples","far_field_frequencies_hz"]) assert.equal(bad[key],openDefaults[key]);
assert.equal(normalizeOpenEMSSetup({frequency_start_hz:""}).frequency_start_hz,"","unfinished inputs remain explicit and still need run validation");
assert.equal(normalizeOpenEMSSetup({mesh_resolution_mm:"0x10"}).mesh_resolution_mm,openDefaults.mesh_resolution_mm,"saved numeric text must be valid HTML decimal/scientific input");
const emSaved={signal_net:"RF",return_net:"GND",geometry_backend:"emcad",sparse_solver:"superlu",include_dielectric_loss:true,radiation_theta_step_deg:"5",parallel:true,n_workers:"4",python_executable:"C:/python.exe",radome_enabled:true,radome_gap_mm:"20"};
const em=normalizeEMergeSetup(emSaved);
for(const [key,value] of Object.entries(emSaved)) assert.equal(em[key],value);
assert.deepEqual(normalizeEMergeSetup(em),em);
const emBad=normalizeEMergeSetup({signal_net:{},return_net:42,geometry_backend:["emcad"],sparse_solver:"arbitrary",field_excited_port:"9",radiation_theta_step_deg:"7",radiation_phi_step_deg:15,include_dielectric_loss:"yes",nearfield_enabled:[],frequency_points:"NaN",mesh_resolution_mm:null,python_executable:"x".repeat(4097),unknown:"drop"});
for(const key of ["signal_net","return_net","geometry_backend","sparse_solver","field_excited_port","radiation_theta_step_deg","radiation_phi_step_deg","include_dielectric_loss","nearfield_enabled","frequency_points","mesh_resolution_mm","python_executable"]) assert.equal(emBad[key],emDefaults[key]);
assert.ok(!("unknown" in emBad));
const first=normalizeOpenEMSSetup(null);first.center_mm[0]="9";first.boundary_conditions[0]="PEC";first.ports.push(port);
assert.deepEqual(normalizeOpenEMSSetup(null),openDefaults,"fallback arrays are newly allocated per restoration");
console.log("Extension workflow restoration: bounded scalar/enums, tuple/port/net/boundary arrays, atomic fallback, idempotence and no aliasing passed.");
