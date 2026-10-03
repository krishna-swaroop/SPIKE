// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import { boardInstanceScene } from "../engine/assemblyBoardScene";
import { disposeScene } from "../engine/sceneResourceCache";
import type { VirtualBoardVisual } from "../engine/harnessVisualization";
import { buildVirtualOverlayScene, pickVirtualIntersection } from "../overlays/scene3d";
import type { VirtualPick } from "../overlays/types";
import type {
  AssemblyAnchor,
  AssemblyDocument,
  AssemblyInstance,
  AssemblyMesh,
  AssemblyPick,
  AssemblySection,
  BoardAsset,
  MechanicalAsset,
  RigidMatrix,
} from "./types";

const IDENTITY: RigidMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MAX_FACE_MATERIALS = 256;
const MAX_FACE_GROUPS = 4096;

export type AssemblyScene = {
  group: THREE.Group;
  instances: Map<string, THREE.Group>;
  pickables: THREE.Object3D[];
  diagnostics: { code: "face_palette_bounded" | "face_groups_bounded"; instanceId: string; meshId: string; message: string }[];
};

export function rigidMatrixToThree(values: readonly number[]): THREE.Matrix4 {
  if (values.length !== 16 || values.some(value => !Number.isFinite(value))) throw new Error("Assembly transform must contain 16 finite row-major values.");
  return new THREE.Matrix4().set(...values as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]);
}

export function threeMatrixToRigid(matrix: THREE.Matrix4): RigidMatrix {
  const e = matrix.elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]];
}

function color(values: readonly number[] | undefined, fallback = 0x78929a): THREE.Color {
  if (!values) return new THREE.Color(fallback);
  const scale = values.some(value => value > 1) ? 1 / 255 : 1;
  return new THREE.Color(values[0] * scale, values[1] * scale, values[2] * scale);
}

function meshMaterial(values?: readonly number[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: color(values), roughness: 0.68, metalness: 0.12, side: THREE.DoubleSide });
}

function mechanicalMesh(source: AssemblyMesh, instanceId: string): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(source.positions, 3));
  geometry.setIndex(source.indices);
  if (source.normals?.length === source.positions.length) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(source.normals, 3));
  else geometry.computeVertexNormals();
  const colorKey = (values?: readonly number[]) => values ? values.join(",") : "default";
  const materials: THREE.Material[] = [meshMaterial(source.color)];
  const materialIndices = new Map([[colorKey(source.color), 0]]);
  let paletteTruncated = false;
  let groupsTruncated = false;
  if (source.faces?.length) {
    const triangleMaterials = new Uint32Array(source.indices.length / 3);
    for (const face of source.faces) {
      const faceColor = face.color ?? source.color;
      const key = colorKey(faceColor);
      let materialIndex = materialIndices.get(key);
      if (materialIndex === undefined) {
        if (materials.length >= MAX_FACE_MATERIALS) {
          materialIndex = 0;
          paletteTruncated = true;
        } else {
          materialIndex = materials.length;
          materialIndices.set(key, materialIndex);
          materials.push(meshMaterial(faceColor));
        }
      }
      triangleMaterials.fill(materialIndex, face.first, face.last + 1);
    }
    let start = 0;
    let groupCount = 0;
    while (start < triangleMaterials.length) {
      let end = start + 1;
      while (end < triangleMaterials.length && triangleMaterials[end] === triangleMaterials[start]) end++;
      if (groupCount === MAX_FACE_GROUPS - 1 && end < triangleMaterials.length) {
        geometry.addGroup(start * 3, (triangleMaterials.length - start) * 3, 0);
        groupsTruncated = true;
        break;
      }
      geometry.addGroup(start * 3, (end - start) * 3, triangleMaterials[start]);
      groupCount++;
      start = end;
    }
  }
  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = `assembly-mesh:${source.id}`;
  mesh.userData.assemblyInstanceId = instanceId;
  mesh.userData.assemblyMeshId = source.id;
  mesh.userData.assemblyFaceRanges = source.faces ?? [];
  mesh.userData.assemblyFacePaletteTruncated = paletteTruncated;
  mesh.userData.assemblyFaceGroupsTruncated = groupsTruncated;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: 0x17242a, transparent: true, opacity: 0.5 }));
  edges.name = `assembly-edges:${source.id}`;
  edges.userData.assemblyEdges = true;
  edges.userData.assemblyInstanceId = instanceId;
  edges.userData.assemblyMeshId = source.id;
  mesh.add(edges);
  return mesh;
}

function mechanicalAssetScene(asset: MechanicalAsset, instanceId: string): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const group = new THREE.Group();
  group.name = `mechanical-asset:${asset.id}`;
  const pickables = asset.meshes.map(mesh => mechanicalMesh(mesh, instanceId));
  group.add(...pickables);
  return { group, pickables };
}

function boardThickness(asset: BoardAsset): number {
  return asset.board.stackup.reduce((sum, layer) => sum + (layer.thickness ?? 0), 0) || 1.6;
}

function boardAssetScene(asset: BoardAsset, instanceId: string): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const center: [number, number, number] = [
    (asset.board.bounds.minX + asset.board.bounds.maxX) / 2,
    (asset.board.bounds.minY + asset.board.bounds.maxY) / 2,
    0,
  ];
  const visual: VirtualBoardVisual = {
    id: instanceId,
    name: asset.name,
    designId: asset.id,
    active: true,
    widthMm: asset.board.width,
    heightMm: asset.board.height,
    thicknessMm: boardThickness(asset),
    localCenterMm: center,
    transform: IDENTITY,
  };
  const built = boardInstanceScene(visual, false, [], { source: asset.board });
  // boardInstanceScene reconstructs source X/Y coordinates. Convert the
  // source Y-down frame once beneath the rigid occurrence root.
  const frame = new THREE.Group();
  frame.name = `board-source-frame:${asset.id}`;
  frame.scale.set(1, -1, 1);
  frame.userData.boardSourceYDown = true;
  frame.add(built.group);
  return { group: frame, pickables: built.pickables };
}

function tagTree(root: THREE.Object3D, instanceId: string): void {
  root.traverse(object => { object.userData.assemblyInstanceId ??= instanceId; });
}

export function buildAssemblyScene(document: AssemblyDocument): AssemblyScene {
  const group = new THREE.Group();
  group.name = "assembly-document";
  const assets = new Map(document.assets.map(asset => [asset.id, asset]));
  const instances = new Map<string, THREE.Group>();
  const pickables: THREE.Object3D[] = [];
  const diagnostics: AssemblyScene["diagnostics"] = [];
  for (const instance of document.instances) {
    const asset = assets.get(instance.assetId);
    if (!asset) continue;
    const occurrence = new THREE.Group();
    occurrence.name = `assembly-instance:${instance.id}`;
    occurrence.userData.assemblyInstanceId = instance.id;
    occurrence.userData.assemblyAssetId = asset.id;
    occurrence.matrix.copy(rigidMatrixToThree(instance.transform));
    occurrence.matrixAutoUpdate = false;
    const built = asset.kind === "board" ? boardAssetScene(asset, instance.id) : mechanicalAssetScene(asset, instance.id);
    tagTree(built.group, instance.id);
    occurrence.add(built.group);
    group.add(occurrence);
    instances.set(instance.id, occurrence);
    pickables.push(...built.pickables);
    for (const object of built.pickables) {
      const meshId = String(object.userData.assemblyMeshId ?? object.name);
      if (object.userData.assemblyFacePaletteTruncated) diagnostics.push({
        code: "face_palette_bounded", instanceId: instance.id, meshId,
        message: `${instance.name} / ${meshId}: face-color palette exceeded ${MAX_FACE_MATERIALS}; additional colors use the mesh base color.`,
      });
      if (object.userData.assemblyFaceGroupsTruncated) diagnostics.push({
        code: "face_groups_bounded", instanceId: instance.id, meshId,
        message: `${instance.name} / ${meshId}: face-color draw groups exceeded ${MAX_FACE_GROUPS}; remaining faces use the mesh base color.`,
      });
    }
  }
  group.updateMatrixWorld(true);
  return { group, instances, pickables, diagnostics };
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
  });
  return materials;
}

export function updateAssemblyScene(
  scene: AssemblyScene,
  document: AssemblyDocument,
  options: { selectedId?: string; isolatedId?: string; showEdges?: boolean; section?: AssemblySection },
): void {
  const records = new Map(document.instances.map(instance => [instance.id, instance]));
  for (const [id, root] of scene.instances) {
    const instance = records.get(id);
    if (!instance) { root.visible = false; continue; }
    root.visible = instance.visible && (!options.isolatedId || options.isolatedId === id) && instance.opacity > 0;
    const transform = rigidMatrixToThree(instance.transform);
    if (root.matrixAutoUpdate) transform.decompose(root.position, root.quaternion, root.scale);
    else root.matrix.copy(transform);
    root.userData.assemblyLocked = instance.locked;
    root.traverse(object => { if (object.userData.assemblyEdges) object.visible = options.showEdges === true; });
    for (const material of materialsOf(root)) {
      material.userData.assemblyOpacity ??= material.opacity;
      material.userData.assemblyTransparent ??= material.transparent;
      material.userData.assemblyDepthWrite ??= material.depthWrite;
      material.opacity = Number(material.userData.assemblyOpacity) * instance.opacity;
      material.transparent = Boolean(material.userData.assemblyTransparent) || material.opacity < 1;
      material.depthWrite = Boolean(material.userData.assemblyDepthWrite) && material.opacity >= 1;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.userData.assemblyEmissive ??= material.emissive.getHex();
        material.emissive.setHex(id === options.selectedId ? 0x17394a : Number(material.userData.assemblyEmissive));
      }
    }
  }
  const section = options.section?.enabled ? options.section : undefined;
  const normal = new THREE.Vector3(section?.axis === "x" ? 1 : 0, section?.axis === "y" ? 1 : 0, section?.axis === "z" ? 1 : 0);
  if (section?.flipped) normal.multiplyScalar(-1);
  const plane = section ? new THREE.Plane(normal, -section.offsetMm * (section.flipped ? -1 : 1)) : null;
  for (const material of materialsOf(scene.group)) {
    material.clippingPlanes = plane ? [plane] : [];
    material.clipShadows = Boolean(plane);
    material.needsUpdate = true;
  }
  scene.group.updateMatrixWorld(true);
}

export function replaceVirtualOverlays(scene: AssemblyScene, document: AssemblyDocument, frameIndex: number, visible: boolean): void {
  const assets = new Map(document.assets.map(asset => [asset.id, asset]));
  const records = new Map(document.instances.map(instance => [instance.id, instance]));
  for (const [id, root] of scene.instances) {
    const previous = root.getObjectByName("assembly-virtual-overlays");
    if (previous) { root.remove(previous); disposeScene(previous); }
    const asset = assets.get(records.get(id)?.assetId ?? "");
    if (!visible || asset?.kind !== "board" || !asset.layers?.length) continue;
    const overlays = buildVirtualOverlayScene(asset.layers, frameIndex, { centerX: 0, centerY: 0, scale: 1 });
    overlays.name = "assembly-virtual-overlays";
    overlays.userData.assemblyInstanceId = id;
    tagTree(overlays, id);
    root.add(overlays);
  }
  scene.group.updateMatrixWorld(true);
}

export function replaceAssemblyAnchors(scene: AssemblyScene, anchors: readonly AssemblyAnchor[], selectedId?: string): void {
  for (const root of scene.instances.values()) {
    const previous = root.getObjectByName("assembly-anchors");
    if (previous) { root.remove(previous); disposeScene(previous); }
    const group = new THREE.Group();
    group.name = "assembly-anchors";
    for (const anchor of anchors.filter(value => value.instanceId === root.userData.assemblyInstanceId)) {
      const selected = anchor.id === selectedId;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 1.15 : 0.75, 10, 7),
        new THREE.MeshBasicMaterial({ color: selected ? 0xffca55 : 0x45d7ee, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      marker.position.fromArray(anchor.point);
      marker.name = `assembly-anchor:${anchor.id}`;
      marker.renderOrder = 400;
      marker.userData.assemblyAnchor = anchor;
      marker.userData.assemblyInstanceId = anchor.instanceId;
      group.add(marker);
    }
    root.add(group);
  }
  scene.group.updateMatrixWorld(true);
}

function ancestorData(object: THREE.Object3D, key: string): unknown {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData[key] !== undefined) return current.userData[key];
    current = current.parent;
  }
  return undefined;
}

export function assemblyAnchorFromIntersection(hit: THREE.Intersection): AssemblyAnchor | null {
  return (ancestorData(hit.object, "assemblyAnchor") as AssemblyAnchor | undefined) ?? null;
}

/** Match ray picking to material visibility and the renderer's active clipping half-spaces. */
export function assemblyIntersectionVisible(hit: THREE.Intersection): boolean {
  const object = hit.object;
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return true;
  const material = Array.isArray(object.material)
    ? object.material[hit.face?.materialIndex ?? 0]
    : object.material;
  if (!material?.visible || material.opacity <= 0) return false;
  // Three.js discards the positive side of each local clipping plane.
  return !(material.clippingPlanes ?? []).some((plane: THREE.Plane) => plane.distanceToPoint(hit.point) > 1e-7);
}

export function assemblyVirtualPickFromIntersection(hit: THREE.Intersection): (VirtualPick & { instanceId: string }) | null {
  const pick = pickVirtualIntersection(hit);
  const instanceId = ancestorData(hit.object, "assemblyInstanceId");
  return pick && typeof instanceId === "string" ? { ...pick, instanceId } : null;
}

export function assemblyPickFromIntersection(
  hit: THREE.Intersection,
  scene: AssemblyScene,
  mode: "surface" | "vertex" = "surface",
): AssemblyPick | null {
  const instanceId = ancestorData(hit.object, "assemblyInstanceId");
  if (typeof instanceId !== "string") return null;
  const root = scene.instances.get(instanceId);
  if (!root) return null;
  let worldPoint = hit.point.clone();
  let kind: "surface" | "vertex" = "surface";
  if (mode === "vertex" && hit.face
    && (hit.object instanceof THREE.Mesh || hit.object instanceof THREE.Line || hit.object instanceof THREE.Points)) {
    const positions = hit.object.geometry.getAttribute("position");
    if (positions) {
      let distance = Infinity;
      for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
        if (index < 0 || index >= positions.count) continue;
        const candidate = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(hit.object.matrixWorld);
        const next = candidate.distanceToSquared(hit.point);
        if (next < distance) { distance = next; worldPoint = candidate; kind = "vertex"; }
      }
    }
  }
  const localPoint = root.worldToLocal(worldPoint.clone());
  let localNormal: [number, number, number] | undefined;
  if (hit.face) {
    const worldNormal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    const localEnd = root.worldToLocal(worldPoint.clone().add(worldNormal));
    localNormal = localEnd.sub(localPoint).normalize().toArray() as [number, number, number];
  }
  return {
    instanceId,
    kind,
    localPoint: localPoint.toArray() as [number, number, number],
    worldPoint: worldPoint.toArray() as [number, number, number],
    ...(localNormal ? { localNormal } : {}),
    ...(typeof ancestorData(hit.object, "assemblyMeshId") === "string"
      ? { meshId: ancestorData(hit.object, "assemblyMeshId") as string } : {}),
    ...(typeof hit.faceIndex === "number" ? { triangleIndex: hit.faceIndex } : {}),
  };
}

export function disposeAssemblyScene(scene: AssemblyScene): void {
  disposeScene(scene.group);
  scene.instances.clear();
  scene.pickables.length = 0;
  scene.diagnostics.length = 0;
}
