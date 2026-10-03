// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { importTestTypescript } from './import-test-typescript.mjs';
const require=createRequire(import.meta.url);
const dependencies=Object.fromEntries(await Promise.all(['mcadAssembly','assemblyBoardDraft','assemblyBoardLifecycle'].map(async name=>[`./${name}`,await importTestTypescript(name)])));
let state=[], cursor=0, effects=[], requests=[], messages=[];
const hooks={useState(initial){const i=cursor++; if(!(i in state))state[i]=typeof initial==='function'?initial():initial; return [state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];},useRef(initial){return{current:initial};},useEffect(fn){effects.push(fn);}};
const code=ts.transpileModule(readFileSync(new URL('../src/AssemblyStructureEditor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};
new Function('require','module','exports',code)(name=>name==='react'?hooks:dependencies[name]?dependencies[name]:name==='./workerBridge'?{runNativeProjectWorker:async request=>{requests.push(request);return{ok:true,result:{}};}}:name==='./connectorPresets'?{}:name==='./icons'?new Proxy({},{get:()=>()=>null}):name.startsWith('./')?{default:()=>null}:require(name),module,module.exports);
const frame=(id,x=0)=>({frame_id:id+'-frame',parent_frame_id:'assembly',transform:[1,0,0,x,0,1,0,0,0,0,1,0,0,0,0,1]});
const boards=[{id:'A',name:'Arduino',design_id:'arduino',frame:frame('A')},{id:'B',name:'Shield',design_id:'shield',frame:frame('B',100)}];
const assembly={contract:'spike/assembly-ir/v1',frame:frame('assembly'),boards,parts:[],harnesses:[{id:'wire',endpoint_a:'A::J1',endpoint_b:'B::J1',pin_map:{1:'1'}}],connector_mappings:[{id:'mate',kind:'connector-mate',data:{endpoint_a:'A::J1',endpoint_b:'B::J1',pin_map:{1:'1'}}}],rigid_flex_links:[]};
const props={projectPath:'test.spike',projectManifestDigest:'a'.repeat(64),assemblyIr:assembly,assemblyDesigns:{active_design_id:'arduino',designs:[{design_id:'arduino',name:'Arduino'},{design_id:'shield',name:'Shield'}]},onUpdated:async()=>{},onStatus:m=>messages.push(m)};
function render(){cursor=0;effects=[];const result=module.exports.default(props);for(const effect of effects)effect();return result;}
function nodes(n){if(!n||typeof n!=='object')return[];return[n,...React.Children.toArray(n.props?.children).flatMap(nodes)];}
function button(label){return nodes(render()).find(n=>n.type==='button'&&(n.props['aria-label']===label||n.props.children===label));}
render();
button('Duplicate Arduino').props.onClick();
assert.equal(state[0].length,3); assert.equal(state[0][2].design_id,'arduino'); assert.notEqual(state[0][2].id,'A');
assert.equal(requests.length,0,'local duplication does not call the importer or worker');
const select=nodes(render()).find(n=>n.props?.['aria-label']==='Local board source');
select.props.onChange({target:{value:'shield'}});
const add=nodes(render()).find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes(' Add local board'));
assert.ok(add); add.props.onClick();
assert.equal(state[0].length,4); assert.equal(state[0][3].design_id,'shield');
button('Remove Arduino').props.onClick();
assert.equal(state[0].length,3); assert.equal(state[1].length,0); assert.equal(state[3].length,0,'removal prunes explicit mate together with its board');
assert.ok(messages.at(-1).includes('2 dependent link'));
await button('Save boards and links').props.onClick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(requests.length,1);assert.equal(requests[0].method,'update_assembly_structure_in_project');
assert.equal(requests[0].params.boards.length,3);assert.deepEqual(requests[0].params.harnesses,[]);assert.deepEqual(requests[0].params.connector_mappings,[]);
button('Reset draft').props.onClick(); render(); render();
assert.deepEqual(state[0],boards);assert.equal(state[1].length,1);assert.equal(state[3].length,1);
console.log('Board editor: local add/duplicate/remove, atomic save payload and draft reset passed');
