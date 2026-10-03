// SPDX-License-Identifier: Apache-2.0
/** Source board coordinates in millimetres. Z is physical height, not a value axis. */
export type Vec3 = [number, number, number];
export type BoardBinding = { boardId: string; revision: string };
export type DataStatus = "synthetic" | "measured" | "simulated" | "approximate" | "unvalidated" | "validated";
type PrimitiveBase = { id: string; color?: string };
export type PointPrimitive = PrimitiveBase & {
  kind: "points"; positionsMm: Vec3[]; values?: (number | null)[]; radiusMm?: number;
};
export type VectorPrimitive = PrimitiveBase & {
  kind: "vectors"; positionsMm: Vec3[]; vectors: Vec3[];
  /** Explicit display millimetres per vector unit; never changes the returned data. */
  displayScaleMm: number; values?: (number | null)[];
};
export type SurfacePrimitive = PrimitiveBase & {
  kind: "surface"; positionsMm: Vec3[]; triangles: [number, number, number][];
  /** One scalar per vertex; null masks connected faces. No new solver samples. */
  values?: (number | null)[];
};
export type PathPrimitive = PrimitiveBase & {
  kind: "path"; positionsMm: Vec3[]; closed?: boolean; widthMm?: number;
};
export type LabelPrimitive = PrimitiveBase & {
  kind: "labels"; positionsMm: Vec3[]; labels: string[];
};
export type VirtualPrimitive = PointPrimitive | VectorPrimitive | SurfacePrimitive | PathPrimitive | LabelPrimitive;
export type VirtualFrame = {
  id: string; label: string; timeSeconds?: number; frequencyHz?: number;
  primitives: VirtualPrimitive[];
};
export type VirtualLayer = {
  schema: "spike-viewer/virtual-layer/v1";
  id: string; label: string; binding: BoardBinding;
  quantity: string; unit: string;
  provenance: { source: string; status: DataStatus; notes?: string };
  visible: boolean; opacity: number;
  /** Optional fixed legend scale across frames, in the declared scalar unit. */
  range?: [number, number];
  frames: VirtualFrame[];
};
export type VirtualPick = {
  layerId: string; frameId: string; primitiveId: string; sampleIndex: number;
  positionMm: Vec3; value?: number; vector?: Vec3; label?: string;
  quantity: string; unit: string; provenance: VirtualLayer["provenance"];
};
export type VirtualOverlayProps = {
  virtualLayers?: readonly VirtualLayer[];
  virtualFrameIndex?: number;
  onVirtualPick?: (pick: VirtualPick) => void;
};
export type OverlayTransform3D = { centerX: number; centerY: number; scale: number };
