// SPDX-License-Identifier: Apache-2.0
export { BoardViewer, type BoardViewerProps } from "./BoardViewer";
export { default as BoardViewport } from "./engine/BoardViewport";
export { default as LayoutViewport } from "./engine/LayoutViewport";
export type * from "./engine/boardTypes";
export type { BoardViewportProps } from "./engine/BoardViewport";
export type { BoardObject } from "./engine/BoardViewport";
export type * from "./overlays/types";
export { validateVirtualLayers, parseVirtualLayers, VirtualDataError, VIRTUAL_DATA_LIMITS } from "./overlays/validation";
export { buildVirtualOverlayScene, pickVirtualIntersection } from "./overlays/scene3d";
export { Overlay2D } from "./overlays/Overlay2D";
export { layerFromScalarSamples, type ScalarLayerOptions, type SpikeScalarSample } from "./adapters/spike";
export { AssemblyViewer, type AssemblyViewerProps } from "./assembly/AssemblyViewer";
export type { AssemblyDocument, AssemblyAsset, BoardAsset, MechanicalAsset, AssemblyInstance, AssemblyMesh, AssemblyAnchor, AssemblyPick, AssemblyViewCommand, AssemblySection, RigidMatrix } from "./assembly/types";
export { identityTransform, isRigidTransform, transformFromPose, poseFromTransform, assetAnchors, worldAnchor, snapPlacement, replaceInstance } from "./assembly/placement";
export { validateAssemblyDocument, validateAssemblyAsset, ASSEMBLY_LIMITS } from "./assembly/validation";
export { DockWorkspace, type DockWorkspaceProps } from "./workspace/DockWorkspace";
export { createWorkspaceLayout, normalizeWorkspaceLayout } from "./workspace/layoutModel";
export type { WorkspaceLayout, WorkspacePanel, WorkspacePanelDefinition, WorkspacePanelLayout, WorkspaceDockLayout, PanelPlacement, DockEdge, FloatRect } from "./workspace/layoutModel";
