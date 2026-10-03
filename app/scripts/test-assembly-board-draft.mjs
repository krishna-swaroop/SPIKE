import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";

const generated = ["mcadAssembly", "assemblyBoardDraft"];
try {
  for (const name of generated) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
    let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    output = output.replaceAll('"./mcadAssembly"', '"./.test-mcadAssembly.mjs"');
    writeFileSync(new URL(`./.test-${name}.mjs`, import.meta.url), output);
  }
  const { retainedDesignBoardEnvelope, separatedBoardPlacement } = await import(`./.test-assemblyBoardDraft.mjs?${Date.now()}`);
  const { transformFromPlacement } = await import(`./.test-mcadAssembly.mjs?${Date.now()}`);
  const transform = (x, y = 0) => [1,0,0,x, 0,1,0,y, 0,0,1,4, 0,0,0,1];
  const first = separatedBoardPlacement([]);
  assert.deepEqual([first.xMm, first.yMm, first.zMm], [0, 0, 0], "first occurrence starts at the assembly origin");
  const rotatedSource = transformFromPlacement({ xMm: 10, yMm: 0, zMm: 4, rxDeg: 12, ryDeg: -7, rzDeg: 35 });
  const envelope = { minX: 0, minY: 0, maxX: 143.9, maxY: 60 };
  const duplicate = separatedBoardPlacement([{ transform: rotatedSource, envelope }], { transform: rotatedSource, envelope });
  assert.ok(duplicate.xMm > 153.9, "rotated 143.9 mm board receives a conservative projected span plus clearance");
  assert.equal(duplicate.zMm, 4, "duplicate preserves source elevation");
  [duplicate.rxDeg - 12, duplicate.ryDeg + 7, duplicate.rzDeg - 35].forEach(error => assert.ok(Math.abs(error) < 1e-9, "duplicate preserves source rotation"));
  const unrotated = { transform: transform(0), envelope };
  const besideRealBoard = separatedBoardPlacement([unrotated], unrotated);
  assert.equal(besideRealBoard.xMm, 173.9, "143.9 mm source width receives 30 mm edge clearance");
  const otherRow = separatedBoardPlacement([{ transform: transform(0, 0), envelope: null }, { transform: transform(30, 0), envelope: null }], { transform: transform(0, 40), envelope: null });
  assert.deepEqual([otherRow.xMm, otherRow.yMm], [30, 40], "Y rows beyond the clearance can reuse an X starter position");
  assert.deepEqual(retainedDesignBoardEnvelope({ metadata: { board_bounds_mm: [-2, -3, 141.9, 57] } }), { minX: -2, minY: -3, maxX: 141.9, maxY: 57 }, "canonical bounds are retained");
  console.log("assembly board draft: all assertions passed");
} finally {
  for (const name of generated) { try { unlinkSync(new URL(`./.test-${name}.mjs`, import.meta.url)); } catch {} }
}
