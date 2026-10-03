// SPDX-License-Identifier: Apache-2.0
import {
  BufferGeometry,
  LoadingManager,
  Matrix3,
  Mesh,
  Object3D,
  Texture,
  Vector3,
  type Material,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { AssemblyMesh } from "../src/assembly/types";
import { ASSEMBLY_LIMITS } from "../src/assembly/validation";

export type MeshUnit = "mm" | "cm" | "m" | "in";
export type MeshFormat = "glb" | "stl" | "obj";

const UNIT_TO_MM: Record<MeshUnit, number> = { mm: 1, cm: 10, m: 1_000, in: 25.4 };

type AxisConvention = "z-up" | "gltf-y-up";

function toAssemblyAxes(vector: Vector3, convention: AxisConvention): Vector3 {
  if (convention === "gltf-y-up") {
    const sourceY = vector.y;
    vector.y = -vector.z;
    vector.z = sourceY;
  }
  return vector;
}

function materialColor(material: Material | Material[] | undefined): [number, number, number] | undefined {
  const first = Array.isArray(material) ? material[0] : material;
  const color = (first as Material & { color?: { r: number; g: number; b: number } } | undefined)?.color;
  return color ? [color.r, color.g, color.b] : undefined;
}

function extractMeshes(root: Object3D, scaleToMm: number, fallbackName: string, axes: AxisConvention): AssemblyMesh[] {
  root.updateMatrixWorld(true);
  const output: AssemblyMesh[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || !(object.geometry instanceof BufferGeometry)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.itemSize !== 3 || position.count === 0) return;
    const normal = geometry.getAttribute("normal");
    const point = new Vector3();
    const transformedNormal = new Vector3();
    const normalMatrix = new Matrix3().getNormalMatrix(object.matrixWorld);
    const positions = new Array<number>(position.count * 3);
    const normals = normal && normal.itemSize === 3 && normal.count === position.count
      ? new Array<number>(normal.count * 3)
      : undefined;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      toAssemblyAxes(point, axes).multiplyScalar(scaleToMm);
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      if (normals && normal) {
        transformedNormal.fromBufferAttribute(normal, index).applyMatrix3(normalMatrix).normalize();
        toAssemblyAxes(transformedNormal, axes);
        normals[index * 3] = transformedNormal.x;
        normals[index * 3 + 1] = transformedNormal.y;
        normals[index * 3 + 2] = transformedNormal.z;
      }
    }
    const sourceIndex = geometry.getIndex();
    const indices = sourceIndex
      ? Array.from(sourceIndex.array, Number)
      : Array.from({ length: position.count }, (_, index) => index);
    if (indices.length % 3) throw new Error("Imported mesh does not contain complete triangles.");
    if (object.matrixWorld.determinant() < 0) {
      for (let index = 0; index < indices.length; index += 3) {
        [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
      }
    }
    totalVertices += position.count;
    totalTriangles += indices.length / 3;
    if (totalVertices > ASSEMBLY_LIMITS.vertices || totalTriangles > ASSEMBLY_LIMITS.triangles) {
      throw new Error(`Mesh exceeds ${ASSEMBLY_LIMITS.vertices.toLocaleString()} vertices or ${ASSEMBLY_LIMITS.triangles.toLocaleString()} triangles.`);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const faces = geometry.groups.length ? geometry.groups.map(group => ({
      first: Math.floor(group.start / 3),
      last: Math.floor((group.start + group.count - 1) / 3),
      color: materialColor(materials[group.materialIndex ?? 0]),
    })) : undefined;
    output.push({
      id: crypto.randomUUID(),
      name: object.name.trim() || `${fallbackName} ${output.length + 1}`,
      positions,
      indices,
      normals,
      color: materialColor(object.material),
      faces,
    });
  });
  if (!output.length) throw new Error("The file contains no triangle meshes.");
  return output;
}

function disposeObjectResources(roots: readonly Object3D[]): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const closeableImages = new Set<{ close: () => void }>();
  for (const root of roots) root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object.geometry instanceof BufferGeometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach(material => {
      if (!material) return;
      materials.add(material);
      Object.values(material).forEach(value => {
        if (value instanceof Texture) textures.add(value);
      });
    });
  });
  textures.forEach(texture => {
    const image = texture.source?.data as { close?: () => void } | undefined;
    if (typeof image?.close === "function") closeableImages.add(image as { close: () => void });
    texture.dispose();
  });
  closeableImages.forEach(image => image.close());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function assertEmbeddedGlb(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("The selected file is not a binary GLB document.");
  if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error("Unsupported or truncated GLB document.");
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) throw new Error("GLB JSON chunk is missing or truncated.");
  let document: { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
  try {
    document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/\0+$/g, ""));
  } catch {
    throw new Error("GLB JSON is invalid.");
  }
  for (const item of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (item.uri && !item.uri.startsWith("data:")) {
      throw new Error("External GLB resources are not loaded. Embed buffers and images in the GLB file.");
    }
  }
}

function isolatedLoadingManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (/^(?:data|blob):/i.test(url)) return url;
    throw new Error("External model resources are not loaded.");
  });
  return manager;
}

export async function importMesh(
  bytes: Uint8Array,
  format: MeshFormat,
  unit: MeshUnit,
  fallbackName: string,
): Promise<AssemblyMesh[]> {
  const scale = UNIT_TO_MM[unit];
  const ownedBuffer = Uint8Array.from(bytes).buffer;
  if (format === "stl") {
    const geometry = new STLLoader().parse(ownedBuffer);
    const root = new Mesh(geometry);
    try {
      return extractMeshes(root, scale, fallbackName, "z-up");
    } finally {
      disposeObjectResources([root]);
    }
  }
  if (format === "obj") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/^\s*mtllib\s+/im.test(text)) throw new Error("OBJ material libraries are external resources and are not loaded.");
    const root = new OBJLoader().parse(text);
    try {
      return extractMeshes(root, scale, fallbackName, "z-up");
    } finally {
      disposeObjectResources([root]);
    }
  }
  assertEmbeddedGlb(bytes);
  const gltf = await new GLTFLoader(isolatedLoadingManager()).parseAsync(
    ownedBuffer,
    "",
  );
  try {
    return extractMeshes(gltf.scene, scale, fallbackName, "gltf-y-up");
  } finally {
    disposeObjectResources(gltf.scenes);
  }
}
