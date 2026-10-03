// SPDX-License-Identifier: Apache-2.0
import type { BoardBinding, DataStatus, Vec3, VirtualLayer } from "../overlays/types";
import { validateVirtualLayers } from "../overlays/validation";

/** Structural input compatible with SPIKE ScalarSample; it does not import SPIKE services. */
export type SpikeScalarSample = { x_mm: number; y_mm: number; z_mm?: number; value: number };
export type ScalarLayerOptions = {
  id: string; label: string; binding: BoardBinding; quantity: string; unit: string;
  source: string; status: DataStatus;
  /** Explicit physical plane when source samples omit z_mm. No guessed layer depth. */
  defaultZMm?: number;
};
export function layerFromScalarSamples(samples: readonly SpikeScalarSample[], options: ScalarLayerOptions): VirtualLayer {
  const positionsMm: Vec3[] = samples.map(sample => {
    const z = sample.z_mm ?? options.defaultZMm;
    if (z === undefined) throw new Error("Samples without z_mm require an explicit defaultZMm display plane");
    return [sample.x_mm, sample.y_mm, z];
  });
  const layer: VirtualLayer = {
    schema: "spike-viewer/virtual-layer/v1", id: options.id, label: options.label,
    binding: { ...options.binding }, quantity: options.quantity, unit: options.unit,
    provenance: { source: options.source, status: options.status }, visible: true, opacity: .85,
    frames: [{ id: "static", label: "Imported samples", primitives: [{ id: "samples", kind: "points", positionsMm, values: samples.map(sample => sample.value), radiusMm: .6 }] }],
  };
  validateVirtualLayers([layer], options.binding);
  return layer;
}
