// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import type { ParsedBoard } from "./boardParser";

const selectionState = new WeakMap<THREE.Object3D, { selected: boolean; linked: readonly string[]; children: number }>();
const visibilityState = new WeakMap<THREE.Object3D, { source: ParsedBoard; layers: Record<string, boolean>; opacity: Record<string, number>; showVias: boolean; children: number; revision: number }>();
const sameSettings = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);

export function updateAssemblySceneSelection(group: THREE.Object3D, selected: boolean, linked: readonly string[]) {
  const previous = selectionState.get(group);
  if (previous && previous.children === group.children.length && previous.selected === selected
    && previous.linked.length === linked.length && previous.linked.every((net, i) => net === linked[i])) return 0;
  selectionState.set(group, { selected, linked: [...linked], children: group.children.length });
  group.userData.assemblySelectionRevision = (group.userData.assemblySelectionRevision ?? 0) + 1;
  const nets = new Set(linked);
  let visited = 0;
  group.traverse(object => {
    visited++;
    const kind = String(object.userData.sceneKind ?? "");
    const copper = kind.startsWith("copper-") || kind.startsWith("via-");
    if (copper) object.userData.linkedAssemblyNet = nets.has(object.userData.canonicalNetId);
    if (!(object instanceof THREE.Mesh) || (!copper && kind !== "substrate")) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)) continue;
      material.userData.assemblyBaseColor ??= material.color.getHex();
      material.color.setHex(copper && object.userData.linkedAssemblyNet ? 0x55e5d5
        : kind === "substrate" && selected ? 0x6c913a : material.userData.assemblyBaseColor);
    }
  });
  return visited;
}

/** Update occurrence display only; layer controls never change retained geometry. */
export function applyAssemblySceneVisibility(group: THREE.Object3D, source: ParsedBoard,
  layers: Record<string, boolean>, opacity: Record<string, number>, showVias: boolean) {
  const revision = group.userData.assemblySelectionRevision ?? 0;
  const previous = visibilityState.get(group);
  if (previous && previous.source === source && previous.showVias === showVias && previous.children === group.children.length
    && previous.revision === revision && sameSettings(previous.layers, layers) && sameSettings(previous.opacity, opacity)) return 0;
  visibilityState.set(group, { source, layers: { ...layers }, opacity: { ...opacity }, showVias, children: group.children.length, revision });
  const copper = source.layers.filter(layer => layer.endsWith(".Cu"));
  const defaultVisible = (name: string) => name === "Board body" || name.endsWith(".Cu") || name.endsWith(".Mask") || name.endsWith(".SilkS") || name === "Edge.Cuts";
  const filtered = Object.entries(layers).some(([name, value]) => value !== defaultVisible(name))
    || Object.values(opacity).some(value => value !== 1) || !showVias;
  let bakedBoard = false;
  group.traverse(object => { if (object.userData.kiCadSceneKind === "board") bakedBoard = true; });
  const bakedCopperVisible = bakedBoard && source.boardModelIncludesCopper && !filtered;
  let visited = 0;
  group.traverse(object => {
    visited++;
    const data = object.userData;
    if (data.kiCadSceneKind === "board") object.visible = !filtered && layers["Board body"] !== false;
    const kind = String(data.sceneKind ?? "");
    if (kind === "substrate") object.visible = layers["Board body"] !== false && !(bakedBoard && !filtered);
    else if (kind.startsWith("via-")) object.visible = showVias && copper.some(layer => layers[layer] !== false);
    else if (data.layer && !data.authoritativeModel && kind !== "component-model") object.visible = layers[data.layer] !== false;
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    const logicalCopper = kind.startsWith("copper-") || kind.startsWith("via-");
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.userData.assemblyBaseOpacity ??= logicalCopper ? 1 : material.opacity;
      const hiddenCopper = logicalCopper && bakedCopperVisible && !data.linkedAssemblyNet;
      const value = opacity[data.layer] ?? 1;
      const layerOpacity = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
      material.opacity = hiddenCopper ? 0 : material.userData.assemblyBaseOpacity * layerOpacity;
      material.transparent = material.opacity < 1;
      if (logicalCopper) { material.colorWrite = !hiddenCopper; material.depthWrite = !hiddenCopper && material.opacity === 1; }
    }
  });
  return visited;
}
