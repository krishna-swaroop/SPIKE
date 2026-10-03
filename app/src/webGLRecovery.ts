// SPDX-License-Identifier: Apache-2.0
/** Keep context loss recoverable, and remove handlers when a viewport closes. */
export function installWebGLRecovery(canvas: EventTarget, callbacks: { lost: () => void; restored: () => void }) {
  let lost = false;
  const onLost = (event: Event) => { event.preventDefault(); if (!lost) { lost = true; callbacks.lost(); } };
  const onRestored = () => { if (lost) { lost = false; callbacks.restored(); } };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return { get lost() { return lost; }, dispose() { canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored); } };
}
