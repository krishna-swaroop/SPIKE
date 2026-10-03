// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "../engine/boardTypes";
import type { BoardBinding, VirtualLayer } from "../overlays/types";

export type Vec3 = [number, number, number];
/** Row-major, rigid, right-handed local-to-assembly transform. All lengths are mm. */
export type RigidMatrix = number[];
export type AssemblyMesh = {
  id: string; name: string; positions: number[]; indices: number[];
  normals?: number[]; color?: [number, number, number];
  faces?: { first: number; last: number; color?: [number, number, number] }[];
};
export type BoardAsset = {
  id: string; kind: "board"; name: string; board: ParsedBoard;
  binding: BoardBinding; layers?: VirtualLayer[];
  source?: { fileName: string; format: string; notes?: string[] };
};
export type MechanicalAsset = {
  id: string; kind: "mechanical"; name: string; meshes: AssemblyMesh[];
  source: { fileName: string; format: string; unit: string; notes?: string[] };
};
export type AssemblyAsset = BoardAsset | MechanicalAsset;
export type AssemblyInstance = {
  id: string; assetId: string; name: string; transform: RigidMatrix;
  visible: boolean; locked: boolean; opacity: number;
};
export type AssemblyDocument = {
  schema: "spike-viewer/assembly/v1"; name: string; units: "mm";
  assets: AssemblyAsset[]; instances: AssemblyInstance[];
};
export type AssemblyAnchor = {
  id: string; instanceId: string; label: string;
  kind: "origin" | "hole" | "edge" | "vertex" | "face";
  /** Coordinates in the instance's right-handed local frame, NOT source board Y-down. */
  point: Vec3; normal?: Vec3;
};
export type AssemblyPick = {
  instanceId: string; localPoint: Vec3; worldPoint: Vec3;
  kind?: "surface" | "vertex";
  localNormal?: Vec3; meshId?: string; triangleIndex?: number;
};
export type AssemblyViewCommand = { id: number; action: "fit" | "top" | "front" | "right" | "iso" | "fit-selection" };
export type AssemblySection = { enabled: boolean; axis: "x" | "y" | "z"; offsetMm: number; flipped?: boolean };
