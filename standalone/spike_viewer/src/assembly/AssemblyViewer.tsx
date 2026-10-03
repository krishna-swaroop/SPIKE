// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { perspectiveFitDistance } from "./cameraFit";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { VirtualPick } from "../overlays/types";
import {
  assemblyAnchorFromIntersection,
  assemblyIntersectionVisible,
  assemblyPickFromIntersection,
  assemblyVirtualPickFromIntersection,
  buildAssemblyScene,
  disposeAssemblyScene,
  replaceAssemblyAnchors,
  replaceVirtualOverlays,
  threeMatrixToRigid,
  updateAssemblyScene,
  type AssemblyScene,
} from "./scene";
import type {
  AssemblyAnchor,
  AssemblyDocument,
  AssemblyPick,
  AssemblySection,
  AssemblyViewCommand,
} from "./types";
import { isRigidTransform } from "./placement";
import { ASSEMBLY_LIMITS, validateAssemblyDocument } from "./validation";
import "./assembly.css";

const admittedAssetArrays = new WeakSet<object>();

function admitAssemblyDocument(document: AssemblyDocument): AssemblyDocument {
  if (!admittedAssetArrays.has(document.assets)) {
    const admitted = validateAssemblyDocument(document);
    admittedAssetArrays.add(admitted.assets);
    return admitted;
  }
  // Asset arrays are immutable by contract. Placement previews create a new
  // document on every pointer move, so recheck the small mutable boundary
  // without rescanning hundreds of thousands of unchanged mesh coordinates.
  if (document.schema !== "spike-viewer/assembly/v1" || document.units !== "mm"
    || typeof document.name !== "string" || !document.name.trim() || document.name.length > 1000
    || !Array.isArray(document.instances) || document.instances.length > ASSEMBLY_LIMITS.instances) {
    throw new Error("Expected a named spike-viewer/assembly/v1 document with bounded millimetre occurrences.");
  }
  const assets = new Map(document.assets.map(asset => [asset.id, asset]));
  const ids = new Set<string>();
  let renderedVertices = 0;
  for (const instance of document.instances) {
    if (!instance || typeof instance !== "object" || typeof instance.id !== "string" || !instance.id.trim()
      || instance.id.length > 1000 || ids.has(instance.id)) throw new Error("Occurrence IDs must be unique non-empty strings.");
    ids.add(instance.id);
    const asset = assets.get(instance.assetId);
    if (!asset) throw new Error("Occurrence refers to a missing asset.");
    if (typeof instance.name !== "string" || !instance.name.trim() || instance.name.length > 1000)
      throw new Error("Occurrence name must be 1-1000 characters.");
    if (!isRigidTransform(instance.transform)) throw new Error("Occurrence transform must be rigid and right-handed.");
    if (typeof instance.visible !== "boolean" || typeof instance.locked !== "boolean")
      throw new Error("Occurrence visibility and locking must be booleans.");
    if (!Number.isFinite(instance.opacity) || instance.opacity < 0 || instance.opacity > 1)
      throw new Error("Occurrence opacity must be between zero and one.");
    renderedVertices += asset.kind === "mechanical"
      ? asset.meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0)
      : Math.max(100, (asset.board.tracks.length + asset.board.pads.length + asset.board.vias.length
        + asset.board.components.length + asset.board.zones.length + asset.board.drawings.length) * 24);
  }
  if (renderedVertices > ASSEMBLY_LIMITS.renderedVertices) throw new Error("Assembly occurrence geometry budget exceeded.");
  return document;
}

export type AssemblyViewerProps = {
  document: AssemblyDocument;
  mode: "2D" | "3D";
  selectedId?: string;
  onSelect: (id: string | null) => void;
  onPick?: (pick: AssemblyPick) => void;
  pickMode?: "surface" | "vertex";
  onTransform?: (id: string, matrix: number[], commit: boolean) => void;
  tool: "select" | "translate" | "rotate";
  space: "world" | "local";
  translationSnapMm: number;
  rotationSnapDeg: number;
  command?: AssemblyViewCommand;
  section?: AssemblySection;
  showEdges?: boolean;
  showGrid?: boolean;
  showVirtual?: boolean;
  frameIndex?: number;
  isolatedId?: string;
  anchors?: AssemblyAnchor[];
  selectedAnchorId?: string;
  onAnchorPick?: (anchor: AssemblyAnchor) => void;
  onVirtualPick?: (pick: VirtualPick & { instanceId: string }) => void;
};

type Engine = {
  scene: THREE.Scene;
  content: THREE.Group;
  renderer: THREE.WebGLRenderer;
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  controls3d: OrbitControls;
  controls2d: OrbitControls;
  gizmo: TransformControls;
  grid: THREE.GridHelper;
};

function visibleInTree(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) { if (!current.visible) return false; current = current.parent; }
  return true;
}

function boundsFor(scene: AssemblyScene | null, selectedId?: string): THREE.Box3 {
  if (!scene) return new THREE.Box3();
  const target = selectedId ? scene.instances.get(selectedId) : scene.group;
  const bounds = new THREE.Box3();
  if (!target || !visibleInTree(target)) return bounds;
  target.updateWorldMatrix(true, true);
  target.traverse(object => {
    if (!visibleInTree(object) || !(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

function cameraDirection(action: AssemblyViewCommand["action"]): THREE.Vector3 {
  if (action === "top") return new THREE.Vector3(0, 0, 1);
  if (action === "front") return new THREE.Vector3(0, -1, 0);
  if (action === "right") return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(1, -1, 0.72).normalize();
}

function fitCamera(engine: Engine, scene: AssemblyScene | null, mode: "2D" | "3D", selectedId?: string, action: AssemblyViewCommand["action"] = "fit"): void {
  let bounds = boundsFor(scene, action === "fit-selection" ? selectedId : undefined);
  if (bounds.isEmpty() && action === "fit-selection") bounds = boundsFor(scene);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1);
  if (mode === "2D") {
    const camera = engine.orthographic;
    camera.up.set(0, 1, 0);
    camera.position.copy(center).add(new THREE.Vector3(0, 0, radius * 4 + 10));
    engine.controls2d.target.copy(center);
    const width = Math.max(engine.renderer.domElement.clientWidth, 1);
    const height = Math.max(engine.renderer.domElement.clientHeight, 1);
    camera.zoom = Math.max(0.001, Math.min(width / Math.max(size.x * 1.18, 1), height / Math.max(size.y * 1.18, 1)));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    engine.controls2d.update();
    return;
  }
  const camera = engine.perspective;
  const direction = ["top", "front", "right", "iso"].includes(action)
    ? cameraDirection(action) : camera.position.clone().sub(engine.controls3d.target).normalize();
  if (direction.lengthSq() < 0.5) direction.copy(cameraDirection("iso"));
  camera.up.set(0, 0, 1);
  if (Math.abs(direction.z) > 0.999) camera.up.set(0, 1, 0);
  const distance = perspectiveFitDistance(radius, camera.fov, camera.aspect);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, distance - radius * 2.2);
  camera.far = Math.max(camera.near + 100, distance + radius * 4);
  engine.controls3d.target.copy(center);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  engine.controls3d.update();
}

function AssemblyViewerInner(props: AssemblyViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>();
  const assemblyRef = useRef<AssemblyScene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [error, setError] = useState<string | null>(null);
  const [sceneNotices, setSceneNotices] = useState<string[]>([]);
  const topologyKey = useMemo(() => props.document.instances.map(value => `${value.id}:${value.assetId}`).join("|"), [props.document.instances]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch (reason) {
      setError(`WebGL assembly view unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    renderer.domElement.className = "assembly-viewer__canvas";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1118);
    const content = new THREE.Group();
    scene.add(content);
    scene.add(new THREE.HemisphereLight(0xe8f4fa, 0x29343c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(180, -160, 240);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x98abb5, 0.35));
    const perspective = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
    perspective.up.set(0, 0, 1);
    perspective.position.set(180, -180, 140);
    const orthographic = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 100000);
    orthographic.up.set(0, 1, 0);
    orthographic.position.set(0, 0, 1000);
    const controls3d = new OrbitControls(perspective, renderer.domElement);
    controls3d.screenSpacePanning = true;
    controls3d.enableDamping = true;
    controls3d.zoomToCursor = true;
    const controls2d = new OrbitControls(orthographic, renderer.domElement);
    controls2d.enableRotate = false;
    controls2d.screenSpacePanning = true;
    controls2d.enableDamping = true;
    controls2d.zoomToCursor = true;
    controls2d.mouseButtons.LEFT = THREE.MOUSE.PAN;
    const gizmo = new TransformControls(perspective, renderer.domElement);
    scene.add(gizmo.getHelper());
    const grid = new THREE.GridHelper(2000, 200, 0x46616d, 0x263941);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.02;
    scene.add(grid);
    const engine: Engine = { scene, content, renderer, perspective, orthographic, controls3d, controls2d, gizmo, grid };
    engineRef.current = engine;

    const resize = () => {
      const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      perspective.aspect = width / height;
      perspective.updateProjectionMatrix();
      orthographic.left = -width / 2;
      orthographic.right = width / 2;
      orthographic.top = height / 2;
      orthographic.bottom = -height / 2;
      orthographic.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let frame = 0;
    let stopped = false;
    const draw = () => {
      if (stopped) return;
      controls3d.update();
      controls2d.update();
      try {
        renderer.render(scene, propsRef.current.mode === "2D" ? orthographic : perspective);
      } catch (reason) {
        stopped = true;
        setError(`WebGL assembly render failed: ${reason instanceof Error ? reason.message : String(reason)}`);
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();

    let transforming = false;
    let suppressPointerUp = false;
    const publishTransform = (commit: boolean) => {
      const object = gizmo.object;
      if (!object || !propsRef.current.onTransform) return;
      object.updateMatrix();
      propsRef.current.onTransform(String(object.userData.assemblyInstanceId), threeMatrixToRigid(object.matrix), commit);
    };
    const gizmoDown = () => { transforming = true; suppressPointerUp = true; controls3d.enabled = false; controls2d.enabled = false; };
    const gizmoChange = () => publishTransform(false);
    const gizmoUp = () => { publishTransform(true); transforming = false; controls3d.enabled = propsRef.current.mode === "3D"; controls2d.enabled = propsRef.current.mode === "2D"; };
    gizmo.addEventListener("mouseDown", gizmoDown);
    gizmo.addEventListener("objectChange", gizmoChange);
    gizmo.addEventListener("mouseUp", gizmoUp);

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const pointerDown = (event: PointerEvent) => { down = event.button === 0 ? [event.clientX, event.clientY] : null; };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || transforming || suppressPointerUp || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) {
        suppressPointerUp = false;
        down = null;
        return;
      }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, propsRef.current.mode === "2D" ? orthographic : perspective);
      const assembly = assemblyRef.current;
      const hits = raycaster.intersectObject(content, true)
        .filter(hit => visibleInTree(hit.object) && assemblyIntersectionVisible(hit));
      const retainSelection = event.ctrlKey || event.metaKey;
      for (const hit of hits) {
        const anchor = assemblyAnchorFromIntersection(hit);
        if (anchor) {
          if (!retainSelection) propsRef.current.onSelect(anchor.instanceId);
          propsRef.current.onAnchorPick?.(anchor);
          return;
        }
        const virtual = assemblyVirtualPickFromIntersection(hit);
        if (virtual) {
          if (!retainSelection) propsRef.current.onSelect(virtual.instanceId);
          propsRef.current.onVirtualPick?.(virtual);
          return;
        }
        if (!assembly) continue;
        const pick = assemblyPickFromIntersection(hit, assembly, propsRef.current.pickMode ?? "surface");
        if (pick) {
          if (!retainSelection) propsRef.current.onSelect(pick.instanceId);
          propsRef.current.onPick?.(pick);
          return;
        }
      }
      if (!retainSelection) propsRef.current.onSelect(null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const contextLost = (event: Event) => { event.preventDefault(); setError("WebGL context lost. Reload the assembly view to recover."); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      gizmo.removeEventListener("mouseDown", gizmoDown);
      gizmo.removeEventListener("objectChange", gizmoChange);
      gizmo.removeEventListener("mouseUp", gizmoUp);
      gizmo.detach();
      gizmo.dispose();
      controls3d.dispose();
      controls2d.dispose();
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      engineRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (assemblyRef.current) { engine.content.remove(assemblyRef.current.group); disposeAssemblyScene(assemblyRef.current); }
    const assembly = buildAssemblyScene(props.document);
    assemblyRef.current = assembly;
    setSceneNotices(assembly.diagnostics.map(value => value.message));
    engine.content.add(assembly.group);
    updateAssemblyScene(assembly, props.document, {
      selectedId: props.selectedId, isolatedId: props.isolatedId,
      showEdges: props.showEdges, section: props.section,
    });
    fitCamera(engine, assembly, props.mode, props.selectedId);
    return () => {
      if (assemblyRef.current === assembly) assemblyRef.current = null;
      engine.content.remove(assembly.group);
      disposeAssemblyScene(assembly);
    };
  }, [props.document.assets, topologyKey]);

  useEffect(() => {
    const assembly = assemblyRef.current;
    if (!assembly) return;
    updateAssemblyScene(assembly, props.document, {
      selectedId: props.selectedId,
      isolatedId: props.isolatedId,
      showEdges: props.showEdges,
      section: props.section,
    });
  }, [props.document.instances, props.selectedId, props.isolatedId, props.showEdges, props.section]);

  useEffect(() => {
    const assembly = assemblyRef.current;
    if (assembly) {
      replaceVirtualOverlays(assembly, props.document, props.frameIndex ?? 0, props.showVirtual !== false);
      updateAssemblyScene(assembly, props.document, {
        selectedId: props.selectedId, isolatedId: props.isolatedId,
        showEdges: props.showEdges, section: props.section,
      });
    }
  }, [props.document.assets, topologyKey, props.frameIndex, props.showVirtual]);

  useEffect(() => {
    const assembly = assemblyRef.current;
    if (assembly) {
      replaceAssemblyAnchors(assembly, props.anchors ?? [], props.selectedAnchorId);
      updateAssemblyScene(assembly, props.document, {
        selectedId: props.selectedId, isolatedId: props.isolatedId,
        showEdges: props.showEdges, section: props.section,
      });
    }
  }, [props.anchors, props.selectedAnchorId, topologyKey]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const is2d = props.mode === "2D";
    engine.controls2d.enabled = is2d;
    engine.controls3d.enabled = !is2d;
    (engine.gizmo as TransformControls & { camera: THREE.Camera }).camera = is2d ? engine.orthographic : engine.perspective;
    if (is2d) {
      engine.orthographic.position.set(engine.controls2d.target.x, engine.controls2d.target.y, 1000);
      engine.orthographic.up.set(0, 1, 0);
      engine.orthographic.lookAt(engine.controls2d.target);
    }
    fitCamera(engine, assemblyRef.current, props.mode, props.selectedId);
  }, [props.mode]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.grid.visible = props.showGrid !== false;
  }, [props.showGrid]);

  useEffect(() => {
    const engine = engineRef.current;
    const assembly = assemblyRef.current;
    if (!engine || !assembly) return;
    const instance = props.document.instances.find(value => value.id === props.selectedId);
    const target = props.selectedId ? assembly.instances.get(props.selectedId) : undefined;
    if (!target || props.tool === "select" || instance?.locked || !target.visible) { engine.gizmo.detach(); return; }
    if (engine.gizmo.object !== target) {
      target.matrix.decompose(target.position, target.quaternion, target.scale);
      target.matrixAutoUpdate = true;
      engine.gizmo.attach(target);
    }
    engine.gizmo.setMode(props.tool);
    engine.gizmo.setSpace(props.space);
    engine.gizmo.showX = props.mode === "3D" || props.tool === "translate";
    engine.gizmo.showY = props.mode === "3D" || props.tool === "translate";
    engine.gizmo.showZ = props.mode === "3D" || props.tool === "rotate";
    engine.gizmo.setTranslationSnap(props.translationSnapMm > 0 ? props.translationSnapMm : null);
    engine.gizmo.setRotationSnap(props.rotationSnapDeg > 0 ? THREE.MathUtils.degToRad(props.rotationSnapDeg) : null);
  }, [props.selectedId, props.tool, props.space, props.translationSnapMm, props.rotationSnapDeg, props.document.instances, props.mode, props.isolatedId, topologyKey]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !props.command) return;
    fitCamera(engine, assemblyRef.current, props.mode, props.selectedId, props.command.action);
  }, [props.command?.id]);

  const proceduralBoards = props.document.assets.some(asset => asset.kind === "board");
  const notices = [
    ...(proceduralBoards ? ["Procedural board geometry shown; external model URLs are not loaded by this viewer."] : []),
    ...sceneNotices,
  ];
  return <div ref={hostRef} className={`assembly-viewer assembly-viewer--${props.mode.toLowerCase()}`}>
    {error && <div className="assembly-viewer__error" role="alert">{error}</div>}
    {notices.length > 0 && <div className="assembly-viewer__notice" role="status">
      {notices.slice(0, 3).map(message => <div key={message}>{message}</div>)}
      {notices.length > 3 && <div>{notices.length - 3} more assembly display notices.</div>}
    </div>}
  </div>;
}

/** Public admission boundary. Invalid documents never reach WebGL scene construction. */
export function AssemblyViewer(props: AssemblyViewerProps) {
  const admission = useMemo(() => {
    try { return { document: admitAssemblyDocument(props.document), error: null }; }
    catch (reason) { return { document: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [props.document]);
  if (!admission.document) return <div className="assembly-viewer assembly-viewer__admission-error" role="alert">
    Cannot open assembly: {admission.error}
  </div>;
  return <AssemblyViewerInner {...props} document={admission.document} />;
}
