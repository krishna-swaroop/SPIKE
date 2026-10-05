// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { importTestTypescript } from "./import-test-typescript.mjs";
const api = await importTestTypescript("assemblyBoardManagerModel");
const presentation = await importTestTypescript("assemblyManagerPresentation");
const designs = { contract:"spike/assembly-designs/v1", active_design_id:"d", designs:[{ contract:"spike/design-ir/v2", design_id:"d", nets:[{id:"n1",name:"GND"},{id:"n2",name:"SIG"}], materials:[{id:"mat-cu",name:"Copper",properties:{conductivity_s_per_m:5.8e7}},{id:"mat-fr4",name:"FR-4",properties:{relative_permittivity:4.2}}], layers:[{id:"F.Cu",layer_type:"copper",thickness_mm:0.035,material_id:"mat-cu",z_mm:0,extensions:{"spike.v1.stackup":{name:"F.Cu",thickness:0.035,type:"Top Copper"}}},{id:"dielectric-1",layer_type:"dielectric",thickness_mm:1.53,material_id:"mat-fr4",z_mm:-0.8,extensions:{"spike.v1.stackup":{name:"Core",thickness:1.53,type:"Core"}}}] }] };
const assembly = { contract:"spike/assembly-ir/v1", assembly_id:"a", name:"A", parts:[], boards:[{id:"left",name:"Left",design_id:"d"},{id:"right",name:"Right",design_id:"d"}], harnesses:[{id:"h1",endpoint_a:"left::J1",endpoint_b:"right::J1",pin_map:{"1":"1","2":"2"}}], connector_mappings:[
  {id:"left-j1",kind:"connector",data:{board_id:"left",connector_id:"J1",pins:{"1":"n1","2":"n2"}}},
  {id:"right-j1",kind:"connector",data:{board_id:"right",connector_id:"J1",pins:{"1":"n1","2":"n2"}}}
] };
const nets = api.netOccurrences(assembly, designs);
assert.equal(nets.length, 4);
assert.deepEqual(nets.filter(n=>n.name==="GND").map(n=>n.occurrenceId), ["left::n1","right::n1"], "repeated names remain separate occurrences");
assert.deepEqual(api.layerOccurrences(assembly, designs).map(x=>x.occurrenceId), ["left::F.Cu","left::dielectric-1","right::F.Cu","right::dielectric-1"]);
const canonicalLayers=api.layerOccurrences(assembly,designs).filter(x=>x.boardId==="left");
assert.deepEqual(canonicalLayers.map(x=>({name:x.name,kind:x.kind,material:x.material})),[{name:"F.Cu",kind:"copper",material:"Copper"},{name:"Core",kind:"dielectric",material:"FR-4"}],"canonical layer types, extension names and material records drive the manager");
const distinctDesigns={...designs,designs:[...designs.designs,{...designs.designs[0],design_id:"daughter",layers:[{id:"In1.Cu",layer_type:"copper",material_id:"mat-cu",thickness_mm:0.035,extensions:{"spike.v1.stackup":{name:"In1.Cu",type:"Inner Copper"}}}]}]};
const distinctAssembly={...assembly,boards:[assembly.boards[0],{...assembly.boards[1],design_id:"daughter"}]};
const distinctLayers=api.layerOccurrences(distinctAssembly,distinctDesigns);
assert.deepEqual(distinctLayers.map(x=>x.occurrenceId),["left::F.Cu","left::dielectric-1","right::In1.Cu"],"each occurrence uses its retained canonical design layers");
assert.deepEqual({material:distinctLayers[2].material,thicknessMm:distinctLayers[2].thicknessMm},{material:"Copper",thicknessMm:0.035});
assert.equal(api.connectorOccurrences(assembly, designs)[0].pins[0].net.occurrenceId, "left::n1");
assert.equal(api.explicitNetLinkRows(assembly).length, 2, "only persisted harness pin maps produce initial links");
const linked = api.applyExplicitNetLink(assembly, { id:"mate-1", endpointA:"left::J1",pinA:"2",endpointB:"right::J1",pinB:"2",applied:false });
assert.deepEqual(linked.connector_mappings.at(-1).data, {endpoint_a:"left::J1",endpoint_b:"right::J1",pin_map:{"2":"2"}});
assert.equal(api.explicitNetLinkRows(linked).length, 3);
api.validateExplicitNetLink(assembly,designs,{id:"ok",endpointA:"left::J1",pinA:"2",endpointB:"right::J1",pinB:"2",applied:false});
assert.throws(()=>api.validateExplicitNetLink(assembly,designs,{id:"stale",endpointA:"left::J1",pinA:"99",endpointB:"right::J1",pinB:"2",applied:false}),/stale pin/);
const harnessRow = api.explicitNetLinkRows(assembly)[0];
assert.deepEqual(api.removeExplicitNetLink(assembly,harnessRow).harnesses[0].pin_map,{"2":"2"});
const edited = api.replaceExplicitNetLink(assembly,harnessRow,{...harnessRow,pinB:"2"});
assert.deepEqual(edited.harnesses[0].pin_map,{"1":"2","2":"2"});
const multiMate = {...assembly,connector_mappings:[...assembly.connector_mappings,{id:"m",kind:"connector-mate",data:{endpoint_a:"left::J1",endpoint_b:"right::J1",pin_map:{"1":"1","2":"2"}}}]};
const mateRow = api.explicitNetLinkRows(multiMate).find(row=>row.sourceKind==="connector-mate" && row.pinA==="1");
const editedMate = api.replaceExplicitNetLink(multiMate,mateRow,{...mateRow,pinB:"2"});
assert.equal(editedMate.connector_mappings.filter(row=>row.id==="m").length,1,"editing keeps one source mate");
assert.deepEqual(editedMate.connector_mappings.find(row=>row.id==="m").data.pin_map,{"1":"2","2":"2"},"editing preserves other mate pins");
const removedMatePin = api.removeExplicitNetLink(multiMate,mateRow);
assert.deepEqual(removedMatePin.connector_mappings.find(row=>row.id==="m").data.pin_map,{"2":"2"},"removing one row preserves other mate pins");
assert.throws(()=>api.applyExplicitNetLink(assembly,{id:"bad",endpointA:"left::J1",pinA:"",endpointB:"right::J1",pinB:"2",applied:false}),/Choose two distinct/);
const detailedDesign={...designs.designs[0],layers:[
  {id:'front',name:'F.Cu',layer_type:'copper',thickness_mm:0.035},
  {id:'core',name:'Core',layer_type:'dielectric',thickness_mm:1.53,material_id:'mat-fr4'},
  {id:'inner',name:'In1.Cu',layer_type:'copper',thickness_mm:0.035},
  {id:'back',name:'B.Cu',layer_type:'copper',thickness_mm:0.035},
  {id:'mask',name:'F.Mask',layer_type:'user'},
],tracks:[{net_id:'n1',layer_id:'front'}],arcs:[{net_id:'n1',layer_id:'back'}],vias:[{net_id:'n1',start_layer_id:'back',end_layer_id:'front'}],
 pads:[{net_id:'n1',layer_ids:['front','mask'],component_id:'C1'},{net_id:'n1',layer_ids:['front'],component_id:'C1'}],zones:[{net_id:'n1',layer_ids:['inner']}],};
const detailed= presentation.assemblyManagerPresentation(assembly,{...designs,designs:[detailedDesign]},'right');
assert.equal(detailed.definitions.some(layer=>layer.name==='Core'),false,'a dielectric stack row must not get drawable visibility controls');
assert.deepEqual(detailed.stackup.map(layer=>layer.name),['F.Cu','Core','In1.Cu','B.Cu']);
assert.equal(detailed.stackup[1].epsilonR,4.2,'physical material properties survive the manager projection');
assert.deepEqual(detailed.catalog.find(net=>net.id==='n1').metrics,{tracks:2,vias:1,pads:2,zones:1,parts:1,layers:3},'one net counts copper arcs, full reversed via spans, pads and distinct parts');
assert.deepEqual(detailed.catalog.find(net=>net.id==='n2').metrics,{tracks:0,vias:0,pads:0,zones:0,parts:0,layers:0},'another net does not inherit counts from a name or other occurrence');
const missing=presentation.assemblyManagerPresentation(assembly,designs,'left').catalog[0];
assert.equal(missing.metrics.tracks,null,'missing retained collections must not be reported as zero objects');
assert.deepEqual(presentation.assemblyManagerPresentation(assembly,designs,'absent').catalog,[]);
assert.equal(presentation.managerDefaultLayerVisible('F.Cu'),true);assert.equal(presentation.managerDefaultLayerVisible('F.Paste'),false);
console.log("Assembly board scoped layers, canonical net occurrences, and explicit links passed");

const collisionDesigns = {...designs, designs:[{...designs.designs[0], nets:[{id:"n1",name:"SIG"},{id:"n2",name:"n1"}]}]};
assert.equal(api.connectorOccurrences(assembly, collisionDesigns)[0].pins[0].net.netId,"n1","canonical identity takes precedence over another net's name");
const unresolved = {...assembly, connector_mappings:assembly.connector_mappings.map(row=>({...row,data:{...row.data,pins:{"1":"missing"}}}))};
assert.throws(()=>api.validateExplicitNetLink(unresolved,designs,{id:"bad",endpointA:"left::J1",pinA:"1",endpointB:"right::J1",pinB:"1",applied:false}),/net/i,"unresolved pins cannot be saved as electrical links");

assert.throws(()=>api.replaceExplicitNetLink(assembly,harnessRow,{...harnessRow,pinA:"2"}),/already has a mapping/,"editing cannot overwrite another saved harness pin");
assert.throws(()=>api.replaceExplicitNetLink(multiMate,mateRow,{...mateRow,pinA:"2"}),/already has a mapping/,"editing cannot overwrite another saved mate pin");
