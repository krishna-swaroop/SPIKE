// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { assetAnchors, identityTransform, isRigidTransform, matrixFromRows, poseFromTransform, replaceInstance, snapPlacement, transformFromPose, worldAnchor } from "../src/assembly/placement";
import { validateAssemblyDocument } from "../src/assembly/validation";
import { parseAssemblyProject, serializeAssemblyProject } from "../adapters/projectFile";
import { assemblyFixture } from "../demo/assemblyFixture";
import type { AssemblyAnchor, AssemblyInstance } from "../src/assembly/types";

const instance=(id:string):AssemblyInstance=>({id,assetId:"a",name:id,transform:identityTransform(),visible:true,locked:false,opacity:1});
const near=(a:number[],b:number[],eps=1e-8)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<eps),`${a} != ${b}`);

test("row-major placement uses mm and intrinsic XYZ degrees, rejects reflections and scale",()=> {
  const matrix=transformFromPose([10,20,30],[0,0,90]);
  near(new Vector3(1,0,0).applyMatrix4(matrixFromRows(matrix)).toArray(),[10,21,30]);
  assert.ok(isRigidTransform(matrix));near(poseFromTransform(matrix).position,[10,20,30]);
  const reflection=identityTransform();reflection[0]=-1;assert.equal(isRigidTransform(reflection),false);
  reflection[0]=2;assert.equal(isRigidTransform(reflection),false);
  reflection[0]=NaN;assert.equal(isRigidTransform(reflection),false);
});

test("hole snap under different rotations aligns source points without changing source geometry",()=>{
  const doc=assemblyFixture(),a=doc.instances[0],b=doc.instances[1];
  a.transform=transformFromPose([4,-10,15],[20,10,42]);b.transform=transformFromPose([-9,2,3],[0,50,-15]);
  const source=assetAnchors(doc.assets[0],a.id).find(a=>a.kind==="hole")!,target=assetAnchors(doc.assets[0],b.id).filter(a=>a.kind==="hole")[2];
  const original=JSON.stringify(doc.assets);
  const matrix=snapPlacement(a,source,b,target);
  near(worldAnchor(source,{...a,transform:matrix}).point,worldAnchor(target,b).point);
  near(matrix.slice(0,3),a.transform.slice(0,3));assert.equal(JSON.stringify(doc.assets),original);assert.ok(isRigidTransform(matrix));
});

test("opposed normals snap gives requested world gap and remains rigid",()=>{
  const a=instance("a"),b=instance("b");a.transform=transformFromPose([25,1,-9],[25,40,12]);b.transform=transformFromPose([8,19,5],[0,60,25]);
  const source:AssemblyAnchor={id:"s",instanceId:"a",label:"face",kind:"face",point:[3,7,9],normal:[0,0,1]};
  const target:AssemblyAnchor={id:"t",instanceId:"b",label:"face",kind:"face",point:[-5,2,4],normal:[0,0,1]};
  const matrix=snapPlacement(a,source,b,target,{alignNormals:true,gapMm:2.5}),from=worldAnchor(source,{...a,transform:matrix}),to=worldAnchor(target,b);
  near(from.point,to.point.map((v,i)=>v+2.5*to.normal![i]));near(from.normal!,to.normal!.map(v=>-v));assert.ok(isRigidTransform(matrix));
  assert.throws(()=>snapPlacement({...a,locked:true},source,b,target),/Unlock/);
  assert.throws(()=>snapPlacement(a,source,a,{...target,instanceId:a.id}),/different occurrence/);
  assert.throws(()=>snapPlacement(a,source,b,{...target,normal:undefined},{gapMm:1}),/normal/);
});

test("assembly round-trip preserves occurrence poses, geometry, units, locks and virtual metadata",()=>{
  const doc=assemblyFixture();doc.instances[1].opacity=.3;doc.instances[1].visible=false;
  const loaded=parseAssemblyProject(serializeAssemblyProject(doc));assert.deepEqual(loaded,doc);assert.notEqual(loaded,doc);
  const updated=replaceInstance(loaded,"controller-b",{transform:transformFromPose([1,2,3],[12,23,34])});
  assert.deepEqual(loaded,doc);assert.deepEqual(updated.assets,doc.assets);
  assert.throws(()=>replaceInstance(doc,"base",{transform:identityTransform()}),/locked/);
});

test("admission rejects corrupt meshes, missing references, stale layers, URL fetches and invalid boards",()=>{
  const corrupt=(mutate:(doc:any)=>void)=> {const doc=assemblyFixture();mutate(doc);return ()=>validateAssemblyDocument(doc);};
  assert.throws(corrupt(d=>d.assets[1].meshes[0].indices[0]=999999),/index/);
  assert.throws(corrupt(d=>d.instances[0].assetId="missing"),/missing asset/);
  assert.throws(corrupt(d=>d.instances.push({...d.instances[0]})),/Duplicate/);
  assert.throws(corrupt(d=>d.assets[0].layers[0].binding.revision="stale"),/revision/);
  assert.throws(corrupt(d=>d.assets[0].board.boardModelUrl="https://example.com/board.glb"),/URL/);
  assert.throws(corrupt(d=>d.assets[0].board.outlineLoops=[[[1,2]]]),/three points/);
  assert.throws(corrupt(d=>d.assets[1].meshes[0].positions[0]=Infinity),/numeric/);
  assert.throws(()=>parseAssemblyProject("{}"),/assembly\/v1/);
});
