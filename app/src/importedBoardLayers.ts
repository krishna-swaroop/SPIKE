// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import { classifyBoardSurface } from "./boardSurfaceMaterials";

/** Address KiCad export fragments before draw-call consolidation. Export Y is
 * board thickness; occurrence placement and camera orientation never determine
 * a layer. Call on an owned scene clone; material instances are shared only
 * within one layer in this scene. Geometry and textures remain shared. */
export function tagImportedBoardLayers(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const inverse = scene.matrixWorld.clone().invert();
  const body = new THREE.Box3();
  const fragments: { mesh: THREE.Mesh; bounds: THREE.Box3; surface: string }[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const surfaces = materials.map(material => material instanceof THREE.MeshStandardMaterial
      ? classifyBoardSurface(material, object.name) : "unknown");
    const surface = surfaces.every(value => value === surfaces[0]) ? surfaces[0] : "unknown";
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    const bounds = object.geometry.boundingBox.clone().applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
      object.userData.importedBoardUnaddressable = true;
      return;
    }
    fragments.push({ mesh: object, bounds, surface });
    if (surface === "substrate") body.union(bounds);
  });
  // Without a substrate reference we cannot infer sides safely. Preserve an
  // explicit exporter layer, otherwise let the caller use retained geometry.
  const center = body.isEmpty() ? null : (body.min.y + body.max.y) / 2;
  const halfThickness = body.isEmpty() ? 0 : (body.max.y - body.min.y) / 2;
  const materialsByLayer = new Map<string, THREE.Material>();
  const replacedMaterials = new Set<THREE.Material>();
  const covered = new Set<string>();
  for (const { mesh, bounds, surface } of fragments) {
    const explicit = /(?:^|[^\w])(F\.(?:Cu|Mask|SilkS)|B\.(?:Cu|Mask|SilkS)|In\d+\.Cu)(?:$|[^\w])/.exec(mesh.name)?.[1];
    let layer = explicit;
    // A consolidated exporter mesh can contain both faces and through plating.
    // Separate triangle ranges once, before renderer batching can merge them.
    if (!explicit && center !== null && surface === "copper" && !Array.isArray(mesh.material)
      && mesh.parent && mesh.children.length === 0 && bounds.min.y < center - halfThickness * .5
      && bounds.max.y > center + halfThickness * .5) {
      const position = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const buckets = new Map<string, number[]>();
      const point = new THREE.Vector3();
      const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const vertices = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset);
        const heights = vertices.map(vertex => point.fromBufferAttribute(position, vertex).applyMatrix4(transform).y);
        const low = Math.min(heights[0], heights[1], heights[2]), high = Math.max(heights[0], heights[1], heights[2]);
        const triangleLayer = low < center - halfThickness * .5 && high > center + halfThickness * .5
          ? "through" : (low + high) / 2 >= center ? "F.Cu" : "B.Cu";
        const values = buckets.get(triangleLayer) ?? []; values.push(...vertices); buckets.set(triangleLayer, values);
      }
      if (buckets.size > 1) {
        const parent = mesh.parent;
        for (const [triangleLayer, indices] of buckets) {
          const part = mesh.clone(false);
          part.geometry = mesh.geometry.clone(); part.geometry.setIndex(indices); part.geometry.clearGroups();
          part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
          part.userData.importedBoardLayer = triangleLayer;
          part.userData.importedBoardSurface = surface;
          const key = `${mesh.material.uuid}:${triangleLayer}`;
          let independent = materialsByLayer.get(key);
          if (!independent) { independent = mesh.material.clone(); materialsByLayer.set(key, independent); }
          part.material = independent; covered.add(triangleLayer); parent.add(part);
        }
        parent.remove(mesh);
        replacedMaterials.add(mesh.material);
        continue;
      }
    }
    if (!layer && surface === "substrate") layer = "Board body";
    if (!layer && center !== null) {
      const side = (bounds.min.y + bounds.max.y) / 2 >= center ? "F" : "B";
      if (surface === "copper") layer = bounds.min.y < center - halfThickness * .5
        && bounds.max.y > center + halfThickness * .5 ? "through" : `${side}.Cu`;
      if (surface === "soldermask") layer = `${side}.Mask`;
      if (surface === "silkscreen") layer = `${side}.SilkS`;
    }
    if (!layer) { mesh.userData.importedBoardUnaddressable = true; continue; }
    covered.add(layer);
    mesh.userData.importedBoardLayer = layer;
    mesh.userData.importedBoardSurface = surface;
    const separate = (material: THREE.Material) => {
      replacedMaterials.add(material);
      const key = `${material.uuid}:${layer}`;
      let independent = materialsByLayer.get(key);
      if (!independent) { independent = material.clone(); materialsByLayer.set(key, independent); }
      return independent;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(separate) : separate(mesh.material);
  }
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) replacedMaterials.delete(material);
  });
  replacedMaterials.forEach(material => material.dispose());
  scene.userData.importedBoardLayers = [...covered];
  return covered;
}

export function importedBoardLayerVisible(layer: string, layers: Readonly<Record<string, boolean>>,
  copper: readonly string[], showVias: boolean) {
  return layer === "through" ? showVias && copper.some(name => layers[name] !== false) : layers[layer] !== false;
}
