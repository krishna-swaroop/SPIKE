// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { AssemblyViewer } from "../src/assembly/AssemblyViewer";
import type { ParsedBoard } from "../src/engine/boardTypes";
import {
  assemblyAnchorFromIntersection,
  assemblyIntersectionVisible,
  assemblyPickFromIntersection,
  assemblyVirtualPickFromIntersection,
  buildAssemblyScene,
  disposeAssemblyScene,
  replaceAssemblyAnchors,
  replaceVirtualOverlays,
  rigidMatrixToThree,
  threeMatrixToRigid,
  updateAssemblyScene,
} from "../src/assembly/scene";
import type { AssemblyDocument } from "../src/assembly/types";

const board: ParsedBoard = {
  width: 20, height: 20,
  bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
  outlineLoops: [[[10, 20], [30, 20], [30, 40], [10, 40], [10, 20]]],
  tracks: [], vias: [], pads: [], components: [], zones: [], drawings: [],
  layers: ["F.Cu", "B.Cu"],
  layerDefinitions: [{ id: 0, name: "F.Cu", kind: "signal" }, { id: 31, name: "B.Cu", kind: "signal" }],
  stackup: [{ name: "dielectric", type: "core", thickness: 1.6 }], nets: {},
};

const boardTransform = [1, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 300, 0, 0, 0, 1];
const mechanicalTransform = [0, -1, 0, 5, 1, 0, 0, 7, 0, 0, 1, 9, 0, 0, 0, 1];

const document: AssemblyDocument = {
  schema: "spike-viewer/assembly/v1", name: "Fixture", units: "mm",
  assets: [{
    id: "pcb", kind: "board", name: "PCB", board,
    binding: { boardId: "pcb", revision: "r1" },
    layers: [{
      schema: "spike-viewer/virtual-layer/v1", id: "probe", label: "Probe",
      binding: { boardId: "pcb", revision: "r1" }, quantity: "voltage", unit: "V",
      provenance: { source: "fixture", status: "measured" }, visible: true, opacity: 1,
      frames: [{ id: "f0", label: "Frame", primitives: [{ kind: "points", id: "samples", positionsMm: [[12, 22, 1]], values: [3.3] }] }],
    }],
  }, {
    id: "case", kind: "mechanical", name: "Case",
    source: { fileName: "case.step", format: "STEP", unit: "mm" },
    meshes: [{
      id: "shell", name: "Shell", positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], indices: [0, 1, 2],
      color: [0.2, 0.4, 0.7], faces: [{ first: 0, last: 0, color: [0.2, 0.4, 0.7] }],
    }],
  }],
  instances: [
    { id: "board-1", assetId: "pcb", name: "Board", transform: boardTransform, visible: true, locked: false, opacity: 1 },
    { id: "case-1", assetId: "case", name: "Case", transform: mechanicalTransform, visible: true, locked: false, opacity: 0.8 },
  ],
};

function close(actual: readonly number[], expected: readonly number[], tolerance = 1e-5): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance,
    `${value} differs from ${expected[index]} at ${index}`));
}

test("row-major rigid matrices round-trip and transform mechanical millimetres directly", () => {
  const matrix = rigidMatrixToThree(mechanicalTransform);
  assert.deepEqual(threeMatrixToRigid(matrix), mechanicalTransform);
  close(new THREE.Vector3(10, 0, 0).applyMatrix4(matrix).toArray(), [5, 17, 9]);

  const scene = buildAssemblyScene(document);
  const mesh = scene.group.getObjectByName("assembly-mesh:shell") as THREE.Mesh;
  assert.equal(Array.isArray(mesh.material), false, "identical face colors share one material");
  assert.equal(mesh.userData.assemblyFaceRanges, (document.assets[1] as { meshes: { faces?: unknown }[] }).meshes[0].faces,
    "source face ranges are retained without a second large allocation");
  mesh.updateWorldMatrix(true, false);
  close(new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), 1)
    .applyMatrix4(mesh.matrixWorld).toArray(), [5, 17, 9]);
  disposeAssemblyScene(scene);
});

test("board source X/Y becomes right-handed local X/-Y before the occurrence transform", () => {
  const scene = buildAssemblyScene(document);
  const occurrence = scene.instances.get("board-1")!;
  const frame = occurrence.getObjectByName("board-source-frame:pcb")!;
  assert.equal(frame.scale.y, -1);
  assert.deepEqual(occurrence.scale.toArray(), [1, 1, 1], "the transform-control target is not reflected");
  const bounds = new THREE.Box3().setFromObject(frame);
  close(bounds.min.toArray(), [110, 160, 299.2]);
  close(bounds.max.toArray(), [130, 180, 300.8]);
  let substrate: THREE.Mesh | undefined;
  occurrence.traverse(object => { if (object.userData.sceneKind === "substrate") substrate = object as THREE.Mesh; });
  const hit = new THREE.Raycaster(new THREE.Vector3(120, 170, 310), new THREE.Vector3(0, 0, -1))
    .intersectObject(substrate!, false)[0];
  assert.ok(hit);
  const pick = assemblyPickFromIntersection(hit, scene)!;
  close(pick.localPoint, [20, -30, 0.8]);
  close(pick.localNormal!, [0, 0, 1], 1e-4);
  disposeAssemblyScene(scene);
});

test("assembly picks report occurrence-local points, normals, mesh and triangle identity", () => {
  const scene = buildAssemblyScene(document);
  const mesh = scene.group.getObjectByName("assembly-mesh:shell") as THREE.Mesh;
  scene.group.updateMatrixWorld(true);
  const local = new THREE.Vector3(2, 2, 0);
  const world = mesh.localToWorld(local.clone());
  const hit = {
    object: mesh, point: world, faceIndex: 0,
    face: { a: 0, b: 1, c: 2, normal: new THREE.Vector3(0, 0, 1), materialIndex: 0 },
  } as THREE.Intersection;
  const pick = assemblyPickFromIntersection(hit, scene)!;
  assert.equal(pick.instanceId, "case-1");
  assert.equal(pick.kind, "surface");
  assert.equal(pick.meshId, "shell");
  assert.equal(pick.triangleIndex, 0);
  close(pick.localPoint, [2, 2, 0]);
  close(pick.localNormal!, [0, 0, 1]);
  close(pick.worldPoint, [3, 9, 9]);

  const vertexHit = {
    ...hit,
    point: mesh.localToWorld(new THREE.Vector3(9, 0.2, 0)),
  } as THREE.Intersection;
  const vertexPick = assemblyPickFromIntersection(vertexHit, scene, "vertex")!;
  assert.equal(vertexPick.kind, "vertex");
  close(vertexPick.localPoint, [10, 0, 0]);
  close(vertexPick.worldPoint, [5, 17, 9]);
  close(vertexPick.localNormal!, [0, 0, 1]);
  disposeAssemblyScene(scene);
});

test("virtual samples and anchors remain scoped to their board occurrence", () => {
  const scene = buildAssemblyScene(document);
  replaceVirtualOverlays(scene, document, 0, true);
  const points = scene.instances.get("board-1")!.getObjectByName("Virtual points: samples") as THREE.InstancedMesh;
  const virtual = assemblyVirtualPickFromIntersection({ object: points, instanceId: 0 } as THREE.Intersection)!;
  assert.equal(virtual.instanceId, "board-1");
  assert.deepEqual(virtual.positionMm, [12, 22, 1], "virtual picks retain source board coordinates");

  const anchor = { id: "a1", instanceId: "board-1", label: "Hole", kind: "hole" as const, point: [12, -22, 1] as [number, number, number] };
  replaceAssemblyAnchors(scene, [anchor], "a1");
  const marker = scene.group.getObjectByName("assembly-anchor:a1")!;
  assert.equal(assemblyAnchorFromIntersection({ object: marker } as THREE.Intersection), anchor);
  marker.updateWorldMatrix(true, false);
  close(marker.getWorldPosition(new THREE.Vector3()).toArray(), [112, 178, 301]);
  disposeAssemblyScene(scene);
});

test("display updates reuse geometry and apply visibility, opacity, edges and clipping", () => {
  const scene = buildAssemblyScene(document);
  const mesh = scene.group.getObjectByName("assembly-mesh:shell") as THREE.Mesh;
  const geometry = mesh.geometry;
  updateAssemblyScene(scene, document, {
    selectedId: "case-1", isolatedId: "case-1", showEdges: true,
    section: { enabled: true, axis: "x", offsetMm: 4 },
  });
  assert.equal(scene.instances.get("board-1")!.visible, false);
  assert.equal(scene.instances.get("case-1")!.visible, true);
  assert.equal(mesh.geometry, geometry);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).opacity, 0.8);
  assert.equal(mesh.getObjectByName("assembly-edges:shell")!.visible, true);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).clippingPlanes?.length, 1);
  const shownHit = { object: mesh, point: new THREE.Vector3(2, 2, 0), face: { materialIndex: 0 } } as THREE.Intersection;
  const clippedHit = { object: mesh, point: new THREE.Vector3(6, 2, 0), face: { materialIndex: 0 } } as THREE.Intersection;
  assert.equal(assemblyIntersectionVisible(shownHit), true);
  assert.equal(assemblyIntersectionVisible(clippedHit), false, "ray hits beyond the section plane are ignored");

  const hidden: AssemblyDocument = { ...document, instances: document.instances.map(value =>
    value.id === "case-1" ? { ...value, visible: false, locked: true, opacity: 0 } : value) };
  updateAssemblyScene(scene, hidden, {});
  assert.equal(scene.instances.get("case-1")!.visible, false);
  assert.equal(scene.instances.get("case-1")!.userData.assemblyLocked, true);
  let disposed = false;
  geometry.addEventListener("dispose", () => { disposed = true; });
  disposeAssemblyScene(scene);
  assert.equal(disposed, true);
});

test("large face palettes fall back visibly without copying source face ranges", () => {
  const faces = Array.from({ length: 258 }, (_, index) => ({
    first: index, last: index, color: [index / 300, (index % 7) / 7, (index % 11) / 11] as [number, number, number],
  }));
  const large: AssemblyDocument = {
    schema: "spike-viewer/assembly/v1", name: "Palette", units: "mm",
    assets: [{
      id: "palette", kind: "mechanical", name: "Palette mesh",
      source: { fileName: "palette.step", format: "STEP", unit: "mm" },
      meshes: [{
        id: "many-colors", name: "Many colors", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: faces.flatMap(() => [0, 1, 2]), color: [1, 1, 1], faces,
      }],
    }],
    instances: [{ id: "palette-1", assetId: "palette", name: "Palette", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], visible: true, locked: false, opacity: 1 }],
  };
  const scene = buildAssemblyScene(large);
  const mesh = scene.group.getObjectByName("assembly-mesh:many-colors") as THREE.Mesh;
  assert.ok(Array.isArray(mesh.material));
  assert.equal((mesh.material as THREE.Material[]).length, 256);
  assert.equal(mesh.userData.assemblyFaceRanges, faces);
  assert.equal(mesh.userData.assemblyFacePaletteTruncated, true);
  assert.match(scene.diagnostics[0].message, /additional colors use the mesh base color/);
  disposeAssemblyScene(scene);
});

test("public viewer rejects invalid documents before mounting WebGL", () => {
  const invalid = { ...document, units: "cm" } as unknown as AssemblyDocument;
  const markup = renderToStaticMarkup(createElement(AssemblyViewer, {
    document: invalid,
    mode: "3D",
    onSelect: () => undefined,
    tool: "select",
    space: "world",
    translationSnapMm: 1,
    rotationSnapDeg: 15,
  }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Cannot open assembly/);
  assert.doesNotMatch(markup, /assembly-viewer__canvas/);
});
