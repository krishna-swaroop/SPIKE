// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildEMViewportScene, emViewportSampleIndexForIntersection } from '../src/emViewportScene.ts';
import { disposeScene } from '../src/sceneResourceCache.ts';

const transform = { centerX: 10, centerY: 20, scale: 2 };
const settings = { style: 'surface', opacity: .7, nodes: true, antinodes: true, showStructure: true, selectedSample: 1 };
const data = { domain: 'spatial', frequencyHz: 1e9, label: 'Actual E phase', unit: 'V/m',
  positionsMm: [[10, 20, 1], [12, 20, 1], [10, 22, 1], [12, 22, 1]],
  indices: [0, 1, 2, 1, 3, 2], values: [-1, 0, 1, null],
  directions: [[1, 2, 0], null, [0, 0, 0], [1, 0, 0]],
  highlights: ['node', null, 'antinode', 'antinode'], range: [-1, 2], notices: ['Unvalidated sampled plane'],
  structure: { vertices_mm: [[10, 20, 1000], [11, 20, 1000], [10, 21, 1000]], triangles: [[0, 1, 2]] } };
const scene = buildEMViewportScene(data, settings, transform);
assert.equal(scene.userData.emOverlay, true);
assert.equal(buildEMViewportScene(data, { ...settings, visible: false }, transform).children.length, 0, 'hidden overlay has no invisible probe targets');
assert.equal(scene.userData.emDisplaySphere, false);
const surface = scene.getObjectByName('EM scalar surface');
assert.deepEqual(Array.from(surface.geometry.index.array), [0, 1, 2], 'invalid sample prevents filling every incident cell');
assert.deepEqual(Array.from(surface.geometry.attributes.position.array.slice(0, 9)), [0, 0, 2, 4, 0, 2, 0, -4, 2], 'millimetres use the existing board transform with one Y inversion');
const neutral = new THREE.Color(0xf5f5f2);
const colors = surface.geometry.attributes.color;
for (const [axis, value] of [[0, neutral.r], [1, neutral.g], [2, neutral.b]]) assert.ok(Math.abs(colors.array[3+axis]-value) < 1e-6, 'zero remains neutral under asymmetric signed bounds');
assert.equal(surface.userData.emDisplayInterpolation, true);
assert.equal(emViewportSampleIndexForIntersection({ object: surface, face: { a: 0, b: 1, c: 2 }, point: new THREE.Vector3(3.9, 0, 2) }), 1, 'surface probing chooses a solved vertex rather than an invented interpolated field');
const node = scene.getObjectByName('EM node threshold candidates');
const antinode = scene.getObjectByName('EM antinode threshold candidates');
assert.equal(node.count, 1);
assert.equal(antinode.count, 1, 'invalid null sample never becomes an antinode glyph');
assert.equal(node.userData.emThresholdCandidates, true);
assert.equal(emViewportSampleIndexForIntersection({ object: node, instanceId: 0 }), 0);
const structure = scene.getObjectByName('EM numerical STEP structure');
assert.equal(structure.geometry.attributes.position.getZ(0), 2000, 'already placed world mesh is not translated again');
const aligned = buildEMViewportScene(data, settings, { ...transform, zOffsetMm: .8 });
assert.ok(Math.abs(aligned.getObjectByName('EM scalar surface').geometry.attributes.position.getZ(0)-3.6)<1e-6, 'top-copper solver origin aligns with a PCB centered at half thickness');
assert.ok(Math.abs(aligned.getObjectByName('EM numerical STEP structure').geometry.attributes.position.getZ(0)-2001.6)<1e-4, 'structure and samples receive the same display-frame offset');
disposeScene(aligned);
assert.equal(emViewportSampleIndexForIntersection({ object: structure, index: 0 }), null, 'CAD facets cannot fabricate field probes');
assert.equal(scene.getObjectByName('EM selected solved sample').userData.emSampleIndex, 1);

const vectors = buildEMViewportScene(data, { ...settings, style: 'vectors', nodes: false, antinodes: false, showStructure: false, selectedSample: -1 }, transform);
const arrows = vectors.children[0];
assert.equal(arrows.userData.emGlyphCount, 1, 'zero, null and invalid field vectors are omitted');
const buffer = arrows.geometry.attributes.position;
const difference = new THREE.Vector3(buffer.getX(1)-buffer.getX(0), buffer.getY(1)-buffer.getY(0), buffer.getZ(1)-buffer.getZ(0)).normalize();
assert.ok(Math.abs(difference.x-1/Math.sqrt(5)) < 1e-6);
assert.ok(Math.abs(difference.y+2/Math.sqrt(5)) < 1e-6, 'directions share the board Y sign convention');
assert.equal(arrows.userData.emNormalizedDirections, true);
assert.equal(emViewportSampleIndexForIntersection({ object: arrows, index: 4 }), 0);

const contours = buildEMViewportScene(data, { ...settings, style: 'contours', nodes: false, antinodes: false, showStructure: false, selectedSample: -1 }, transform);
assert.ok(contours.children[0].geometry.attributes.position.count > 0);
assert.equal(contours.children[0].userData.emDisplayInterpolation, true);
assert.ok(contours.children[0].userData.emSampleIndices.every(index => index < 3), 'contours do not bridge masked cells');
const samples = buildEMViewportScene(data, { ...settings, style: 'samples', selectedSample: 3 }, transform);
assert.equal(samples.getObjectByName('EM solved samples').geometry.attributes.position.count, 3);
assert.equal(samples.getObjectByName('EM selected solved sample'), undefined, 'invalid selection cannot display a probe marker');
assert.equal(emViewportSampleIndexForIntersection({ object: samples.getObjectByName('EM solved samples'), index: 2 }), 2);

const angular = buildEMViewportScene({ ...data, domain: 'angular', notices: ['Display sphere, not a spatial field'], structure: undefined }, { ...settings, showStructure: false }, transform);
assert.equal(angular.userData.emDisplaySphere, true);
assert.deepEqual(angular.getObjectByName('EM scalar surface').geometry.attributes.position.array, surface.geometry.attributes.position.array, 'renderer preserves pre-positioned display sphere; it never substitutes a physical observer radius');
const localAngular = { ...data, domain: 'angular', angularNeedsBoardAnchor: true,
  positionsMm: [[0, 0, 1], [2, 0, 1], [0, 2, 1], [2, 2, 1]] };
const anchored = buildEMViewportScene(localAngular, settings, { ...transform, angularAnchorMm: [12, 21] });
assert.deepEqual(Array.from(anchored.getObjectByName('EM scalar surface').geometry.attributes.position.array.slice(0, 9)), [4, -2, 2, 8, -2, 2, 4, -6, 2], 'local angular pattern follows antenna coordinates on an offset PCB');
assert.deepEqual(anchored.getObjectByName('EM selected solved sample').position.toArray(), [8, -2, 2], 'probe marker follows the same antenna display frame');
assert.equal(anchored.getObjectByName('EM numerical STEP structure').geometry.attributes.position.getZ(0), 2000, 'physical mechanical structure is not moved with angular samples');
const centered = buildEMViewportScene(localAngular, settings, transform);
assert.deepEqual(Array.from(centered.getObjectByName('EM scalar surface').geometry.attributes.position.array.slice(0, 3)), [0, 0, 2], 'missing antenna falls back to the focused board center, not the CAD origin');
disposeScene(anchored); disposeScene(centered);
assert.throws(() => buildEMViewportScene(data, settings, { ...transform, scale: NaN }), /finite board transform/);
const malformedStructure = buildEMViewportScene({ ...data, structure: { vertices_mm: [[NaN, 1, 2]], triangles: [[0, 0, 0]] } }, settings, transform);
assert.equal(malformedStructure.getObjectByName('EM numerical STEP structure'), undefined);

const dense = { ...data, positionsMm: Array.from({ length: 10000 }, (_, index) => [index, 0, 0]),
  values: Array(10000).fill(1), directions: Array(10000).fill([1, 0, 0]), highlights: Array(10000).fill(null), indices: [], structure: undefined };
const bounded = buildEMViewportScene(dense, { ...settings, style: 'vectors', showStructure: false, selectedSample: -1 }, transform);
assert.ok(bounded.children[0].userData.emGlyphCount <= 2048);
assert.equal(bounded.children[0].userData.emGlyphDecimated, true, 'direction glyph LOD is disclosed');

let geometryDisposals = 0, materialDisposals = 0;
scene.traverse(object => { if (object.geometry) object.geometry.addEventListener('dispose', () => geometryDisposals++);
  if (object.material) object.material.addEventListener('dispose', () => materialDisposals++); });
const resources = scene.children.length;
disposeScene(scene);
assert.equal(scene.children.length, 0);
assert.equal(geometryDisposals, resources, 'owned GPU geometry is released');
assert.equal(materialDisposals, resources, 'owned GPU material is released');
for (const root of [vectors, contours, samples, angular, malformedStructure, bounded]) disposeScene(root);
console.log('EM viewport scene: physical/display coordinates, invalid masks, normalized vectors, display contours, highlights, picking, structure placement and disposal passed.');
