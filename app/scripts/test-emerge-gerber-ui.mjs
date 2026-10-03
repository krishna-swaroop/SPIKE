// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { spawnSync } from 'node:child_process';
const entry = `export * from './emergeGerberSource'; export {defaultEMergeSetup, emergeParameters, EMergeSetupForm} from './EMergeExtension'; export {default as EMergeGerberImport} from './EMergeGerberImport'; export {parseNormalizedBoard} from './normalizedBoard';`;
const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['react','react/jsx-runtime','react-dom','lucide-react','plotly.js-dist-min'], loader: {'.css':'empty'} });
let code = bundle.outputFiles[0].text;
for (const [name, file] of [['react/jsx-runtime','react/jsx-runtime.js'],['react','react/index.js'],['react-dom','react-dom/index.js'],['lucide-react','lucide-react/dist/cjs/lucide-react.js']]) code = code.split(`from "${name}"`).join(`from ${JSON.stringify(new URL('../node_modules/'+file, import.meta.url).href)}`);
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const draft = api.newGerberDraft();
// Independently authored input bytes. The GUI does not parse copper commands.
const raw = '\uFEFFG04 Original fixture*\r\n%FSLAX46Y46*%\r\n%MOMM*%\r\nM02*\r\n';
draft.layers = [{file_name:'original-front-with-long-name.gtl',content:raw},{file_name:'original-back.gbl',content:'G04 Back*\nM02*\n'}];
const source = api.gerberSourceFromDraft(draft), before = JSON.stringify(source);
assert.equal(source.layers[0].content, raw, 'preserve BOM and original CRLF bytes');
assert.deepEqual(api.gerberSourceFromDraft(api.gerberDraftFromSource(source)), source, 'portable source export/open round trip');
const snapshot = {contract:'spike/design-snapshot/v1', design:{contract:'spike/v1',source_format:'emerge-gerber',metadata:{emerge_gerber_source:source}}};
assert.deepEqual(api.activeGerberSource(' \n'+JSON.stringify(snapshot)), source);
assert.equal(api.activeGerberSource(JSON.stringify({...snapshot,design:{...snapshot.design,source_format:'kicad'}})),null, 'native geometry cannot be inferred from filename/artwork');
const updated = api.activeGerberSource(JSON.stringify(snapshot), [{name:'F.Cu'},{name:'Core',type:'core',thickness:.8,epsilon_r:2.3,loss_tangent:.02},{name:'B.Cu'}]);
assert.deepEqual(updated.dielectrics,[{thickness_mm:.8,epsilon_r:2.3,loss_tangent:.02}], 'current material-manager assignments control subsequent source export');
assert.equal(JSON.stringify(source), before, 'material overlays preserve imported evidence');
const prepared = spawnSync('python', ['-X','utf8','-c', 'import json,sys; from extensions.emerge_suite.gerber_source import snapshot_from_source; print(json.dumps(snapshot_from_source(json.load(sys.stdin))))'], {cwd:fileURLToPath(new URL('../..',import.meta.url)),input:JSON.stringify(source),encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
const nativeSnapshot = JSON.parse(prepared.stdout), board = api.parseNormalizedBoard(JSON.stringify(nativeSnapshot));
assert.equal(board.width,20); assert.equal(board.height,20);
assert.deepEqual(board.layers,['F.Cu','B.Cu']);
for (const collection of ['tracks','pads','vias','zones']) assert.equal(board[collection].length,0,'declared bounds view must not invent Gerber copper');
assert.equal(board.stackup[1].epsilon_r,4.2,'backend snapshot reaches the GUI material manager');
assert.equal(api.activeGerberSource(JSON.stringify(nativeSnapshot)).layers[0].content,raw);
assert.equal(api.validateGerberSource({...source,layers:[{...source.layers[0],file_name:'RF board (\u00e9t\u00e9)-F_Cu.gbr'},source.layers[1]]}).layers[0].file_name,'RF board (\u00e9t\u00e9)-F_Cu.gbr');
for (const malformed of [
  {...source,contract:'spike/emerge-gerber-source/v2'}, {...source,bounds_mm:[0,0,0,20]},
  {...source,layers:[{...source.layers[0],content:'x'.repeat(512*1024+1)},source.layers[1]]},
  {...source,layers:[{...source.layers[0],file_name:'../unsafe.gbr'},source.layers[1]]},
  ...['front:stream.gbr','CON.gbr','COM\u00b9.gbr','front.gbr.'].map(file_name=>({...source,layers:[{...source.layers[0],file_name},source.layers[1]]})),
  {...source,layers:[{...source.layers[0],name:'B.Cu'},source.layers[1]]},
  {...source,ports:[{...source.ports[0],x_mm:NaN}]}, {...source,ports:[{...source.ports[0],signal_layer:'B.Cu',return_layer:'F.Cu'}]},
  {...source,ports:[{...source.ports[0],x_mm:0,width_mm:1}]},
  {...source,ports:[source.ports[0],{...source.ports[0],id:'P2',width_mm:2}]}, {...source,dielectrics:[]}
]) assert.throws(()=>api.validateGerberSource(malformed));
const unfinished = {...draft,bounds:['','','20','20']};
assert.throws(()=>api.gerberSourceFromDraft(unfinished),'blank coordinates cannot be silently converted to zero');
assert.throws(()=>api.emergeParameters(api.defaultEMergeSetup()),/nets are required/, 'KiCad port admission remains required');
const params = api.emergeParameters({...api.defaultEMergeSetup(),geometry_backend:'emcad'},'gerber');
assert.equal(params.geometry_source,'gerber'); assert.equal(params.geometry_backend,'emerge');
assert.equal(params.frequency_points,21, 'native Gerber keeps the existing RF sweep controls');
const html = renderToStaticMarkup(React.createElement(api.EMergeGerberImport,{source,runtime:{gerber_available:false,gerber_reason:'Install the optional Gerber extra.'},onImport:async()=>{},onClose(){}}));
for (const text of ['Native EMerge Gerber study','Open source package','Export source package','Original files and setup','Explicit vertical port planes','F.Cu','B.Cu','Install the optional Gerber extra.','Excellon drill sources']) assert.ok(html.includes(text), text);
assert.ok(html.includes('aria-modal="true"'));
assert.ok(renderToStaticMarkup(React.createElement(api.EMergeGerberImport,{source,disabled:true,onImport:async()=>{},onClose(){}})).includes('disabled=""'),'pending/runtime locks disable import controls');
const form = renderToStaticMarkup(React.createElement(api.EMergeSetupForm,{value:api.defaultEMergeSetup(),onChange(){},gerberSource:source,onOpenGerber(){}}));
assert.ok(form.includes('Active native Gerber source'));
assert.ok(form.includes('Check the EMerge runtime'));
const blocked = renderToStaticMarkup(React.createElement(api.EMergeSetupForm,{value:api.defaultEMergeSetup(),onChange(){},gerberSource:{...source,drills:[{file_name:'board.drl',content:'M48\nM30\n'}]}}));
assert.ok(blocked.includes('blocked before meshing or solving'));
assert.match(form,/class="emerge-board-terminals" disabled="" hidden=""/, 'native source does not request invented KiCad pad identities');
assert.equal(JSON.stringify(source),before);
console.log('Native Gerber UI source preservation, material assignments, format/resource/port admission, KiCad coexistence and pending-state checks passed.');
