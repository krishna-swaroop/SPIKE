import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";

const generated = ["mcadAssembly", "assemblyPlacementControls"];
try {
  for (const name of generated) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
    let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    output = output.replaceAll('"./mcadAssembly"', '"./.test-mcadAssembly.mjs"');
    writeFileSync(new URL(`./.test-${name}.mjs`, import.meta.url), output);
  }
  const controls = await import(`./.test-assemblyPlacementControls.mjs?${Date.now()}`);
  const parentRotation = [0, -1, 0, 100, 1, 0, 0, 20, 0, 0, 1, 3, 0, 0, 0, 1];
  const local = [1, 0, 0, 10, 0, 1, 0, 5, 0, 0, 1, 2, 0, 0, 0, 1];
  const assembly = { contract: "spike/assembly-ir/v1", assembly_id: "a", name: "A", boards: [
    { id: "parent", design_id: "d", frame: { frame_id: "parent-frame", parent_frame_id: "assembly", units: "mm", handedness: "right", transform: parentRotation } },
    { id: "child", design_id: "d", frame: { frame_id: "child-frame", parent_frame_id: "parent-frame", units: "mm", handedness: "right", transform: local } },
  ], parts: [] };
  const current = controls.boardWorldPlacement(assembly, "child");
  assert.deepEqual([current.xMm, current.yMm, current.zMm].map(Math.round), [95, 30, 5], "nested frame placement resolves in assembly mm");
  const edited = controls.editBoardWorldPlacement(assembly, "child", { rxDeg: 12.5, ryDeg: -33.25, rzDeg: 721.75 });
  assert.deepEqual([edited[3], edited[7], edited[11]], [current.xMm, current.yMm, current.zMm], "angle edits preserve world translation");
  assert.equal(controls.isRigidTransform(edited), true, "arbitrary XYZ angles produce a rigid right-handed transform");
  assert.equal(controls.isRigidTransform([2,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), false, "scale is rejected");
  assert.equal(controls.isRigidTransform([1,.2,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), false, "shear is rejected");
  assert.equal(controls.isRigidTransform([-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), false, "reflection is rejected");
  assert.throws(() => controls.editBoardWorldPlacement({ ...assembly, boards: [{ ...assembly.boards[0], frame: { ...assembly.boards[0].frame, transform: [2,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] } }] }, "parent", { xMm: 1 }), /not a rigid/);
  console.log("assembly placement controls: all assertions passed");
} finally {
  for (const name of generated) { try { unlinkSync(new URL(`./.test-${name}.mjs`, import.meta.url)); } catch {} }
}
