// SPDX-License-Identifier: Apache-2.0
/** Distance containing a bounding sphere in both axes of a perspective frustum. */
export function perspectiveFitDistance(radius:number, verticalFovDegrees:number, aspect:number):number {
  const verticalHalfAngle=verticalFovDegrees*Math.PI/360;
  const horizontalHalfAngle=Math.atan(Math.tan(verticalHalfAngle)*Math.max(aspect,1e-6));
  // The limiting ray is tangent to the sphere: sin(half-angle) = radius / distance.
  return radius/Math.sin(Math.min(verticalHalfAngle,horizontalHalfAngle))*1.18;
}
