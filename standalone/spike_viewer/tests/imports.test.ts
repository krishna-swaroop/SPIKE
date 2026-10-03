// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BufferGeometry, Material } from "three";
import { importAssemblyFile } from "../adapters/importFiles";

const root = process.cwd();

async function fixture(name: string, type = "application/octet-stream"): Promise<File> {
  const bytes = await readFile(join(root, "public", "fixtures", name));
  return new File([bytes], name, { type });
}

function minimalGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 2]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  const document = {
    asset: { version: "2.0", generator: "SPIKE import test" },
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 2] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [2] },
    ],
    meshes: [{ name: "Y-up reflected triangle", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, scale: [-1, 1, 1] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const result = new Uint8Array(12 + 8 + jsonLength + 8 + binary.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.fill(0x20, 20, 20 + jsonLength);
  result.set(encoded, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.length, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}

test("imports two independent KiCad boards with millimetre geometry and revisions", async () => {
  const controller = await importAssemblyFile(await fixture("controller-board.kicad_pcb"));
  const sensor = await importAssemblyFile(await fixture("sensor-board.kicad_pcb"));
  assert.equal(controller.kind, "board");
  assert.equal(sensor.kind, "board");
  if (controller.kind !== "board" || sensor.kind !== "board") return;
  assert.deepEqual([controller.board.width, controller.board.height], [40, 30]);
  assert.deepEqual([sensor.board.width, sensor.board.height], [25, 20]);
  assert.deepEqual(sensor.board.bounds, { minX: 100, minY: 200, maxX: 125, maxY: 220 });
  assert.equal(controller.board.components[0]?.ref, "J1");
  assert.equal(sensor.board.components[0]?.ref, "U1");
  assert.equal(controller.binding.boardId, controller.id);
  assert.match(controller.binding.revision, /^[0-9a-f]{64}$/);
  assert.notEqual(controller.id, sensor.id);
});

test("tessellates the original STEP fixture through OCCT in millimetres", { timeout: 30_000 }, async () => {
  const asset = await importAssemblyFile(await fixture("spike-reflector-500x500x5.step"));
  assert.equal(asset.kind, "mechanical");
  if (asset.kind !== "mechanical") return;
  assert.equal(asset.source.format, "step");
  assert.equal(asset.source.unit, "mm");
  assert.ok(asset.meshes.length > 0);
  assert.ok(asset.meshes.every(mesh => mesh.indices.length > 0 && mesh.indices.length % 3 === 0));
  const xs = asset.meshes.flatMap(mesh => mesh.positions.filter((_, index) => index % 3 === 0));
  const ys = asset.meshes.flatMap(mesh => mesh.positions.filter((_, index) => index % 3 === 1));
  const zs = asset.meshes.flatMap(mesh => mesh.positions.filter((_, index) => index % 3 === 2));
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  assert.ok(Math.abs(span(xs) - 500) < 1e-6);
  assert.ok(Math.abs(span(ys) - 500) < 1e-6);
  assert.ok(Math.abs(span(zs) - 5) < 1e-6);
});

test("normalizes unitless OBJ coordinates and blocks external material loading", async () => {
  const triangle = new File(["o triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"], "triangle.obj");
  const asset = await importAssemblyFile(triangle, { meshUnit: "cm" });
  assert.equal(asset.kind, "mechanical");
  if (asset.kind !== "mechanical") return;
  assert.equal(Math.max(...asset.meshes[0].positions), 10);
  await assert.rejects(
    importAssemblyFile(new File(["mtllib https://example.invalid/a.mtl\nv 0 0 0\n"], "linked.obj")),
    /external resources/i,
  );
});

test("normalizes GLB metres and Y-up axes, ignores meshUnit, fixes reflected winding, and disposes loader resources", async () => {
  let geometryDisposals = 0;
  let materialDisposals = 0;
  const disposeGeometry = BufferGeometry.prototype.dispose;
  const disposeMaterial = Material.prototype.dispose;
  BufferGeometry.prototype.dispose = function () { geometryDisposals += 1; return disposeGeometry.call(this); };
  Material.prototype.dispose = function () { materialDisposals += 1; return disposeMaterial.call(this); };
  try {
    const asset = await importAssemblyFile(new File([minimalGlb()], "axes.glb"), { meshUnit: "in" });
    assert.equal(asset.kind, "mechanical");
    if (asset.kind !== "mechanical") return;
    const mesh = asset.meshes[0];
    assert.deepEqual(mesh.positions.map(value => Object.is(value, -0) ? 0 : value), [
      0, 0, 0,
      -1_000, 0, 0,
      0, -2_000, 1_000,
    ]);
    assert.deepEqual(mesh.indices, [0, 2, 1]);
    assert.match(asset.source.notes?.[0] ?? "", /interpreted as m/);
  } finally {
    BufferGeometry.prototype.dispose = disposeGeometry;
    Material.prototype.dispose = disposeMaterial;
  }
  assert.ok(geometryDisposals > 0);
  assert.ok(materialDisposals > 0);
});

test("rejects unsupported, invalid, empty, and cancelled imports", async () => {
  await assert.rejects(importAssemblyFile(new File(["x"], "notes.txt")), /Unsupported file type/);
  await assert.rejects(importAssemblyFile(new File([], "empty.step")), /empty/);
  await assert.rejects(importAssemblyFile(new File(["not a STEP file"], "broken.step")), /could not read/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(importAssemblyFile(new File(["x"], "cancelled.obj"), { signal: controller.signal }), error => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
});
