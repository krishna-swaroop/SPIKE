// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { Boxes, Cable, CircuitBoard, Layers3, Network, RefreshCw, Save, Search, X } from "./icons";
import AssemblyStructureEditor from "./AssemblyStructureEditor";
import { boardOccurrences } from "./assemblyBoardManagerModel";
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";
import type { ParsedBoard } from "./boardParser";
import "./assemblyWorkspace.css";

const EMPTY: AssemblyIr = { contract: "spike/assembly-ir/v1", assembly_id: "assembly", name: "Assembly", boards: [], parts: [] };
const itemCount = (value: unknown) => Array.isArray(value) ? value.length : 0;
type Props = { assembly: AssemblyIr | null; designs: AssemblyDesigns | null; visuals: Record<string, ParsedBoard>; diagnostics: Record<string, string>;
  projectPath: string | null; manifestDigest: string | null; projectDirty: boolean; desktop: boolean; boardAvailable: boolean;
  onSave: () => Promise<boolean>; onUpdated: () => Promise<void>; onStatus: (message: string) => void; onClose: () => void;
  selectedBoardId?: string | null; onSelectBoard: (boardId: string) => void;
  onViewBoard: (boardId: string, mode: "2D" | "3D") => void; onManager: (boardId: string, kind: "layers" | "nets" | "links") => void;
  onOpenCollaboration: (mode: "freecad" | "attachments") => void;
  embedded?: boolean; closeRequested?: number; onDirtyChange?: (dirty: boolean) => void };

export default function AssemblyWorkspace(props: Props) {
  const [section, setSection] = useState<"boards" | "placement" | "links" | "analysis" | undefined>(undefined);
  const [boardQuery, setBoardQuery] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const [error, setError] = useState("");
  const closeRequest = useRef(props.closeRequested);
  const boards = props.assembly && props.designs ? boardOccurrences(props.assembly, props.designs) : [];
  const boardNameCounts = new Map<string, number>();
  for (const board of boards) boardNameCounts.set(board.name.toLocaleLowerCase(), (boardNameCounts.get(board.name.toLocaleLowerCase()) ?? 0) + 1);
  const boardNameSeen = new Map<string, number>();
  const namedBoards = boards.map(board => {
    const key = board.name.toLocaleLowerCase(), ordinal = (boardNameSeen.get(key) ?? 0) + 1;
    boardNameSeen.set(key, ordinal);
    return { ...board, label: (boardNameCounts.get(key) ?? 0) > 1 ? `${board.name} (${ordinal})` : board.name };
  });
  const filteredBoards = namedBoards.filter(board => board.label.toLocaleLowerCase().includes(boardQuery.trim().toLocaleLowerCase()));
  const selectedBoard = namedBoards.find(board => board.id === props.selectedBoardId) ?? null;
  const ready = props.desktop && Boolean(props.projectPath && props.manifestDigest) && !props.projectDirty;
  const hydrated = useRef("");
  useEffect(() => {
    if (!ready || props.designs) return;
    const key = `${props.projectPath}:${props.manifestDigest}`;
    if (hydrated.current === key) return;
    hydrated.current = key; setBusy(true);
    void props.onUpdated().catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
  }, [ready, props.designs, props.projectPath, props.manifestDigest]);
  useEffect(() => {
    if (props.closeRequested === undefined || props.closeRequested === closeRequest.current) return;
    closeRequest.current = props.closeRequested;
    if (draftDirty) setCloseWarning(true);
    else props.onClose();
  }, [draftDirty, props.closeRequested, props.onClose]);
  const navigate = (action: () => void) => { if (draftDirty) { setError("Save boards and links before leaving this editor. Your draft is still open."); return; } action(); };
  const save = async () => {
    setBusy(true); setError("");
    try { await props.onSave(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    if (draftDirty) { setError("Save boards and links before reloading the project package. Your draft is still open."); return; }
    setBusy(true); setError("");
    try { await props.onUpdated(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const handleDirtyChange = (dirty: boolean) => { setDraftDirty(dirty); props.onDirtyChange?.(dirty); };
  return <div className={props.embedded ? "assembly-workspace-host assembly-workspace-host--embedded" : "modal-shade assembly-workspace-shade"}><section className="assembly-workspace" role={props.embedded ? "region" : "dialog"} aria-modal={props.embedded ? undefined : true} aria-label="Multi-board workspace">
    <header><div><small>ECAD–MCAD ASSEMBLY</small><h2>Collaboration workspace</h2><p>Organize retained boards, coordinate mechanical placement, define physical links and prepare bounded coupled studies.</p>{props.embedded && <p className="assembly-workspace-window-hint">Move or minimize this window to compare changes in the main viewport.</p>}</div><button type="button" className="spike-control--icon" aria-label="Close multi-board workspace" onClick={() => draftDirty ? setCloseWarning(true) : props.onClose()}><X size={18}/></button></header>
    {closeWarning && <div className="assembly-workspace-warning" role="alert">Unsaved board/link edits are still in this editor.<button type="button" onClick={() => setCloseWarning(false)}>Keep editing</button><button type="button" onClick={props.onClose}>Discard draft and close</button></div>}
    <div className="assembly-workspace-summary"><b>{boards.length} board occurrences</b><span>{props.designs?.designs.length ?? 0} retained designs</span><span>{props.assembly?.parts.length ?? 0} mechanical parts</span><span>{props.assembly?.harnesses?.length ?? 0} harnesses</span><span>{props.assembly?.connector_mappings?.filter(item => item.kind === "connector-mate").length ?? 0} connector mates</span></div>
    <div className="assembly-workspace-commandbar" role="toolbar" aria-label="Assembly workspace commands">
      <div className="assembly-command-group" aria-label="Project package"><button type="button" disabled={!ready || busy || draftDirty} onClick={() => void save()}><Save size={14}/> Save project</button><button type="button" disabled={!ready || busy} onClick={() => void reload()}><RefreshCw size={14}/> Reload package</button></div>
      <div className="assembly-command-group assembly-command-board" aria-label="Selected board commands"><label><span>Active board</span><select aria-label="Selected board occurrence" value={selectedBoard?.id ?? ""} onChange={event => event.target.value && props.onSelectBoard(event.target.value)}><option value="">Select a board</option>{namedBoards.map(board => <option key={board.id} value={board.id}>{board.label}</option>)}</select></label><button type="button" disabled={!selectedBoard} onClick={() => selectedBoard && props.onViewBoard(selectedBoard.id, "2D")}>2D</button><button type="button" disabled={!selectedBoard} onClick={() => selectedBoard && props.onViewBoard(selectedBoard.id, "3D")}>3D</button><button type="button" disabled={!selectedBoard} onClick={() => selectedBoard && navigate(() => props.onManager(selectedBoard.id, "layers"))}><Layers3 size={14}/> Layers</button><button type="button" disabled={!selectedBoard} onClick={() => selectedBoard && navigate(() => props.onManager(selectedBoard.id, "nets"))}><Network size={14}/> Nets</button><button type="button" disabled={!selectedBoard} onClick={() => selectedBoard && navigate(() => props.onManager(selectedBoard.id, "links"))}><Cable size={14}/> Links</button></div>
      <div className="assembly-command-group" aria-label="Mechanical collaboration"><button type="button" disabled={!ready || draftDirty} onClick={() => props.onOpenCollaboration("freecad")}><Boxes size={14}/> FreeCAD collaboration</button><button type="button" disabled={!ready || draftDirty} onClick={() => props.onOpenCollaboration("attachments")}><Boxes size={14}/> MCAD attachments</button></div>
    </div>
    <nav aria-label="Assembly workflow"><button className={!section || section === "boards" ? "selected" : ""} aria-pressed={!section || section === "boards"} onClick={() => setSection("boards")}><CircuitBoard size={15}/> 1. Boards & organization</button><button className={section === "placement" ? "selected" : ""} aria-pressed={section === "placement"} onClick={() => setSection("placement")}><Boxes size={15}/> 2. Placement & mechanics</button><button className={section === "links" ? "selected" : ""} aria-pressed={section === "links"} onClick={() => setSection("links")}><Cable size={15}/> 3. Connector links & harnesses</button><button className={section === "analysis" ? "selected" : ""} aria-pressed={section === "analysis"} onClick={() => setSection("analysis")}><Network size={15}/> 4. Coupled studies</button></nav>
    {error && <p role="alert" className="assembly-workspace-warning">{error}</p>}
    <div className="assembly-workspace-content">
      {!ready ? <section className="assembly-workspace-start"><h3>{props.desktop ? "Save the current board to start an assembly" : "Open SPIKE desktop for native assembly import"}</h3><p>{props.projectDirty ? "Save your current project changes before editing its retained assembly records." : "The .spike project retains each source design, board occurrence, connector mapping and setup."}</p><button type="button" disabled={busy || !props.desktop || !props.boardAvailable} onClick={() => void save()}><Save size={15}/>{busy ? "Saving project…" : "Save project and continue"}</button>{!props.boardAvailable && <p>Import a PCB first using Home → Import.</p>}</section> : <>
        <section className="assembly-workspace-inventory-shell" aria-labelledby="assembly-board-inventory-title"><div className="assembly-workspace-inventory-heading"><div><small>BOARDS & ORGANIZATION</small><h3 id="assembly-board-inventory-title">Board inventory</h3><p>Select an occurrence to scope viewport and manager commands.</p></div><label className="assembly-workspace-search"><Search size={14}/><input type="search" value={boardQuery} onChange={event => setBoardQuery(event.target.value)} placeholder="Find board by name" aria-label="Find board by name"/></label></div>
        <div className="assembly-workspace-inventory" aria-label="Retained board occurrences">{filteredBoards.map(board => {
          const visual = props.visuals[board.designId];
          const design = props.designs?.designs.find(item => item.design_id === board.designId);
          const selected = board.id === props.selectedBoardId;
          return <article key={board.id} className={selected ? "selected" : ""}><button type="button" className="assembly-workspace-board-select" aria-pressed={selected} onClick={() => props.onSelectBoard(board.id)}><span><h4 title={board.label}>{board.label}</h4><small>{selected ? "Active board occurrence" : "Select board occurrence"}</small></span><CircuitBoard size={18}/></button><dl><div><dt>Components</dt><dd>{itemCount(design?.components)}</dd></div><div><dt>Nets</dt><dd>{itemCount(design?.nets)}</dd></div><div><dt>Layers</dt><dd>{itemCount(design?.layers)}</dd></div></dl><p className="assembly-workspace-graphics">{visual?.boardModelUrl ? "Board graphics ready" : visual ? "Board source ready; 3D graphics preparing" : "Preparing retained board source"}{visual?.componentModelUrl ? " · Component graphics ready" : ""}</p>{props.diagnostics[board.designId] && <p className="assembly-workspace-diagnostic">{props.diagnostics[board.designId]}</p>}<div className="assembly-workspace-board-actions"><button type="button" onClick={() => props.embedded ? props.onViewBoard(board.id, "2D") : navigate(() => props.onViewBoard(board.id, "2D"))}>2D layout</button><button type="button" onClick={() => props.embedded ? props.onViewBoard(board.id, "3D") : navigate(() => props.onViewBoard(board.id, "3D"))}>3D placement</button><button type="button" onClick={() => navigate(() => props.onManager(board.id, "layers"))}><Layers3 size={14}/> Layers</button><button type="button" onClick={() => navigate(() => props.onManager(board.id, "nets"))}><Network size={14}/> Nets</button><button type="button" onClick={() => navigate(() => props.onManager(board.id, "links"))}><Cable size={14}/> Pin links</button></div></article>;
        })}{!boards.length && <p>Load the saved board records, then add a duplicate or import another board.</p>}{boards.length > 0 && !filteredBoards.length && <p>No board names match this filter.</p>}</div></section>
        {!props.designs && <button type="button" onClick={() => void props.onUpdated().catch(error => setError(String(error)))}>Load saved board records</button>}
        <p className="assembly-workspace-note">Board occurrence selection scopes layers, nets and links. Equal net names on separate boards remain independent until a saved connector or harness mapping links them. Coupled PI/SI, RC thermal and magnetic-loop studies use bounded reduced models; full-wave assembly EM remains unsupported.</p>
        <AssemblyStructureEditor projectPath={props.projectPath} projectManifestDigest={props.manifestDigest} assemblyIr={props.assembly ?? EMPTY} assemblyDesigns={props.designs} focusSection={section === "placement" ? "boards" : section} onDirtyChange={handleDirtyChange} onUpdated={props.onUpdated} onStatus={props.onStatus}/>
      </>}
    </div>
  </section></div>;
}
