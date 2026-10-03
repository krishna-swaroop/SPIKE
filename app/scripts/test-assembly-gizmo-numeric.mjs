// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";
import * as THREE from "three";

const generated = ["assemblyGizmoGesture", "assemblyGizmoNumericInput"];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
const vectorNear = (actual, expected, message) => actual.toArray().forEach((value, index) => near(value, expected[index], message));
try {
  for (const name of generated) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
    let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    output = output.replace('"./assemblyGizmoGesture"', '"./.test-assemblyGizmoGesture.mjs"')
      .replace('import "./assemblyGizmoNumericInput.css";', "");
    writeFileSync(new URL(`./.test-${name}.mjs`, import.meta.url), output);
  }
  const { AssemblyGizmoGesture, gizmoNumericValue } = await import(`./.test-assemblyGizmoGesture.mjs?${Date.now()}`);
  for (const text of ["", " ", "NaN", "Infinity", "12mm", "1e999", "1.2.3", "0x10"]) assert.equal(gizmoNumericValue(text), null, text);
  for (const [text, expected] of [["12", 12], ["-12.5", -12.5], ["+.25", .25], ["-1e2", -100], [" 0 ", 0]]) assert.equal(gizmoNumericValue(text), expected);
  const parent = new THREE.Group();
  parent.scale.set(2, -2, 2); // Representative reflected/scaled viewport display frame.
  const object = new THREE.Object3D(); parent.add(object);
  object.position.set(10, 20, 30);
  object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  object.scale.set(1, 1, 1);
  const move = new AssemblyGizmoGesture(object, "translate", "X");
  assert.equal(move.preview(12), true);
  vectorNear(object.position, [10, 32, 30], "12 means local physical mm regardless of viewport scale");
  near(move.value(), 12, "positive local axis delta");
  move.preview(-3.5);
  vectorNear(object.position, [10, 16.5, 30], "numeric edits replace the original gesture delta");
  near(move.value(), -3.5, "signed negative translation");
  assert.equal(move.finish("cancel"), true);
  vectorNear(object.position, [10, 20, 30], "Escape restores starting position");
  assert.equal(move.preview(100), false, "finished gestures cannot be changed by later pointer moves");
  assert.equal(move.finish("commit"), false, "finished transaction is not committed twice");
  const rotate = new AssemblyGizmoGesture(object, "rotate", "X");
  rotate.preview(90);
  vectorNear(new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion), [0, 0, 1], "rotation composes about the selected local axis");
  near(rotate.value(), 90, "rotation input uses degrees");
  rotate.preview(-12);
  near(rotate.value(), -12, "negative rotation is signed");
  vectorNear(object.position, [10, 20, 30], "rotation preserves the gizmo pivot");
  rotate.finish("commit");
  near(rotate.value(), -12, "Enter retains the preview");
  vectorNear(object.scale, [1, 1, 1], "gestures preserve scale");
  const baseline = object.quaternion.clone();
  const cancelRotate = new AssemblyGizmoGesture(object, "rotate", "Z");
  cancelRotate.preview(12); cancelRotate.finish("cancel");
  near(object.quaternion.angleTo(baseline), 0, "cancel restores quaternion exactly");

  // Exercise actual controller event ordering with a small DOM boundary double.
  class Element extends EventTarget {
    constructor(tagName = "DIV") { super(); this.tagName = tagName; this.children = []; this.style = {}; this.attributes = {}; this.offsetWidth = 180; this.offsetHeight = 58; this.value = ""; }
    append(...elements) { this.children.push(...elements); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    select() {}
    remove() {}
    getBoundingClientRect() { return { width: 320, height: 220 }; }
  }
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: null, createElement: name => new Element(name.toUpperCase()) };
  globalThis.window = new EventTarget();
  const { installAssemblyGizmoNumericInput } = await import(`./.test-assemblyGizmoNumericInput.mjs?${Date.now()}`);
  const gizmo = new EventTarget();
  Object.assign(gizmo, { axis: "X", mode: "translate", object, dragging: false, camera: new THREE.PerspectiveCamera(), domElement: new Element("CANVAS") });
  gizmo.camera.position.set(0, 0, 100); gizmo.camera.updateMatrixWorld(true);
  gizmo.pointerUp = () => { gizmo.dragging = false; gizmo.axis = null; gizmo.dispatchEvent(new Event("mouseUp")); };
  const host = new Element();
  const published = [], orbit = [];
  const controller = installAssemblyGizmoNumericInput(gizmo, host, kind => published.push(kind), enabled => orbit.push(enabled));
  const overlay = host.children[0], input = overlay.children[0].children[0];
  const begin = (mode = "translate", axis = "X") => {
    gizmo.mode = mode; gizmo.axis = axis; gizmo.dragging = true;
    gizmo.dispatchEvent(new Event("mouseDown"));
  };
  const type = text => { input.value = text; input.dispatchEvent(new Event("input")); };
  const key = name => { const event = new Event("keydown", { cancelable: true }); event.key = name; window.dispatchEvent(event); };
  begin(); gizmo.pointerUp();
  assert.equal(overlay.hidden, false, "axis click opens numeric entry");
  assert.deepEqual(published, [], "initial axis click does not persist a transform");
  assert.equal(document.activeElement, input, "clicked axis moves keyboard focus to entry");
  assert.equal(controller.consumePointer(), true, "axis click is consumed before board selection");
  type("12"); assert.deepEqual(published, ["preview"], "numeric input previews live");
  type("-"); key("Enter");
  assert.equal(input.attributes["aria-invalid"], "true", "incomplete number stays recoverable");
  assert.equal(overlay.hidden, false, "invalid Enter keeps transaction open");
  type("12"); key("Enter");
  assert.equal(published.at(-1), "commit");
  assert.equal(published.filter(kind => kind === "commit").length, 1, "Enter commits exactly once");
  assert.equal(overlay.hidden, true);
  const savedPosition = object.position.clone(), savedQuaternion = object.quaternion.clone();
  begin("rotate", "Z"); type("-12"); key("Escape");
  vectorNear(object.position, savedPosition.toArray(), "Escape restores position while dragging");
  near(object.quaternion.angleTo(savedQuaternion), 0, "Escape restores rotation while dragging");
  assert.equal(gizmo.dragging, false, "Escape releases transform pointer ownership");
  assert.equal(published.filter(kind => kind === "commit").length, 1, "cancel publishes only restored preview");
  assert.equal(orbit.at(-1), true, "camera recovers after cancel");
  begin(); object.position.y += 2; gizmo.dispatchEvent(new Event("objectChange"));
  assert.notEqual(input.value, "0", "drag delta appears live");
  gizmo.pointerUp();
  assert.equal(published.filter(kind => kind === "commit").length, 2, "plain drag retains release-to-commit behavior");
  assert.equal(overlay.hidden, true);
  assert.equal(controller.consumePointer(), true);
  controller.dispose();
  console.log("assembly gizmo numeric: all assertions passed");
} finally {
  for (const name of generated) { try { unlinkSync(new URL(`./.test-${name}.mjs`, import.meta.url)); } catch {} }
}
