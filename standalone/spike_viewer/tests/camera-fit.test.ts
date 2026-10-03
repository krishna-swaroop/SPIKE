// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { perspectiveFitDistance } from "../src/assembly/cameraFit";

test("Fit contains the assembly bounding sphere on portrait and landscape screens",()=>{
  const radius=60;
  for(const aspect of [390/573,844/184,1,0.25]) {
    const camera=new PerspectiveCamera(45,aspect,0.01,10000);
    camera.position.z=perspectiveFitDistance(radius,camera.fov,aspect);
    camera.lookAt(0,0,0);camera.updateMatrixWorld();
    for(let latitude=0;latitude<=Math.PI;latitude+=Math.PI/36) {
      for(let longitude=0;longitude<2*Math.PI;longitude+=Math.PI/36) {
        const point=new Vector3(radius*Math.sin(latitude)*Math.cos(longitude),radius*Math.sin(latitude)*Math.sin(longitude),radius*Math.cos(latitude)).project(camera);
        assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1&&point.z<1&&point.z>-1,`sphere clipped at aspect ${aspect}`);
      }
    }
  }
});
