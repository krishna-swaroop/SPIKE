// SPDX-License-Identifier: Apache-2.0
import type { AssemblyAsset, AssemblyDocument } from "./types";
import { isRigidTransform } from "./placement";
import { validateVirtualLayers } from "../overlays/validation";

export const ASSEMBLY_LIMITS = { assets:64, instances:128, vertices:500_000, triangles:1_000_000, renderedVertices:2_000_000, boardItems:100_000, jsonBytes:64*1024*1024 } as const;
type RecordValue = Record<string, any>;
function fail(message:string):never { throw new Error(message); }
function record(value:unknown,label:string):RecordValue {
  if (!value || typeof value!=="object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as RecordValue;
}
function text(value:unknown,label:string): asserts value is string {
  if (typeof value!=="string" || !value.trim() || value.length>1000) fail(`${label} must be 1–1000 characters.`);
}
function number(value:unknown,label:string,min=-1e7,max=1e7): asserts value is number {
  if (typeof value!=="number" || !Number.isFinite(value) || value<min || value>max) fail(`${label} is outside the supported numeric range.`);
}
function list(value:unknown,label:string,max:number=ASSEMBLY_LIMITS.boardItems): asserts value is any[] {
  if (!Array.isArray(value) || value.length>max) fail(`${label} must be an array of at most ${max} entries.`);
}
function vector(value:unknown,label:string,length=3) {
  if (!Array.isArray(value) || value.length!==length) fail(`${label} requires ${length} coordinates.`);
  value.forEach(v=>number(v,label));
}
function unique(values:any[],label:string) {
  const ids=new Set<string>();
  for (const v of values) { record(v,label); text(v.id,`${label} ID`); if(ids.has(v.id)) fail(`Duplicate ${label} ID: ${v.id}`); ids.add(v.id); }
}
/** Reject URLs before data can reach any renderer. Native source model paths remain inert metadata. */
function inspectTree(value:unknown,depth=0,budget={count:0}) {
  if (++budget.count>12_000_000 || depth>24) fail("Assembly nesting or data budget exceeded.");
  if (typeof value==="number") number(value,"Assembly value");
  else if (typeof value==="string" && value.length>10_000) fail("Assembly text is too long.");
  else if (value && typeof value==="object") for (const [key,child] of Object.entries(value)) {
    if (["__proto__","constructor","prototype"].includes(key)) fail("Unsupported assembly property.");
    if (/url(s)?$/i.test(key) && child!=null && child!=="" && !(Array.isArray(child)&&!child.length)) fail("External model/layer URLs are not supported in portable assemblies. Import the geometry instead.");
    inspectTree(child,depth+1,budget);
  }
}
function validateBoard(board:unknown):number {
  const b=record(board,"Board");
  number(b.width,"Board width",0.001,1e6); number(b.height,"Board height",0.001,1e6);
  const bounds=record(b.bounds,"Board bounds");
  for(const key of ["minX","maxX","minY","maxY"]) number(bounds[key],`Board ${key}`);
  if(bounds.minX>=bounds.maxX || bounds.minY>=bounds.maxY) fail("Board bounds must have positive area.");
  for(const key of ["outlineLoops","tracks","pads","vias","components","zones","drawings","layers","layerDefinitions","stackup"]) list(b[key],`Board ${key}`);
  if(!b.outlineLoops.length) fail("Board needs an outline.");
  b.outlineLoops.forEach((loop:unknown)=> { list(loop,"Outline points"); if(loop.length<3) fail("Outline needs at least three points."); loop.forEach(p=>vector(p,"Outline point",2)); });
  b.layers.forEach((layer:unknown)=>text(layer,"Layer name")); record(b.nets,"Board nets");
  b.layerDefinitions.forEach((value:unknown)=> { const layer=record(value,"Layer");number(layer.id,"Layer ID");text(layer.name,"Layer name");text(layer.kind,"Layer kind"); });
  b.stackup.forEach((value:unknown)=> { const layer=record(value,"Stackup");text(layer.name,"Stackup name");text(layer.type,"Stackup type");if(layer.thickness!==undefined)number(layer.thickness,"Thickness",0,1e4); });
  let count=0;
  for(const key of ["tracks","pads","vias","components","zones","drawings"]) {
    count+=b[key].length; unique(b[key],`Board ${key}`);
    for(const item of b[key]) {
      if(key!=="vias") text(item.layer,"Object layer");
      if(key==="tracks") { vector(item.start,"Track start",2);vector(item.end,"Track end",2);number(item.width,"Track width",0,1e4); }
      if(key==="pads" || key==="vias" || key==="components") vector(item.at,"Object position",2);
      if(key==="pads" || key==="vias") { number(item.drill,"Drill",0,1e4);list(item.layers,"Object layers",100);item.layers.forEach((v:unknown)=>text(v,"Object layer")); }
      if(key==="vias") number(item.size,"Via size",0,1e4);
      if(key==="pads" || key==="components") { number(item.width,"Object width",0,1e4);number(item.height,"Object height",0,1e4);number(item.rotation,"Object rotation"); }
      if(key==="pads") { text(item.shape,"Pad shape");if(item.customPolygon) {list(item.customPolygon,"Custom pad");item.customPolygon.forEach((v:unknown)=>vector(v,"Pad point",2));} }
      if(key==="components") { text(item.ref,"Reference");for(const key of ["modelOffset","modelScale","modelRotation"]) vector(item[key],key); }
      if(key==="zones" || key==="drawings") { list(item.points,"Polygon");item.points.forEach((v:unknown)=>vector(v,"Polygon point",2)); }
      if(key==="zones" && item.holes) { list(item.holes,"Zone holes");item.holes.forEach((hole:unknown)=> {list(hole,"Zone hole");hole.forEach(p=>vector(p,"Hole point",2));}); }
      if(key==="drawings") { if(!["line","arc","circle","poly","rect"].includes(item.type)) fail("Unsupported drawing type.");number(item.width,"Drawing width",0,1e4); }
    }
  }
  if(count>ASSEMBLY_LIMITS.boardItems) fail("Board item limit exceeded.");
  return count;
}

export function validateAssemblyDocument(input:unknown): AssemblyDocument {
  inspectTree(input);
  const doc=record(input,"Assembly");
  if(doc.schema!=="spike-viewer/assembly/v1" || doc.units!=="mm") fail("Expected spike-viewer/assembly/v1 with millimetre units.");
  text(doc.name,"Assembly name"); list(doc.assets,"Assets",ASSEMBLY_LIMITS.assets);list(doc.instances,"Occurrences",ASSEMBLY_LIMITS.instances);
  unique(doc.assets,"asset");unique(doc.instances,"occurrence");
  let vertices=0,triangles=0;
  const cost=new Map<string,number>();
  for(const asset of doc.assets) {
    text(asset.name,"Asset name");
    if(asset.kind==="board") {
      const items=validateBoard(asset.board);cost.set(asset.id,Math.max(100,items*24));
      const binding=record(asset.binding,"Board binding");text(binding.boardId,"Board ID");text(binding.revision,"Board revision");
      if(asset.layers) validateVirtualLayers(asset.layers,binding as {boardId:string;revision:string});
    } else if(asset.kind==="mechanical") {
      const source=record(asset.source,"Mechanical source");text(source.fileName,"File name");text(source.format,"Source format");text(source.unit,"Source unit");
      list(asset.meshes,"Meshes",2000);if(!asset.meshes.length) fail("Mechanical asset contains no meshes.");unique(asset.meshes,"mesh");
      let assetVertices=0;
      for(const mesh of asset.meshes) {
        text(mesh.name,"Mesh name");list(mesh.positions,"Mesh positions",ASSEMBLY_LIMITS.vertices*3);list(mesh.indices,"Mesh indices",ASSEMBLY_LIMITS.triangles*3);
        if(!mesh.positions.length || mesh.positions.length%3 || !mesh.indices.length || mesh.indices.length%3) fail("Mesh arrays require complete vertices and triangles.");
        const n=mesh.positions.length/3,t=mesh.indices.length/3;vertices+=n;assetVertices+=n;triangles+=t;
        mesh.positions.forEach((v:unknown)=>number(v,"Mesh coordinate"));
        if(!mesh.indices.every((i:unknown)=>Number.isInteger(i) && (i as number)>=0 && (i as number)<n)) fail("Mesh index is outside the vertex array.");
        if(mesh.normals) {list(mesh.normals,"Mesh normals",ASSEMBLY_LIMITS.vertices*3);if(mesh.normals.length!==mesh.positions.length) fail("Normal count differs from positions.");mesh.normals.forEach((v:unknown)=>number(v,"Normal",-1,1));}
        if(mesh.color) {vector(mesh.color,"Mesh color");mesh.color.forEach((v:unknown)=>number(v,"Color",0,1));}
        if(mesh.faces) {list(mesh.faces,"Mesh faces",ASSEMBLY_LIMITS.triangles);for(const face of mesh.faces) {record(face,"Mesh face");if(!Number.isInteger(face.first)||!Number.isInteger(face.last)||face.first<0||face.last<face.first||face.last>=t)fail("Mesh face triangle range is invalid.");if(face.color){vector(face.color,"Face color");face.color.forEach((v:unknown)=>number(v,"Color",0,1));}}}
      }
      cost.set(asset.id,assetVertices);
    } else fail("Unknown assembly asset kind.");
  }
  if(vertices>ASSEMBLY_LIMITS.vertices || triangles>ASSEMBLY_LIMITS.triangles) fail("Assembly mesh budget exceeded.");
  let rendered=0;
  for(const instance of doc.instances) {
    text(instance.name,"Occurrence name");if(!cost.has(instance.assetId)) fail("Occurrence refers to a missing asset.");
    if(!isRigidTransform(instance.transform)) fail("Occurrence transform must be rigid and right-handed; scale and reflection belong in the import adapter.");
    if(typeof instance.visible!=="boolean" || typeof instance.locked!=="boolean") fail("Occurrence visibility and locking must be booleans.");
    number(instance.opacity,"Opacity",0,1);rendered+=cost.get(instance.assetId)!;
  }
  if(rendered>ASSEMBLY_LIMITS.renderedVertices) fail("Assembly occurrence geometry budget exceeded.");
  return input as AssemblyDocument;
}

export function validateAssemblyAsset(asset:unknown):AssemblyAsset {
  return validateAssemblyDocument({schema:"spike-viewer/assembly/v1",name:"Import",units:"mm",assets:[asset],instances:[]}).assets[0];
}
