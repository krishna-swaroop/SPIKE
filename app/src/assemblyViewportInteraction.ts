// SPDX-License-Identifier: Apache-2.0
import type { AssemblyViewBox } from "./assemblyLayout2d";

export type AssemblyViewportRect = { left: number; top: number; width: number; height: number };
export type AssemblyViewportPoint = readonly [number, number];

function finitePositive(value: number, fallback = 1): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * SVG's default xMidYMid meet policy uses one uniform scale and may leave
 * letterbox margins. Map through those margins instead of stretching each axis.
 */
export function assemblyClientPoint(
  view: AssemblyViewBox,
  rect: AssemblyViewportRect,
  clientX: number,
  clientY: number,
): AssemblyViewportPoint {
  const width = finitePositive(rect.width);
  const height = finitePositive(rect.height);
  const viewWidth = finitePositive(view.width);
  const viewHeight = finitePositive(view.height);
  const scale = Math.min(width / viewWidth, height / viewHeight);
  const insetX = (width - viewWidth * scale) / 2;
  const insetY = (height - viewHeight * scale) / 2;
  return [
    view.x + (clientX - rect.left - insetX) / scale,
    view.y + (clientY - rect.top - insetY) / scale,
  ];
}

export function zoomAssemblyViewBox(
  view: AssemblyViewBox,
  rect: AssemblyViewportRect,
  clientX: number,
  clientY: number,
  requestedFactor: number,
): AssemblyViewBox {
  const factor = Math.max(0.05, Math.min(20, finitePositive(requestedFactor)));
  const [anchorX, anchorY] = assemblyClientPoint(view, rect, clientX, clientY);
  return {
    x: anchorX - (anchorX - view.x) * factor,
    y: anchorY - (anchorY - view.y) * factor,
    width: view.width * factor,
    height: view.height * factor,
  };
}

export function panAssemblyViewBox(
  view: AssemblyViewBox,
  rect: AssemblyViewportRect,
  deltaClientX: number,
  deltaClientY: number,
): AssemblyViewBox {
  const scale = Math.min(
    finitePositive(rect.width) / finitePositive(view.width),
    finitePositive(rect.height) / finitePositive(view.height),
  );
  return {
    ...view,
    x: view.x - deltaClientX / scale,
    y: view.y - deltaClientY / scale,
  };
}

export function assemblyPanStarted(deltaClientX: number, deltaClientY: number, thresholdPx = 4): boolean {
  return Math.hypot(deltaClientX, deltaClientY) >= thresholdPx;
}

/** Frame selected geometry with a stable margin and the viewport's aspect. */
export function focusAssemblyViewBox(bounds: AssemblyViewBox, viewportAspect: number, marginFraction = 0.12): AssemblyViewBox {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const largest = Math.max(finitePositive(bounds.width), finitePositive(bounds.height), 1);
  let width = Math.max(finitePositive(bounds.width), largest * 0.08) * (1 + marginFraction * 2);
  let height = Math.max(finitePositive(bounds.height), largest * 0.08) * (1 + marginFraction * 2);
  const aspect = finitePositive(viewportAspect, width / height);
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
