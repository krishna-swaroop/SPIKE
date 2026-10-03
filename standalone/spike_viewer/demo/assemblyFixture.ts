// SPDX-License-Identifier: Apache-2.0
import { BoxGeometry } from "three";
import { board, binding, demoLayers } from "./fixture";
import { transformFromPose } from "../src/assembly/placement";
import type { AssemblyDocument, AssemblyMesh } from "../src/assembly/types";

/** Original illustrative geometry, not a manufactured or solved assembly. */
export function assemblyFixture():AssemblyDocument {
  const shape=new BoxGeometry(145,90,4);shape.translate(0,0,-12);
  const mesh:AssemblyMesh={id:"base-mesh",name:"Mounting plate",positions:Array.from(shape.attributes.position.array),normals:Array.from(shape.attributes.normal.array),indices:Array.from(shape.index!.array),color:[.32,.42,.49],faces:shape.groups.map(g=>({first:g.start/3,last:(g.start+g.count)/3-1}))};shape.dispose();
  return {schema:"spike-viewer/assembly/v1",name:"Board assembly study",units:"mm",
    assets:[{id:"demo-board",name:"Controller board",kind:"board",board:structuredClone(board),binding:{...binding},layers:demoLayers()},
      {id:"demo-plate",name:"Mounting plate",kind:"mechanical",meshes:[mesh],source:{fileName:"original-demo",format:"procedural",unit:"mm",notes:["Original illustrative geometry; no STEP file or solver was used for this plate."]}}],
    instances:[{id:"controller-a",assetId:"demo-board",name:"Controller · lower",transform:transformFromPose([-60,51,0],[0,0,0]),visible:true,locked:false,opacity:1},
      {id:"controller-b",assetId:"demo-board",name:"Controller · upper",transform:transformFromPose([-55,47,24],[0,0,8]),visible:true,locked:false,opacity:1},
      {id:"base",assetId:"demo-plate",name:"Mounting plate · fixed",transform:transformFromPose([0,0,0],[0,0,0]),visible:true,locked:true,opacity:1}]};
}
