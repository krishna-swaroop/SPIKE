// SPDX-License-Identifier: Apache-2.0
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { AssemblyAnchor, AssemblyAsset, AssemblyDocument, AssemblyInstance, RigidMatrix, Vec3 } from "./types";

export const identityTransform = (): RigidMatrix => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
export const matrixFromRows = (rows: readonly number[]): Matrix4 => new Matrix4().set(...rows as [number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number]);
export const matrixToRows = (matrix: Matrix4): RigidMatrix => matrix.clone().transpose().toArray();

export function isRigidTransform(rows: unknown): rows is RigidMatrix {
  if (!Array.isArray(rows) || rows.length !== 16 || !rows.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7)) return false;
  if (Math.abs(rows[12])+Math.abs(rows[13])+Math.abs(rows[14])+Math.abs(rows[15]-1) > 1e-8) return false;
  const x = new Vector3(rows[0],rows[4],rows[8]), y = new Vector3(rows[1],rows[5],rows[9]), z = new Vector3(rows[2],rows[6],rows[10]);
  return [x,y,z].every(v => Math.abs(v.lengthSq()-1) < 1e-6)
    && Math.abs(x.dot(y))+Math.abs(x.dot(z))+Math.abs(y.dot(z)) < 1e-6
    && Math.abs(x.clone().cross(y).dot(z)-1) < 1e-6;
}

/** Intrinsic XYZ Euler angles in degrees; UI edits always reconstruct a rigid matrix. */
export function transformFromPose(position: Vec3, rotationDeg: Vec3): RigidMatrix {
  if (![...position,...rotationDeg].every(Number.isFinite)) throw new Error("Placement must be finite.");
  return matrixToRows(new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotationDeg.map(v => v*Math.PI/180) as Vec3,"XYZ")), new Vector3(1,1,1)));
}
export function poseFromTransform(rows: RigidMatrix): { position: Vec3; rotationDeg: Vec3 } {
  if (!isRigidTransform(rows)) throw new Error("Placement must be rigid and right-handed.");
  const matrix=matrixFromRows(rows), euler=new Euler().setFromRotationMatrix(matrix,"XYZ");
  return { position:[rows[3],rows[7],rows[11]], rotationDeg:[euler.x,euler.y,euler.z].map(v=>v*180/Math.PI) as Vec3 };
}
export function worldAnchor(anchor: AssemblyAnchor, instance: AssemblyInstance): { point: Vec3; normal?: Vec3 } {
  const matrix=matrixFromRows(instance.transform);
  return { point:new Vector3(...anchor.point).applyMatrix4(matrix).toArray() as Vec3,
    normal:anchor.normal ? new Vector3(...anchor.normal).transformDirection(matrix).toArray() as Vec3 : undefined };
}

/** One-shot placement, not a persistent kinematic constraint. */
export function snapPlacement(moving: AssemblyInstance, source: AssemblyAnchor, fixed: AssemblyInstance, target: AssemblyAnchor, options: { alignNormals?: boolean; gapMm?: number } = {}): RigidMatrix {
  if (moving.locked) throw new Error("Unlock the moving occurrence before snapping.");
  if (moving.id===fixed.id) throw new Error("Choose a target on a different occurrence.");
  if (source.instanceId!==moving.id || target.instanceId!==fixed.id) throw new Error("Snap anchors do not belong to these occurrences.");
  if (![moving.transform,fixed.transform].every(isRigidTransform)) throw new Error("Snap placements must be rigid.");
  const gap=options.gapMm??0;
  if (!Number.isFinite(gap) || Math.abs(gap)>1e6) throw new Error("Gap must be a finite distance in millimetres.");
  const from=worldAnchor(source,moving), to=worldAnchor(target,fixed), result=matrixFromRows(moving.transform);
  if (options.alignNormals) {
    if (!from.normal || !to.normal) throw new Error("Both anchors need a face or hole normal for alignment.");
    const a=new Vector3(...from.normal), b=new Vector3(...to.normal).negate();
    if (a.lengthSq()<1e-12 || b.lengthSq()<1e-12) throw new Error("Snap normals must be non-zero.");
    result.premultiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(a.normalize(),b.normalize())));
  }
  if (gap && !to.normal) throw new Error("The target needs a normal to define the gap direction.");
  const desired=new Vector3(...to.point).addScaledVector(new Vector3(...(to.normal??[0,0,1])),gap);
  const current=new Vector3(...source.point).applyMatrix4(result);
  result.setPosition(new Vector3().setFromMatrixPosition(result).add(desired.sub(current)));
  return matrixToRows(result);
}

/** Small discoverable set; surface picking supplies arbitrary additional mesh anchors. */
export function assetAnchors(asset: AssemblyAsset, instanceId: string): AssemblyAnchor[] {
  const anchors:AssemblyAnchor[]=[{id:`${instanceId}:origin`,instanceId,label:"Local origin",kind:"origin",point:[0,0,0]}];
  const add=(suffix:string,label:string,kind:AssemblyAnchor["kind"],point:Vec3,normal?:Vec3) => anchors.push({id:`${instanceId}:${suffix}`,instanceId,label,kind,point,normal});
  if (asset.kind==="board") {
    for (const pad of [...asset.board.pads,...asset.board.vias]) {
      if (pad.drill>0 && anchors.length<100) add(`hole:${pad.id}`,`Hole ${"ref" in pad ? pad.ref??"" : "via"} ${"name" in pad ? pad.name : pad.id}`,"hole",[pad.at[0],-pad.at[1],0],[0,0,1]);
    }
    asset.board.outlineLoops.forEach((loop,li)=>loop.forEach((p,i)=> {
      const q=loop[(i+1)%loop.length];
      if (anchors.length<100 && Math.hypot(q[0]-p[0],q[1]-p[1])>1e-9) add(`edge:${li}:${i}`,`Outline ${li+1} edge ${i+1}`,"edge",[(p[0]+q[0])/2,-(p[1]+q[1])/2,0]);
    }));
  } else {
    for (const mesh of asset.meshes) {
      const faces=mesh.faces?.length ? mesh.faces : [{first:0,last:0}];
      for (let i=0;i<faces.length && anchors.length<100;i++) {
        const face=faces[i], start=face.first*3;
        const vertices=[0,1,2].map(n=>new Vector3().fromArray(mesh.positions,mesh.indices[start+n]*3));
        const normal=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
        if (normal.lengthSq()<1e-16) continue;
        const point=vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1/3).toArray() as Vec3;
        add(`face:${mesh.id}:${i}`,`${mesh.name||"Mesh"} face ${i+1} sample`,"face",point,normal.normalize().toArray() as Vec3);
      }
    }
  }
  return anchors;
}

export function replaceInstance(document: AssemblyDocument, id: string, change: Partial<AssemblyInstance>): AssemblyDocument {
  const before=document.instances.find(v=>v.id===id);
  if (!before) throw new Error("Occurrence not found.");
  if (change.transform && before.locked) throw new Error("This occurrence is locked.");
  if (change.transform && !isRigidTransform(change.transform)) throw new Error("Placement must be a rigid matrix.");
  return {...document, instances:document.instances.map(v=>v.id===id ? {...v,...change,id:v.id,assetId:v.assetId} : v)};
}
