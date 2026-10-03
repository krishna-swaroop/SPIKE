// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Cable, CheckCircle2, CircleDashed, Link2, Plus, Search, Trash2, X } from "./icons";
import type { AssemblyDesigns, AssemblyIr } from "./mcadAssembly";
import { boardOccurrences, connectorOccurrences, validateExplicitNetLink, type ExplicitNetLinkRow } from "./assemblyBoardManagerModel";
import "./assemblyConnectorLinks.css";

export default function AssemblyConnectorLinks({ assembly, designs, rows, edits, onChange, onApply, onSave, onRemove, onDiscard, onAdd }: {
  assembly: AssemblyIr; designs: AssemblyDesigns; rows: ExplicitNetLinkRow[]; edits: Record<string, ExplicitNetLinkRow>;
  onChange: (original: ExplicitNetLinkRow, value: Partial<ExplicitNetLinkRow>) => void;
  onApply: (row: ExplicitNetLinkRow) => void; onSave: (original: ExplicitNetLinkRow, row: ExplicitNetLinkRow) => void;
  onRemove: (original: ExplicitNetLinkRow) => void; onDiscard: (original: ExplicitNetLinkRow) => void; onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const boards = boardOccurrences(assembly, designs), connectors = connectorOccurrences(assembly, designs);
  const names = boards.map((board, index) => {
    const rawName = assembly.boards.find(item => item.id === board.id)?.name;
    return typeof rawName === "string" && rawName.trim() ? rawName : designs.designs.find(design => design.design_id === board.designId)?.name || `Board ${index + 1}`;
  });
  const boardLabels = new Map(boards.map((board, index) => [board.id, names.filter(name => name === names[index]).length > 1 ? `${names[index]} (${index + 1})` : names[index]]));
  const boardName = (endpoint: string) => boardLabels.get(connectors.find(connector => connector.occurrenceId === endpoint)?.boardId ?? "") ?? "Choose a board connector";
  const connector = (endpoint: string) => connectors.find(connector => connector.occurrenceId === endpoint);
  const pinName = (endpoint: string, id: string) => connector(endpoint)?.pins.find(pin => pin.id === id)?.net?.name ?? "unresolved net";
  const pending = rows.filter(row => !row.applied || Boolean(edits[row.id])).length;
  const visible = rows.filter(original => {
    const row = edits[original.id] ?? original;
    return [boardName(row.endpointA), connector(row.endpointA)?.name, row.pinA, pinName(row.endpointA, row.pinA), boardName(row.endpointB), connector(row.endpointB)?.name, row.pinB, pinName(row.endpointB, row.pinB)]
      .join(" ").toLowerCase().includes(query.trim().toLowerCase());
  });
  const lastPage = Math.max(0, Math.ceil(visible.length / 100) - 1), currentPage = Math.min(page, lastPage);
  const endpointCard = (original: ExplicitNetLinkRow, row: ExplicitNetLinkRow, side: "A" | "B") => {
    const endpoint = side === "A" ? row.endpointA : row.endpointB, pinId = side === "A" ? row.pinA : row.pinB;
    const opposite = side === "A" ? row.endpointB : row.endpointA;
    const selected = connector(endpoint);
    const choices = connectors.filter(item => item.occurrenceId !== opposite && item.boardId !== connector(opposite)?.boardId);
    return <section className="connector-link-endpoint" aria-label={`Board ${side}`}>
      <div className="connector-link-board"><span className="connector-link-side">{side}</span><b title={boardName(endpoint)}>{boardName(endpoint)}</b></div>
      {original.applied ? <div className="connector-link-connector"><Cable size={15}/><b title={selected?.name}>{selected?.name ?? "Unavailable connector"}</b><small>Connector</small></div>
        : <label className="connector-link-field">Connector<select aria-label={`Connector ${side}`} value={endpoint} onChange={event => onChange(original, side === "A" ? { endpointA: event.target.value, pinA: "" } : { endpointB: event.target.value, pinB: "" })}>
          <option value="">Choose board / connector</option>{choices.map(item => <option key={item.occurrenceId} value={item.occurrenceId}>{boardName(item.occurrenceId)} / {item.name}</option>)}
        </select></label>}
      <label className="connector-link-field">Pin &amp; net<select aria-label={`Pin and net ${side}`} title={pinId ? `${pinId} · ${pinName(endpoint, pinId)}` : "Choose pin"} value={pinId} disabled={!selected} onChange={event => onChange(original, side === "A" ? { pinA: event.target.value } : { pinB: event.target.value })}>
        <option value="">Choose pin</option>{pinId && !selected?.pins.some(pin => pin.id === pinId) && <option value={pinId}>Unavailable pin</option>}
        {(selected?.pins ?? []).map(pin => <option key={pin.id} value={pin.id}>{pin.id} · {pin.net?.name ?? "unresolved net"}</option>)}
      </select></label>
    </section>;
  };
  return <div className="assembly-connector-links">
    <header className="connector-links-intro"><div><h2><Cable size={19}/> Connect boards</h2><p>Map one connector pin to another. Matching net names are linked only through these connections.</p></div><button className="connector-link-add" onClick={() => { setQuery(""); setPage(Math.floor(rows.length / 100)); onAdd(); }}><Plus size={15}/> Add connection</button></header>
    <div className="connector-links-toolbar"><label><Search size={14}/><input aria-label="Find connector links" placeholder="Find a board, connector or net" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/>{query && <button onClick={() => { setQuery(""); setPage(0); }} aria-label="Clear link search"><X size={13}/></button>}</label>
      <span><CheckCircle2 size={13}/>{rows.filter(row => row.applied).length} applied</span>{pending > 0 && <span className="pending"><CircleDashed size={13}/>{pending} pending</span>}
    </div>
    <div className="connector-link-cards">{visible.slice(currentPage * 100, (currentPage + 1) * 100).map(original => {
      const row = edits[original.id] ?? original;
      let issue = ""; try { validateExplicitNetLink(assembly, designs, row); } catch (error) { issue = error instanceof Error ? error.message : "Review both connectors and pins."; }
      const changed = Boolean(edits[original.id]);
      const state = issue ? "Needs setup" : original.applied && !changed ? "Applied" : changed ? "Unsaved edit" : "Ready to connect";
      return <article key={original.id} className={`connector-link-card ${issue ? "incomplete" : original.applied && !changed ? "applied" : "pending"}`} aria-label={`Connection: ${boardName(row.endpointA)} to ${boardName(row.endpointB)}`}>
        <div className="connector-link-flow">{endpointCard(original, row, "A")}<div className="connector-link-bridge" aria-label="Pin-to-pin connection"><i/><span><Link2 size={20}/></span><i/></div>{endpointCard(original, row, "B")}</div>
        <footer><div className="connector-link-state">{original.applied && !changed && !issue ? <CheckCircle2 size={14}/> : <CircleDashed size={14}/>}<b>{state}</b>{issue && <small>{issue}</small>}</div>
          <div className="connector-link-actions">{original.applied ? <><button className="primary" disabled={!changed || Boolean(issue)} onClick={() => onSave(original, row)}>Save changes</button>{changed && <button onClick={() => onDiscard(original)}>Discard edit</button>}<button onClick={() => onRemove(original)} aria-label={`Remove connection from ${boardName(row.endpointA)} to ${boardName(row.endpointB)}`}><Trash2 size={13}/> Remove</button></>
            : <><button className="primary" disabled={Boolean(issue)} onClick={() => onApply(row)}>Apply connection</button><button onClick={() => onDiscard(original)}>Discard</button></>}</div>
        </footer>
      </article>;
    })}</div>
    {lastPage > 0 && <div className="connector-links-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
    {!visible.length && <div className="connector-links-empty"><Link2 size={28}/><b>{query ? "No connections match your search" : "Connect your first pair of boards"}</b><p>{query ? "Search by board, connector, pin or net name." : "Choose two board connectors, match their pins, then apply the connection."}</p>{query ? <button onClick={() => setQuery("")}>Clear search</button> : <button onClick={onAdd}><Plus size={14}/> Add connection</button>}</div>}
  </div>;
}
