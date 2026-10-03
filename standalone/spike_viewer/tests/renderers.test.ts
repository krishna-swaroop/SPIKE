// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { disposeScene } from "../src/engine/sceneResourceCache";
import { Overlay2D } from "../src/overlays/Overlay2D";
import { activeVirtualFrame, virtualLayerRange } from "../src/overlays/rendering";
import { buildVirtualOverlayScene, pickVirtualIntersection } from "../src/overlays/scene3d";
import type { VirtualLayer, VirtualPick } from "../src/overlays/types";

const layer: VirtualLayer = {
  schema: "spike-viewer/virtual-layer/v1",
  id: "field",
  label: "Field review",
  binding: { boardId: "board", revision: "rev" },
  quantity: "temperature",
  unit: "degC",
  provenance: { source: "fixture", status: "simulated" },
  visible: true,
  opacity: 0.6,
  frames: [{
    id: "first",
    label: "First",
    primitives: [
      { kind: "points", id: "scalar", positionsMm: [[10, 20, 2], [11, 20, 2]], values: [0, null], radiusMm: 0.5 },
      { kind: "points", id: "ordinary", positionsMm: [[9, 20, 1]] },
      {
        kind: "vectors", id: "arrows",
        positionsMm: [[12, 20, 0], [13, 20, 0], [14, 20, 0]],
        vectors: [[1, 2, 3], [2, 0, 0], [0, 0, 0]], displayScaleMm: 2, values: [25, null, 50],
      },
      {
        kind: "surface",
        id: "surface",
        positionsMm: [[0, 0, 1], [2, 0, 1], [0, 2, 1], [2, 2, 1]],
        triangles: [[0, 1, 2], [1, 3, 2]],
        values: [0, 25, 50, null],
      },
      { kind: "path", id: "route", positionsMm: [[5, 5, 1], [6, 5, 1], [6, 6, 1]], closed: true },
      { kind: "labels", id: "notes", positionsMm: [[7, 7, 1]], labels: ["<safe & literal>"] },
    ],
  }, {
    id: "second",
    label: "Second",
    primitives: [{ kind: "points", id: "high", positionsMm: [[0, 0, 0]], values: [100] }],
  }],
};

function findElements(node: unknown, predicate: (properties: Record<string, unknown>) => boolean): any[] {
  if (Array.isArray(node)) return node.flatMap(item => findElements(item, predicate));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const properties = (node as { props: Record<string, unknown> }).props;
  return [...(predicate(properties) ? [node] : []), ...findElements(properties.children, predicate)];
}

test("frame selection keeps static layers visible and shares derived ranges", () => {
  assert.equal(activeVirtualFrame({ ...layer, frames: [layer.frames[0]] }, 900)?.id, "first");
  assert.equal(activeVirtualFrame(layer, -1), null);
  assert.equal(activeVirtualFrame(layer, 2), null);
  assert.deepEqual(virtualLayerRange(layer), [0, 100]);
  assert.deepEqual(virtualLayerRange({ ...layer, range: [-5, 5] }), [-5, 5]);
});

test("3D scene preserves physical coordinates, masks nulls, and batches glyphs", () => {
  const scene = buildVirtualOverlayScene([layer], 0, { centerX: 10, centerY: 20, scale: 2 });
  assert.equal(scene.children.length, 1);
  const layerGroup = scene.children[0] as THREE.Group;
  assert.equal(layerGroup.visible, true);

  const scalar = layerGroup.getObjectByName("Virtual points: scalar") as THREE.InstancedMesh;
  assert.ok(scalar instanceof THREE.InstancedMesh);
  assert.equal(scalar.count, 1, "a null scalar point is omitted");
  const matrix = new THREE.Matrix4();
  scalar.getMatrixAt(0, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.deepEqual(position.toArray(), [0, 0, 4]);
  assert.equal((scalar.material as THREE.MeshBasicMaterial).opacity, 0.6);
  assert.equal((scalar.material as THREE.MeshBasicMaterial).vertexColors, false,
    "instance colors must not be multiplied by a missing geometry color attribute");

  const surface = layerGroup.getObjectByName("Virtual surface: surface") as THREE.Mesh;
  assert.deepEqual(Array.from(surface.geometry.index!.array), [0, 1, 2], "a null vertex masks every connected face");
  assert.equal(surface.geometry.getAttribute("position").getZ(0), 2, "physical Z is scaled without display lift");
  assert.equal((surface.material as THREE.MeshBasicMaterial).polygonOffset, true);

  assert.equal((layerGroup.getObjectByName("Virtual vector shafts: arrows") as THREE.InstancedMesh).count, 1);
  assert.equal((layerGroup.getObjectByName("Virtual vector heads: arrows") as THREE.InstancedMesh).count, 1);
  assert.equal((layerGroup.getObjectByName("Virtual zero vectors: arrows") as THREE.InstancedMesh).count, 1);
  const shaft = layerGroup.getObjectByName("Virtual vector shafts: arrows") as THREE.InstancedMesh;
  const head = layerGroup.getObjectByName("Virtual vector heads: arrows") as THREE.InstancedMesh;
  const shaftMatrix = new THREE.Matrix4();
  const headMatrix = new THREE.Matrix4();
  shaft.getMatrixAt(0, shaftMatrix);
  head.getMatrixAt(0, headMatrix);
  const arrowStart = new THREE.Vector3(0, -0.5, 0).applyMatrix4(shaftMatrix);
  const arrowTip = new THREE.Vector3(0, 0.5, 0).applyMatrix4(headMatrix);
  assert.ok(arrowStart.distanceTo(new THREE.Vector3(4, 0, 0)) < 1e-6);
  assert.ok(arrowTip.distanceTo(new THREE.Vector3(8, -8, 12)) < 1e-6,
    "the arrow endpoint applies displayScaleMm before the board transform");
  const path = layerGroup.getObjectByName("Virtual path: route") as THREE.Group;
  assert.ok(path instanceof THREE.Group);
  assert.equal((path.getObjectByName("Virtual path segments: route") as THREE.InstancedMesh).count, 3);
  assert.equal((path.getObjectByName("Virtual path vertices: route") as THREE.InstancedMesh).count, 3);
  assert.equal(layerGroup.userData.virtualOverlay, true);
  assert.equal(layerGroup.userData.virtualLayerId, "field");
  assert.equal(layerGroup.getObjectByName("Virtual label: notes:0"), undefined,
    "Node scene creation intentionally omits DOM canvas label sprites");

  const hidden = buildVirtualOverlayScene([layer], 4, { centerX: 0, centerY: 0, scale: 1 });
  assert.equal(hidden.children[0].visible, false);

  const transparent = buildVirtualOverlayScene([{ ...layer, opacity: 0 }], 0, { centerX: 0, centerY: 0, scale: 1 });
  assert.equal(transparent.children[0].visible, false);
  assert.equal(transparent.children[0].children.length, 0, "opacity zero leaves no raycastable geometry");
});

test("actual raycaster intersections recover original sample metadata", () => {
  const scene = buildVirtualOverlayScene([layer], 0, { centerX: 10, centerY: 20, scale: 2 });
  scene.updateMatrixWorld(true);
  const scalar = scene.getObjectByName("Virtual points: scalar") as THREE.InstancedMesh;
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  const hit = raycaster.intersectObject(scalar, false)[0];
  assert.ok(hit);
  assert.deepEqual(pickVirtualIntersection(hit), {
    layerId: "field",
    frameId: "first",
    primitiveId: "scalar",
    sampleIndex: 0,
    positionMm: [10, 20, 2],
    value: 0,
    quantity: "temperature",
    unit: "degC",
    provenance: { source: "fixture", status: "simulated" },
  });

  const surface = scene.getObjectByName("Virtual surface: surface") as THREE.Mesh;
  const surfaceRay = new THREE.Raycaster(new THREE.Vector3(-19.8, 39.8, 8), new THREE.Vector3(0, 0, -1));
  const surfaceHit = surfaceRay.intersectObject(surface, false)[0];
  assert.ok(surfaceHit);
  assert.equal(pickVirtualIntersection(surfaceHit)?.sampleIndex, 0);
  const maskedFaceRay = new THREE.Raycaster(new THREE.Vector3(-16.4, 36.4, 8), new THREE.Vector3(0, 0, -1));
  assert.equal(maskedFaceRay.intersectObject(surface, false).length, 0,
    "a triangle touching a null sample is not pickable");

  const route = scene.getObjectByName("Virtual path segments: route") as THREE.InstancedMesh;
  const routeRay = new THREE.Raycaster(new THREE.Vector3(-8, 29, 8), new THREE.Vector3(0, 0, -1));
  routeRay.params.Line!.threshold = 0.1;
  const routeHit = routeRay.intersectObject(route, false)[0];
  assert.ok(routeHit);
  assert.equal(pickVirtualIntersection(routeHit)?.sampleIndex, 1,
    "path intersections retain the source vertex index nearest the hit");

  const parent = new THREE.Group();
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  parent.userData.virtualPick = { marker: true } as unknown as VirtualPick;
  parent.add(child);
  assert.equal(pickVirtualIntersection({ object: child } as THREE.Intersection), parent.userData.virtualPick,
    "pick metadata may live above the intersected leaf");
});

test("browser label sprites retain literal text metadata and release their texture", () => {
  const fakeContext = {
    font: "", textAlign: "", textBaseline: "", fillStyle: "",
    measureText: (text: string) => ({ width: text.length * 12 }),
    fillRect: () => undefined,
    fillText: () => undefined,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }) },
  });
  try {
    const scene = buildVirtualOverlayScene([layer], 0, { centerX: 0, centerY: 0, scale: 1 });
    const sprite = scene.getObjectByName("Virtual label: notes:0") as THREE.Sprite;
    assert.ok(sprite instanceof THREE.Sprite);
    const pick = pickVirtualIntersection({ object: sprite } as THREE.Intersection);
    assert.equal(pick?.sampleIndex, 0);
    assert.equal(pick?.label, "<safe & literal>");
    const texture = (sprite.material as THREE.SpriteMaterial).map!;
    let textureDisposed = false;
    texture.addEventListener("dispose", () => { textureDisposed = true; });
    disposeScene(scene);
    assert.equal(textureDisposed, true);
    assert.equal(scene.children.length, 0);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test("2D rendering has primitive parity, source indices, masking, and escaped labels", () => {
  const markup = renderToStaticMarkup(createElement("svg", null, createElement(Overlay2D, {
    layers: [layer], frameIndex: 0, toLayout: point => point, onPick: () => undefined,
  })));
  for (const primitive of ["scalar", "ordinary", "arrows", "surface", "route", "notes"])
    assert.match(markup, new RegExp(`data-virtual-primitive="${primitive}"`));
  assert.match(markup, /data-virtual-frame="first"/);
  assert.match(markup, /data-virtual-sample="0"/);
  assert.match(markup, /data-virtual-segment="0"/);
  assert.match(markup, /data-virtual-face="0"/);
  assert.match(markup, /font-size="2"/);
  assert.match(markup, /stroke-width="0\.2"/);
  assert.doesNotMatch(markup, /&lt;safe & literal&gt;/);
  assert.match(markup, /&lt;safe &amp; literal&gt;/);
  assert.doesNotMatch(markup, /M2,0L2,2L0,2Z/, "the triangle connected to a null vertex is absent");

  const hiddenMarkup = renderToStaticMarkup(createElement("svg", null, createElement(Overlay2D, {
    layers: [layer], frameIndex: 99, toLayout: point => point,
  })));
  assert.match(hiddenMarkup, /visibility="hidden"/);
});

test("2D face and segment hits choose nearest source samples and contain pointer gestures", () => {
  const picks: VirtualPick[] = [];
  const tree = Overlay2D({ layers: [layer], frameIndex: 0, toLayout: point => point, onPick: pick => picks.push(pick) });
  const vectorGroup = findElements(tree, props => props["data-virtual-primitive"] === "arrows")[0];
  assert.deepEqual(findElements(vectorGroup, props => props["data-virtual-sample"] !== undefined)
    .map(element => element.props["data-virtual-sample"]), [0, 2], "the null-valued vector is masked");

  const face = findElements(tree, props => props["data-virtual-face"] === 0)[0];
  let stopped = 0;
  face.props.onPointerDown({ stopPropagation: () => { stopped++; } });
  face.props.onPointerUp({ stopPropagation: () => { stopped++; } });
  face.props.onPointerCancel({ stopPropagation: () => { stopped++; } });
  face.props.onClick({
    stopPropagation: () => { stopped++; },
    currentTarget: { ownerSVGElement: null },
    nativeEvent: { offsetX: 1.9, offsetY: 0.1 },
  });
  assert.equal(picks.at(-1)?.primitiveId, "surface");
  assert.equal(picks.at(-1)?.sampleIndex, 1);

  const segment = findElements(tree, props => props["data-virtual-segment"] === 0)[0];
  segment.props.onClick({
    stopPropagation: () => { stopped++; },
    currentTarget: { ownerSVGElement: null },
    nativeEvent: { offsetX: 5.9, offsetY: 5 },
  });
  assert.equal(picks.at(-1)?.primitiveId, "route");
  assert.equal(picks.at(-1)?.sampleIndex, 1);
  assert.equal(stopped, 5);
});
