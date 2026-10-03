// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import {
  activeVirtualFrame,
  virtualLayerRange,
  virtualOpacity,
  virtualPickForSample,
  virtualSampleColour,
  virtualScenePoint,
} from "./rendering";
import type {
  LabelPrimitive,
  OverlayTransform3D,
  PathPrimitive,
  PointPrimitive,
  SurfacePrimitive,
  VectorPrimitive,
  VirtualFrame,
  VirtualLayer,
  VirtualPick,
  VirtualPrimitive,
} from "./types";

const UP = new THREE.Vector3(0, 1, 0);
const RENDER_ORDER = 180;

type PickObject = THREE.Object3D & {
  userData: {
    virtualPick?: VirtualPick;
    virtualPicks?: VirtualPick[];
    virtualSegmentPicks?: [VirtualPick, VirtualPick][];
    virtualVertexPicks?: (VirtualPick | null)[];
    virtualPathPicks?: VirtualPick[];
    [key: string]: unknown;
  };
};

function sceneVector(pointMm: readonly [number, number, number], transform: OverlayTransform3D): THREE.Vector3 {
  return new THREE.Vector3(...virtualScenePoint(pointMm, transform));
}

function colour(value: string): THREE.Color {
  const result = new THREE.Color();
  result.setStyle(value);
  return result;
}

function materialParameters(opacity: number): THREE.MeshBasicMaterialParameters {
  return {
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };
}

function tag(object: THREE.Object3D, name: string): void {
  object.name = name;
  object.renderOrder = RENDER_ORDER;
  object.userData.virtualOverlay = true;
}

function addPoints(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: PointPrimitive,
  range: readonly [number, number],
  transform: OverlayTransform3D,
): void {
  const indices = primitive.positionsMm.map((_, index) => index)
    .filter(index => !primitive.values || primitive.values[index] !== null);
  if (!indices.length) return;
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  // InstancedMesh consumes instanceColor directly. Enabling vertexColors here
  // would also require a per-vertex color attribute and renders black otherwise.
  const material = new THREE.MeshBasicMaterial(materialParameters(virtualOpacity(layer)));
  const mesh = new THREE.InstancedMesh(geometry, material, indices.length);
  const radius = Math.max(primitive.radiusMm ?? 0.35, 0.001) * transform.scale;
  const matrix = new THREE.Matrix4();
  const picks: VirtualPick[] = [];
  indices.forEach((sampleIndex, instanceIndex) => {
    matrix.makeScale(radius, radius, radius).setPosition(sceneVector(primitive.positionsMm[sampleIndex], transform));
    mesh.setMatrixAt(instanceIndex, matrix);
    mesh.setColorAt(instanceIndex, colour(virtualSampleColour(primitive, sampleIndex, range)));
    picks.push(virtualPickForSample(layer, frame, primitive, sampleIndex));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.virtualPicks = picks;
  tag(mesh, `Virtual points: ${primitive.id}`);
  group.add(mesh);
}

function arrowMatrix(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  radius: number,
  centerOffset: number,
): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction);
  const position = start.clone().addScaledVector(direction, centerOffset);
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(radius, length, radius));
}

function addVectors(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: VectorPrimitive,
  range: readonly [number, number],
  transform: OverlayTransform3D,
): void {
  const nonzero: number[] = [];
  const zero: number[] = [];
  primitive.positionsMm.forEach((_, index) => {
    if (primitive.values?.[index] === null) return;
    const vector = primitive.vectors[index];
    (Math.hypot(vector[0], vector[1], vector[2]) > 0 ? nonzero : zero).push(index);
  });
  const opacity = virtualOpacity(layer);
  if (nonzero.length) {
    const shaft = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6),
      new THREE.MeshBasicMaterial(materialParameters(opacity)),
      nonzero.length,
    );
    const head = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 8),
      new THREE.MeshBasicMaterial(materialParameters(opacity)),
      nonzero.length,
    );
    const picks: VirtualPick[] = [];
    nonzero.forEach((sampleIndex, instanceIndex) => {
      const source = primitive.vectors[sampleIndex];
      const direction = new THREE.Vector3(source[0], -source[1], source[2]).normalize();
      const totalLength = Math.hypot(...source) * primitive.displayScaleMm * transform.scale;
      const headLength = Math.min(totalLength * 0.36, Math.max(0.18 * transform.scale, totalLength * 0.2));
      const shaftLength = Math.max(totalLength - headLength, totalLength * 0.12);
      const radius = Math.max(0.025 * transform.scale, totalLength * 0.025);
      const start = sceneVector(primitive.positionsMm[sampleIndex], transform);
      shaft.setMatrixAt(instanceIndex, arrowMatrix(start, direction, shaftLength, radius, shaftLength / 2));
      head.setMatrixAt(instanceIndex, arrowMatrix(
        start,
        direction,
        headLength,
        radius * 2.5,
        totalLength - headLength / 2,
      ));
      const sampleColour = colour(virtualSampleColour(primitive, sampleIndex, range));
      shaft.setColorAt(instanceIndex, sampleColour);
      head.setColorAt(instanceIndex, sampleColour);
      picks.push(virtualPickForSample(layer, frame, primitive, sampleIndex));
    });
    for (const object of [shaft, head]) {
      object.instanceMatrix.needsUpdate = true;
      if (object.instanceColor) object.instanceColor.needsUpdate = true;
      object.userData.virtualPicks = picks;
      tag(object, `Virtual vector ${object === shaft ? "shafts" : "heads"}: ${primitive.id}`);
      group.add(object);
    }
  }
  if (zero.length) {
    const marker = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 5),
      new THREE.MeshBasicMaterial(materialParameters(opacity)),
      zero.length,
    );
    const matrix = new THREE.Matrix4();
    const radius = Math.max(0.09 * transform.scale, 0.001);
    const picks: VirtualPick[] = [];
    zero.forEach((sampleIndex, instanceIndex) => {
      matrix.makeScale(radius, radius, radius).setPosition(sceneVector(primitive.positionsMm[sampleIndex], transform));
      marker.setMatrixAt(instanceIndex, matrix);
      marker.setColorAt(instanceIndex, colour(virtualSampleColour(primitive, sampleIndex, range)));
      picks.push(virtualPickForSample(layer, frame, primitive, sampleIndex));
    });
    marker.instanceMatrix.needsUpdate = true;
    if (marker.instanceColor) marker.instanceColor.needsUpdate = true;
    marker.userData.virtualPicks = picks;
    tag(marker, `Virtual zero vectors: ${primitive.id}`);
    group.add(marker);
  }
}

function addSurface(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: SurfacePrimitive,
  range: readonly [number, number],
  transform: OverlayTransform3D,
): void {
  const triangles = primitive.triangles.filter(triangle => triangle.every(index =>
    index >= 0 && index < primitive.positionsMm.length && (!primitive.values || primitive.values[index] !== null)));
  if (!triangles.length) return;
  const positions = new Float32Array(primitive.positionsMm.length * 3);
  const colours = new Float32Array(positions.length);
  const picks: (VirtualPick | null)[] = [];
  primitive.positionsMm.forEach((position, index) => {
    sceneVector(position, transform).toArray(positions, index * 3);
    colour(virtualSampleColour(primitive, index, range)).toArray(colours, index * 3);
    picks.push(primitive.values?.[index] === null ? null : virtualPickForSample(layer, frame, primitive, index));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(triangles.flat());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    ...materialParameters(virtualOpacity(layer)),
    vertexColors: true,
    side: THREE.DoubleSide,
  }));
  mesh.userData.virtualVertexPicks = picks;
  tag(mesh, `Virtual surface: ${primitive.id}`);
  group.add(mesh);
}

function addPath(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: PathPrimitive,
  transform: OverlayTransform3D,
): void {
  if (primitive.positionsMm.length < 2) return;
  const path = new THREE.Group();
  tag(path, `Virtual path: ${primitive.id}`);
  const points = primitive.positionsMm.map(position => sceneVector(position, transform));
  const picks = primitive.positionsMm.map((_, index) => virtualPickForSample(layer, frame, primitive, index));
  const segmentCount = primitive.closed ? points.length : points.length - 1;
  const radius = Math.max((primitive.widthMm ?? 0.2) * transform.scale / 2, 0.0005);
  const material = new THREE.MeshBasicMaterial({
    ...materialParameters(virtualOpacity(layer)),
    color: primitive.color ?? "#a78bfa",
  });
  const segments = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), material, segmentCount);
  const segmentPicks: [VirtualPick, VirtualPick][] = [];
  for (let index = 0; index < segmentCount; index++) {
    const next = (index + 1) % points.length;
    const delta = points[next].clone().sub(points[index]);
    const length = delta.length();
    const direction = length > 0 ? delta.multiplyScalar(1 / length) : UP;
    segments.setMatrixAt(index, arrowMatrix(points[index], direction, Math.max(length, 0.0005), radius, length / 2));
    segmentPicks.push([picks[index], picks[next]]);
  }
  segments.instanceMatrix.needsUpdate = true;
  segments.userData.virtualSegmentPicks = segmentPicks;
  tag(segments, `Virtual path segments: ${primitive.id}`);
  path.add(segments);

  const joins = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshBasicMaterial({ ...materialParameters(virtualOpacity(layer)), color: primitive.color ?? "#a78bfa" }),
    points.length,
  );
  const matrix = new THREE.Matrix4();
  points.forEach((point, index) => joins.setMatrixAt(index, matrix.makeScale(radius, radius, radius).setPosition(point)));
  joins.instanceMatrix.needsUpdate = true;
  joins.userData.virtualPicks = picks;
  tag(joins, `Virtual path vertices: ${primitive.id}`);
  path.add(joins);
  group.add(path);
}

function labelSprite(text: string, opacity: number, color: string): THREE.Sprite | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = "28px sans-serif";
  const width = Math.min(1024, Math.max(16, Math.ceil(context.measureText(text).width + 12)));
  canvas.width = width;
  canvas.height = 40;
  context.font = "28px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(7, 15, 28, 0.78)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity, depthWrite: false }));
  sprite.scale.set(width / 40, 1, 1);
  return sprite;
}

function addLabels(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: LabelPrimitive,
  transform: OverlayTransform3D,
): void {
  primitive.positionsMm.forEach((position, sampleIndex) => {
    const sprite = labelSprite(primitive.labels[sampleIndex], virtualOpacity(layer), primitive.color ?? "#f8fafc");
    if (!sprite) return;
    sprite.position.copy(sceneVector(position, transform));
    sprite.scale.multiplyScalar(Math.max(transform.scale, 0.001));
    sprite.userData.virtualPick = virtualPickForSample(layer, frame, primitive, sampleIndex);
    tag(sprite, `Virtual label: ${primitive.id}:${sampleIndex}`);
    sprite.renderOrder = RENDER_ORDER + 1;
    group.add(sprite);
  });
}

function addPrimitive(
  group: THREE.Group,
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: VirtualPrimitive,
  range: readonly [number, number],
  transform: OverlayTransform3D,
): void {
  if (primitive.kind === "points") addPoints(group, layer, frame, primitive, range, transform);
  else if (primitive.kind === "vectors") addVectors(group, layer, frame, primitive, range, transform);
  else if (primitive.kind === "surface") addSurface(group, layer, frame, primitive, range, transform);
  else if (primitive.kind === "path") addPath(group, layer, frame, primitive, transform);
  else addLabels(group, layer, frame, primitive, transform);
}

/**
 * Build display-only virtual data at its physical board coordinates. Geometry
 * is never lifted in Z; polygon offset and render ordering handle coplanar data.
 * The caller owns and must dispose the returned tree. In non-DOM runtimes,
 * label sprites are omitted because no CanvasTexture can be created.
 */
export function buildVirtualOverlayScene(
  layers: readonly VirtualLayer[],
  frameIndex: number,
  transform: OverlayTransform3D,
): THREE.Group {
  const root = new THREE.Group();
  tag(root, "Virtual data overlays");
  for (const layer of layers) {
    const frame = activeVirtualFrame(layer, frameIndex);
    const group = new THREE.Group();
    tag(group, `Virtual layer: ${layer.label}`);
    group.userData.virtualLayerId = layer.id;
    group.userData.virtualFrameId = frame?.id;
    const displayed = layer.visible && frame !== null && virtualOpacity(layer) > 0;
    group.visible = displayed;
    if (frame && displayed) {
      const range = virtualLayerRange(layer);
      frame.primitives.forEach(primitive => addPrimitive(group, layer, frame, primitive, range, transform));
    }
    root.add(group);
  }
  return root;
}

function nearestVertexPick(
  hit: THREE.Intersection,
  object: THREE.Mesh | THREE.Line,
  picks: readonly (VirtualPick | null)[],
  candidates: readonly number[],
): VirtualPick | null {
  const positions = object.geometry.getAttribute("position");
  if (!positions) return null;
  const local = object.worldToLocal(hit.point.clone());
  let result: VirtualPick | null = null;
  let distance = Infinity;
  for (const index of candidates) {
    const pick = picks[index];
    if (!pick || index < 0 || index >= positions.count) continue;
    const next = new THREE.Vector3().fromBufferAttribute(positions, index).distanceToSquared(local);
    if (next < distance) {
      distance = next;
      result = pick;
    }
  }
  return result;
}

/** Resolve a raycaster hit to an original source sample without interpolating data. */
export function pickVirtualIntersection(hit: THREE.Intersection): VirtualPick | null {
  let current: THREE.Object3D | null = hit.object;
  while (current) {
    const object = current as PickObject;
    if (object.userData.virtualPick) return object.userData.virtualPick;
    const instancePicks = object.userData.virtualPicks;
    if (instancePicks && hit.instanceId !== undefined) return instancePicks[hit.instanceId] ?? null;
    const segmentPicks = object.userData.virtualSegmentPicks;
    if (segmentPicks && hit.instanceId !== undefined && object instanceof THREE.InstancedMesh) {
      const pair = segmentPicks[hit.instanceId];
      if (!pair) return null;
      const matrix = new THREE.Matrix4();
      object.getMatrixAt(hit.instanceId, matrix);
      matrix.premultiply(object.matrixWorld);
      const first = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
      const second = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
      return hit.point.distanceToSquared(first) <= hit.point.distanceToSquared(second) ? pair[0] : pair[1];
    }
    const vertexPicks = object.userData.virtualVertexPicks;
    if (vertexPicks && hit.face && object instanceof THREE.Mesh) {
      return nearestVertexPick(hit, object, vertexPicks, [hit.face.a, hit.face.b, hit.face.c]);
    }
    const pathPicks = object.userData.virtualPathPicks;
    if (pathPicks && object instanceof THREE.Line && hit.index !== undefined) {
      const first = Math.max(0, Math.min(pathPicks.length - 1, hit.index));
      const second = object instanceof THREE.LineLoop ? (first + 1) % pathPicks.length : Math.min(first + 1, pathPicks.length - 1);
      return nearestVertexPick(hit, object, pathPicks, [first, second]);
    }
    current = current.parent;
  }
  return null;
}
