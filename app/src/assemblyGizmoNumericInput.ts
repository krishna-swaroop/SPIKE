// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { AssemblyGizmoGesture, gizmoNumericValue } from "./assemblyGizmoGesture";
import "./assemblyGizmoNumericInput.css";

/** Scoped DOM overlay: canvas gestures remain owned by Three's TransformControls. */
export function installAssemblyGizmoNumericInput(
  gizmo: TransformControls,
  host: HTMLElement,
  publish: (kind: "preview" | "commit") => void,
  orbitEnabled: (enabled: boolean) => void,
) {
  const overlay = document.createElement("div");
  overlay.className = "assembly-gizmo-number";
  overlay.hidden = true;
  overlay.setAttribute("role", "group");
  overlay.setAttribute("aria-label", "Assembly axis adjustment");
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  const unit = document.createElement("span");
  const hint = document.createElement("small");
  hint.textContent = "Type delta | Enter apply | Esc cancel";
  label.append(input);
  overlay.append(label, unit, hint);
  host.append(overlay);
  let gesture: AssemblyGizmoGesture | null = null;
  let typed = false;
  let moved = false;
  let finishing = false;
  let axisLabel = "";
  let consumedPointer = false;
  const anchor = new THREE.Vector3();

  const updateAnchor = () => {
    if (!gesture || !gizmo.object || gesture.object !== gizmo.object) return;
    gizmo.object.updateWorldMatrix(true, false);
    gizmo.object.getWorldPosition(anchor).project(gizmo.camera);
    const rect = host.getBoundingClientRect();
    const width = overlay.offsetWidth || 180;
    const height = overlay.offsetHeight || 58;
    const x = (anchor.x + 1) * rect.width / 2 + 24;
    const y = (1 - anchor.y) * rect.height / 2 + 24;
    overlay.style.left = `${Math.max(8, Math.min(x, rect.width - width - 8))}px`;
    overlay.style.top = `${Math.max(8, Math.min(y, rect.height - height - 8))}px`;
  };
  const finish = (kind: "commit" | "cancel") => {
    const current = gesture;
    if (!current) return;
    if (kind === "commit" && typed) {
      const value = gizmoNumericValue(input.value);
      if (value === null) { input.setAttribute("aria-invalid", "true"); input.focus(); return; }
      current.preview(value);
    }
    current.finish(kind);
    gesture = null;
    overlay.hidden = true;
    finishing = true;
    // End pointer ownership as well, so later pointer moves cannot undo Enter/Escape.
    if (gizmo.dragging) gizmo.pointerUp(null);
    finishing = false;
    orbitEnabled(true);
    publish(kind === "commit" ? "commit" : "preview");
    if (document.activeElement === input) input.blur();
  };
  const onMouseDown = () => {
    if (gesture) finish("cancel");
    consumedPointer = true;
    orbitEnabled(false);
    const axis = gizmo.axis;
    const object = gizmo.object;
    if (!object || (axis !== "X" && axis !== "Y" && axis !== "Z") || gizmo.mode === "scale") return;
    gesture = new AssemblyGizmoGesture(object, gizmo.mode, axis);
    typed = false;
    moved = false;
    axisLabel = `${gizmo.mode === "translate" ? "Move" : "Rotate"} ${axis}`;
    input.setAttribute("aria-label", `${axisLabel} delta in ${gizmo.mode === "translate" ? "millimetres" : "degrees"}`);
    input.removeAttribute("aria-invalid");
    input.value = "0";
    unit.textContent = `${axis} ${gizmo.mode === "translate" ? "mm" : "deg"}`;
    hint.textContent = "Type delta | Enter apply | Esc cancel";
    overlay.hidden = false;
    updateAnchor();
  };
  const onObjectChange = () => {
    if (gesture) {
      moved = moved || Math.abs(gesture.value()) > 1e-8;
      if (typed) {
        const value = gizmoNumericValue(input.value);
        if (value !== null) gesture.preview(value);
      } else input.value = Number(gesture.value().toFixed(4)).toString();
      updateAnchor();
    }
    publish("preview");
  };
  const onMouseUp = () => {
    if (finishing) return;
    orbitEnabled(true);
    if (gesture && (!moved || typed)) {
      // A handle click is a numeric transaction; a plain drag keeps release-to-commit.
      input.focus({ preventScroll: true });
      input.select();
      updateAnchor();
      return;
    }
    if (gesture) finish("commit");
    else publish("commit");
  };
  const onInput = () => {
    if (!gesture) return;
    typed = true;
    const value = gizmoNumericValue(input.value);
    input.setAttribute("aria-invalid", String(value === null));
    hint.textContent = value === null ? "Enter a finite signed number" : "Enter apply | Esc cancel";
    if (value !== null) { gesture.preview(value); publish("preview"); updateAnchor(); }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!gesture || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target !== input && event.target instanceof HTMLElement
      && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault(); event.stopImmediatePropagation();
      finish(event.key === "Escape" ? "cancel" : "commit");
    } else if (event.target !== input && /^[\d.+-]$/.test(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      input.focus({ preventScroll: true });
      input.value = event.key;
      onInput();
    } else if (event.target === input) event.stopPropagation();
  };
  const stopPointer = (event: Event) => event.stopPropagation();
  const onPointerStart = (event: PointerEvent) => {
    // Resolve the previous click transaction before Three captures its next drag origin.
    if (event.target === gizmo.domElement && gesture && !gizmo.dragging) finish("cancel");
  };
  const onPointerCancel = () => { if (gesture) finish("cancel"); };
  overlay.addEventListener("pointerdown", stopPointer);
  overlay.addEventListener("wheel", stopPointer);
  input.addEventListener("input", onInput);
  window.addEventListener("keydown", onKeyDown, true);
  host.addEventListener("pointerdown", onPointerStart, true);
  host.addEventListener("pointercancel", onPointerCancel);
  gizmo.addEventListener("mouseDown", onMouseDown);
  gizmo.addEventListener("objectChange", onObjectChange);
  gizmo.addEventListener("mouseUp", onMouseUp);
  return {
    updateAnchor,
    cancel: () => finish("cancel"),
    consumePointer: () => { const consumed = consumedPointer; consumedPointer = false; return consumed; },
    dispose: () => {
      if (gesture) finish("cancel");
      gizmo.removeEventListener("mouseDown", onMouseDown);
      gizmo.removeEventListener("objectChange", onObjectChange);
      gizmo.removeEventListener("mouseUp", onMouseUp);
      window.removeEventListener("keydown", onKeyDown, true);
      host.removeEventListener("pointerdown", onPointerStart, true);
      host.removeEventListener("pointercancel", onPointerCancel);
      overlay.remove();
    },
  };
}
