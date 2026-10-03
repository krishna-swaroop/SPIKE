// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParsedComponent } from "./boardParser";
import { runLocalWorker } from "./workerBridge";
import {
  candidateCanOverride, componentModelPaths, parseModelCandidates, parseModelLibraryResult, resolverComponents, workerError,
  type ModelCandidate, type ResolverBoard,
} from "./modelResolverPanelModel";
import "./modelResolverPanel.css";

export type ModelResolverPanelProps = {
  boards: ResolverBoard[];
  assignedPaths?: Record<string, Record<string, string>>;
  initialBoardId?: string;
  initialComponentRef?: string;
  onApplied: (boardId: string, componentRef: string, path: string, remember: boolean) => Promise<void>;
  onClose: () => void;
};

type LibraryStatus = { count?: number; asset_count?: number; roots?: unknown[]; indexed_at?: string; index_updated_at?: string; stale?: boolean; truncated?: boolean };

function resultOf(response: unknown): unknown {
  return response && typeof response === "object" ? (response as Record<string, unknown>).result : undefined;
}

function rootLabels(status: LibraryStatus | null): string[] {
  return (Array.isArray(status?.roots) ? status.roots : []).flatMap(root => {
    if (typeof root === "string") return [root];
    if (root && typeof root === "object") {
      const row = root as Record<string, unknown>;
      const path = row.path ?? row.root;
      if (typeof path === "string") return [path];
    }
    return [];
  });
}

export default function ModelResolverPanel({ boards, assignedPaths, initialBoardId, initialComponentRef, onApplied, onClose }: ModelResolverPanelProps) {
  const [boardId, setBoardId] = useState(boards.some(board => board.id === initialBoardId) ? initialBoardId! : boards[0]?.id ?? "");
  const boardEntry = boards.find(board => board.id === boardId) ?? boards[0];
  const components = useMemo(() => boardEntry ? resolverComponents(boardEntry.board) : [], [boardEntry]);
  const [componentRef, setComponentRef] = useState(components.some(component => component.ref === initialComponentRef) ? initialComponentRef! : components[0]?.ref ?? "");
  const component = components.find(item => item.ref === componentRef) ?? components[0];
  const [sourcePath, setSourcePath] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ModelCandidate[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [busy, setBusy] = useState<"status" | "resolve" | "search" | "root" | "apply" | null>(null);
  const [message, setMessage] = useState("");
  const searchGeneration = useRef(0);
  const resolveGeneration = useRef(0);
  const workerQueue = useRef<Promise<void>>(Promise.resolve());

  const queuedWorker = (kind: Exclude<typeof busy, null>, request: Record<string, unknown>): Promise<unknown> => {
    return new Promise(resolvePromise => {
      workerQueue.current = workerQueue.current.catch(() => undefined).then(async () => {
        setBusy(kind);
        try {
          resolvePromise(await runLocalWorker(request));
        } catch (error) {
          resolvePromise({ ok: false, error: error instanceof Error ? error.message : "The local worker request failed." });
        } finally {
          setBusy(current => current === kind ? null : current);
        }
      });
    });
  };

  useEffect(() => {
    if (!boards.some(board => board.id === boardId)) setBoardId(boards[0]?.id ?? "");
  }, [boards, boardId]);

  useEffect(() => {
    const next = components.some(item => item.ref === componentRef) ? componentRef : components[0]?.ref ?? "";
    if (next !== componentRef) setComponentRef(next);
  }, [components, componentRef]);

  useEffect(() => {
    const paths = component ? componentModelPaths(component) : [];
    setSourcePath(paths[0] ?? "");
    const footprintName = component?.library?.split(":").pop() ?? "";
    setQuery(footprintName || component?.value || "");
    setCandidates([]);
    setSelectedPath("");
    setMessage("");
    ++resolveGeneration.current;
  }, [boardId, component?.id]);

  const loadStatus = async (refresh = false) => {
    setMessage("");
    const response = await queuedWorker("status", { method: "model_library_status", params: { refresh } });
    const error = workerError(response, "Could not read the model library status.");
    if (error) setMessage(error);
    else {
      const raw = (resultOf(response) ?? {}) as LibraryStatus;
      const parsed = parseModelLibraryResult(raw);
      setStatus({ ...raw, count: parsed.count ?? raw.count, roots: parsed.roots ?? raw.roots, indexed_at: parsed.indexedAt ?? raw.indexed_at });
    }
  };

  useEffect(() => { void loadStatus(false); }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { ++searchGeneration.current; setCandidates([]); setBusy(current => current === "search" ? null : current); return; }
    const generation = ++searchGeneration.current;
    const timer = window.setTimeout(async () => {
      const response = await queuedWorker("search", { method: "model_library", params: { query: trimmed, limit: 100 } });
      if (generation !== searchGeneration.current) return;
      const error = workerError(response, "Model search failed.");
      if (error) setMessage(error);
      else {
        const library = parseModelLibraryResult(resultOf(response));
        setCandidates(library.candidates);
        if (library.count != null || library.roots || library.indexedAt) setStatus(current => ({
          ...current, count: library.count ?? current?.count, roots: library.roots ?? current?.roots,
          indexed_at: library.indexedAt ?? current?.indexed_at,
        }));
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const resolve = async () => {
    if (!component) return;
    const generation = ++resolveGeneration.current;
    setMessage("");
    const response = await queuedWorker("resolve", { method: "resolve_3d_model", params: {
      reference: sourcePath,
      footprint: component.library,
      limit: 100,
    } });
    if (generation !== resolveGeneration.current) return;
    const error = workerError(response, "Automatic model resolution failed.");
    if (error) setMessage(error);
    else {
      const result = (resultOf(response) ?? {}) as Record<string, unknown>;
      const rows = parseModelCandidates(result.candidates);
      const automatic = typeof result.automatic_path === "string" ? result.automatic_path : "";
      setCandidates(rows);
      setSelectedPath(automatic || rows[0]?.path || "");
      setMessage(rows.length || automatic ? "Review the candidate and apply it explicitly." : "No candidate was found. Try a broader library search or add a model root.");
    }
  };

  const addRoot = async () => {
    const path = rootPath.trim(); if (!path) return;
    setMessage("");
    const response = await queuedWorker("root", { method: "model_library_add_root", params: { path } });
    const error = workerError(response, "The model root could not be added.");
    if (error) setMessage(error);
    else { setRootPath(""); setMessage("Model root added. Refresh the index to scan it."); await loadStatus(false); return; }
  };

  const apply = async () => {
    if (!boardEntry || !component || !selectedPath) return;
    setBusy("apply"); setMessage("");
    try {
      await onApplied(boardEntry.id, component.ref, selectedPath, remember);
      setMessage(`Applied ${selectedPath} to ${component.ref}. Verify body placement and pin pitch in the 3D board view.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The model could not be applied.");
    } finally { setBusy(null); }
  };

  const sourcePaths = component ? componentModelPaths(component) : [];
  const roots = rootLabels(status);
  const selectedCandidate = candidates.find(candidate => candidate.path === selectedPath);
  const selectedSupported = Boolean(selectedCandidate && candidateCanOverride(selectedCandidate));
  return <aside className="model-resolver" role="dialog" aria-modal="true" aria-label="Resolve component 3D models" aria-busy={busy !== null}>
    <header className="model-resolver__header"><div><small>3D MODEL LIBRARY</small><h2>Resolve component models</h2></div><button type="button" onClick={onClose} aria-label="Close model resolver">×</button></header>
    <p className="model-resolver__intro">Choose a board design and component, inspect retained source assignments, then explicitly apply a library model. A design-level choice applies to every occurrence of that design. The 3D viewport may show a visual fallback until a native model loads.</p>
    <div className="model-resolver__layout">
      <section className="model-resolver__controls" aria-label="Component selection">
        <label>Board design<select value={boardEntry?.id ?? ""} onChange={event => { ++resolveGeneration.current; setBoardId(event.target.value); }}>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
        <label>Component<select value={component?.ref ?? ""} onChange={event => { ++resolveGeneration.current; setComponentRef(event.target.value); }}>{components.map(item => { const paths = componentModelPaths(item); return <option key={item.id || item.ref} value={item.ref}>{item.ref} · {item.value || item.library || "unnamed"}{paths.length ? "" : " · unassigned"}</option>; })}</select></label>
        <dl className="model-resolver__facts"><div><dt>Footprint</dt><dd title={component?.library}>{component?.library || "Not recorded"}</dd></div><div><dt>Source assignments</dt><dd>{sourcePaths.length}</dd></div><div><dt>Saved replacement</dt><dd title={assignedPaths?.[boardEntry?.id ?? ""]?.[component?.ref ?? ""]}>{assignedPaths?.[boardEntry?.id ?? ""]?.[component?.ref ?? ""] || "None"}</dd></div></dl>
        <label>Source model assignment<select value={sourcePath} onChange={event => { ++resolveGeneration.current; setSourcePath(event.target.value); }}><option value="">No source model assigned</option>{sourcePaths.map(path => <option key={path} value={path}>{path}</option>)}</select></label>
        {sourcePaths.length > 1 && <p className="model-resolver__source-note">This selection guides matching only. Applying an override replaces the component's displayed body; every source URI and its transform remain retained in board data.</p>}
        <button type="button" onClick={resolve} disabled={!component || busy !== null}>Find best matches</button>
      </section>
      <section className="model-resolver__results" aria-label="Model candidates">
        <label>Search model library<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Package, footprint, or filename" /></label>
        <div className="model-resolver__result-heading"><strong>{busy === "search" ? "Searching…" : `${candidates.length} candidates`}</strong><span>{status?.count == null ? "Index count unavailable" : `${status.count} indexed models${status.truncated ? " (partial index)" : ""}${status.stale ? " · refresh recommended" : ""}`}</span></div>
        <div className="model-resolver__candidate-list" role="radiogroup" aria-label="Model candidates">
          {candidates.map(candidate => { const supported = candidateCanOverride(candidate); return <label className={`model-resolver__candidate${supported ? "" : " model-resolver__candidate--unsupported"}`} key={candidate.path} title={candidate.path}><input type="radio" name="model-candidate" value={candidate.path} checked={selectedPath === candidate.path} disabled={!supported} onChange={() => setSelectedPath(candidate.path)} /><span><strong>{candidate.name}</strong><small>{[candidate.format, candidate.exact ? "exact match" : candidate.reason, candidate.confidence == null ? "" : `${Math.round(candidate.confidence * 100)}%`, supported ? "" : "Preview only: component overrides require STEP, STP, WRL, or VRML"].filter(Boolean).join(" · ")}</small><code>{candidate.path}</code></span></label>; })}
          {!candidates.length && busy !== "search" && <p className="model-resolver__empty">No candidates to show. Search the index or ask the resolver to match the selected source assignment.</p>}
        </div>
        <label className="model-resolver__remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />Remember this match as a shared footprint alias</label>
        <button className="model-resolver__apply" type="button" onClick={apply} disabled={!selectedSupported || busy !== null}>Apply selected model</button>
        <p className="model-resolver__verification">After applying, verify body orientation, board side, origin, and pin pitch against the footprint pads. A visible body alone does not verify placement.</p>
      </section>
    </div>
    <details className="model-resolver__library"><summary>Library roots and index</summary><div className="model-resolver__library-actions"><button type="button" onClick={() => void loadStatus(true)} disabled={busy !== null}>Refresh index</button><input aria-label="Custom model library root" value={rootPath} onChange={event => setRootPath(event.target.value)} placeholder="Absolute folder path" /><button type="button" onClick={addRoot} disabled={!rootPath.trim() || busy !== null}>Add root</button></div>{roots.length ? <ul>{roots.map(root => <li key={root} title={root}>{root}</li>)}</ul> : <p>No library roots were reported.</p>}</details>
    {message && <p className="model-resolver__message" role="status">{message}</p>}
  </aside>;
}
