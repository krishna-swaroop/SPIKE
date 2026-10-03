// SPDX-License-Identifier: Apache-2.0
import * as THREE from "three";

export type GizmoAxis = "X" | "Y" | "Z";
export type GizmoMode = "translate" | "rotate";

export function gizmoNumericValue(text: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A gesture delta is in board/part-local mm or degrees, never display units. */
export class AssemblyGizmoGesture {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
  readonly direction: THREE.Vector3;
  active = true;

  constructor(readonly object: THREE.Object3D, readonly mode: GizmoMode, readonly axis: GizmoAxis) {
    this.position = object.position.clone();
    this.quaternion = object.quaternion.clone();
    this.scale = object.scale.clone();
    this.direction = new THREE.Vector3(Number(axis === "X"), Number(axis === "Y"), Number(axis === "Z"));
  }

  value(): number {
    if (this.mode === "translate") {
      return this.object.position.clone().sub(this.position)
        .dot(this.direction.clone().applyQuaternion(this.quaternion));
    }
    const delta = this.quaternion.clone().invert().multiply(this.object.quaternion).normalize();
    return THREE.MathUtils.radToDeg(2 * Math.atan2(
      new THREE.Vector3(delta.x, delta.y, delta.z).dot(this.direction), delta.w,
    ));
  }

  preview(value: number): boolean {
    if (!this.active || !Number.isFinite(value)) return false;
    this.restore();
    if (this.mode === "translate") {
      this.object.position.addScaledVector(this.direction.clone().applyQuaternion(this.quaternion), value);
    } else {
      this.object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(this.direction, THREE.MathUtils.degToRad(value)));
    }
    this.object.updateMatrix();
    this.object.updateMatrixWorld(true);
    return true;
  }

  finish(kind: "commit" | "cancel"): boolean {
    if (!this.active) return false;
    if (kind === "cancel") this.restore();
    this.active = false;
    this.object.updateMatrix();
    this.object.updateMatrixWorld(true);
    return true;
  }

  private restore() {
    this.object.position.copy(this.position);
    this.object.quaternion.copy(this.quaternion);
    this.object.scale.copy(this.scale);
  }
}
