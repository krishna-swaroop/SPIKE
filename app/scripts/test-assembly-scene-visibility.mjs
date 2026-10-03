// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";
import * as THREE from "three";
const target = new URL("./.test-assemblySceneVisibility.mjs", import.meta.url);
try {
  writeFileSync(target, ts.transpileModule(readFileSync(new URL("../src/assemblySceneVisibility.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const { applyAssemblySceneVisibility, updateAssemblySceneSelection } = await import(target.href);
  function occurrence() {
    const root = new THREE.Group(), asset = new THREE.Group(); asset.userData.kiCadSceneKind = "board";
    const substrate = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); substrate.userData.sceneKind = "substrate";
    const copper = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xc47b2b }));
    copper.userData = { sceneKind: "copper-track", layer: "F.Cu", canonicalNetId: "gnd" };
    root.add(asset, substrate, copper); return { root, asset, substrate, copper };
  }
  const a = occurrence(), b = occurrence(), source = { layers: ["F.Cu", "B.Cu"], boardModelIncludesCopper: true };
  applyAssemblySceneVisibility(a.root, source, {}, {}, true);
  assert.equal(a.substrate.visible, false); assert.equal(a.asset.visible, true); assert.equal(a.copper.material.colorWrite, false);
  applyAssemblySceneVisibility(b.root, source, { "F.Cu": false }, {}, true);
  assert.equal(b.asset.visible, false); assert.equal(b.substrate.visible, true); assert.equal(b.copper.visible, false);
  assert.equal(a.copper.visible, true, "one board's hidden layer never hides another occurrence");
  const geometry = a.copper.geometry;
  updateAssemblySceneSelection(a.root, true, ["gnd"]);
  applyAssemblySceneVisibility(a.root, source, {}, {}, true);
  assert.equal(a.copper.material.color.getHex(), 0xffd32a); assert.equal(a.copper.material.colorWrite, true);
  updateAssemblySceneSelection(a.root, false, []); applyAssemblySceneVisibility(a.root, source, {}, {}, true);
  assert.equal(a.copper.geometry, geometry, "selection reuses GPU geometry"); assert.equal(a.copper.material.color.getHex(), 0xc47b2b);
  assert.equal(a.copper.material.colorWrite, false);
  assert.equal(updateAssemblySceneSelection(a.root, false, []), 0, "unchanged selection skips all meshes");
  assert.equal(applyAssemblySceneVisibility(a.root, source, {}, {}, true), 0, "placement updates skip unchanged layer traversal");
  const settings = { "F.Cu": 1 };
  applyAssemblySceneVisibility(a.root, source, {}, settings, true);
  settings["F.Cu"] = .35;
  assert.ok(applyAssemblySceneVisibility(a.root, source, {}, settings, true) > 0, "in-place settings changes invalidate cached visibility");
  assert.equal(a.copper.material.opacity, .35);
  assert.equal(a.copper.material.depthWrite, false);
  settings["F.Cu"] = Infinity; applyAssemblySceneVisibility(a.root, source, {}, settings, true);
  assert.equal(a.copper.material.opacity, 1, "invalid opacity never produces a corrupt GPU material");
  settings["F.Cu"] = -2; applyAssemblySceneVisibility(a.root, source, {}, settings, true);
  assert.equal(a.copper.material.opacity, 0);
  const late = new THREE.Group(); late.userData.kiCadSceneKind = "board"; a.root.add(late);
  assert.ok(applyAssemblySceneVisibility(a.root, source, {}, {}, false) > 0, "late model mounts invalidate traversal caches");
  assert.equal(late.visible, false, "hiding vias disables baked geometry with unfilterable vias");
  applyAssemblySceneVisibility(a.root, source, {}, {}, true); assert.equal(late.visible, true);
  console.log("Occurrence layer isolation, baked geometry fallback and selection reuse passed");
} finally { unlinkSync(target); }
