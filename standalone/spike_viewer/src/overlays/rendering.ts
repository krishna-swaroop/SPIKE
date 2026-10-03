// SPDX-License-Identifier: Apache-2.0
import type {
  OverlayTransform3D,
  VirtualFrame,
  VirtualLayer,
  VirtualPick,
  VirtualPrimitive,
} from "./types";

const DEFAULT_COLOURS: Record<VirtualPrimitive["kind"], string> = {
  points: "#38bdf8",
  vectors: "#f59e0b",
  surface: "#22c55e",
  path: "#a78bfa",
  labels: "#f8fafc",
};

export function activeVirtualFrame(layer: VirtualLayer, frameIndex: number): VirtualFrame | null {
  if (layer.frames.length === 1) return layer.frames[0];
  return Number.isInteger(frameIndex) && frameIndex >= 0 && frameIndex < layer.frames.length
    ? layer.frames[frameIndex]
    : null;
}

/** A derived range is shared by every frame so animation never re-scales colour. */
export function virtualLayerRange(layer: VirtualLayer): readonly [number, number] {
  if (layer.range) return layer.range;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const frame of layer.frames) for (const primitive of frame.primitives) {
    if (!("values" in primitive) || !primitive.values) continue;
    for (const value of primitive.values) if (value !== null && Number.isFinite(value)) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return Number.isFinite(minimum) ? [minimum, maximum] : [0, 1];
}

export function virtualOpacity(layer: VirtualLayer): number {
  return Math.max(0, Math.min(1, layer.opacity));
}

export function virtualSampleValue(primitive: VirtualPrimitive, sampleIndex: number): number | undefined {
  if (!("values" in primitive) || !primitive.values) return undefined;
  const value = primitive.values[sampleIndex];
  return value === null || value === undefined ? undefined : value;
}

export function virtualSampleColour(
  primitive: VirtualPrimitive,
  sampleIndex: number,
  range: readonly [number, number],
): string {
  const value = virtualSampleValue(primitive, sampleIndex);
  if (value === undefined) return primitive.color ?? DEFAULT_COLOURS[primitive.kind];
  const ratio = range[1] > range[0]
    ? Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])))
    : 0.5;
  return `hsl(${Math.round((1 - ratio) * 240)}, 82%, 55%)`;
}

export function virtualPickForSample(
  layer: VirtualLayer,
  frame: VirtualFrame,
  primitive: VirtualPrimitive,
  sampleIndex: number,
): VirtualPick {
  const value = virtualSampleValue(primitive, sampleIndex);
  const vector = primitive.kind === "vectors" ? primitive.vectors[sampleIndex] : undefined;
  const label = primitive.kind === "labels" ? primitive.labels[sampleIndex] : undefined;
  return {
    layerId: layer.id,
    frameId: frame.id,
    primitiveId: primitive.id,
    sampleIndex,
    positionMm: [...primitive.positionsMm[sampleIndex]],
    ...(value === undefined ? {} : { value }),
    ...(vector === undefined ? {} : { vector: [...vector] }),
    ...(label === undefined ? {} : { label }),
    quantity: layer.quantity,
    unit: layer.unit,
    provenance: { ...layer.provenance },
  };
}

export function virtualScenePoint(
  pointMm: readonly [number, number, number],
  transform: OverlayTransform3D,
): [number, number, number] {
  return [
    (pointMm[0] - transform.centerX) * transform.scale,
    (transform.centerY - pointMm[1]) * transform.scale,
    pointMm[2] * transform.scale,
  ];
}
