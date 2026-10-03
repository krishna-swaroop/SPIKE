// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { pythonBoardNets, type PythonUiAction, type PythonWorkspaceContext } from "./pythonWorkspaceContext";
import "./pythonNetBrowser.css";

export default function PythonNetBrowser({ workspace, disabled, onInsert, onAction }: { workspace: PythonWorkspaceContext; disabled: boolean; onInsert: (text: string) => void; onAction?: (action: PythonUiAction) => void }) {
  const [boardId, setBoardId] = useState(workspace.selected_board_id ?? "");
  const [query, setQuery] = useState("");
  useEffect(() => { setBoardId(workspace.selected_board_id ?? ""); }, [workspace.selected_board_id]);
  useEffect(() => { if (boardId && !workspace.boards.some(board => board.id === boardId)) setBoardId(""); }, [workspace.boards, boardId]);
  const nets = useMemo(() => pythonBoardNets(workspace), [workspace]);
  const filtered = nets.filter(net => (!boardId || net.boardId === boardId) && net.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="python-net-browser" aria-label="Loaded board nets">
    <h2>Board nets</h2><p>Insert names or board-scoped lookups. Equal names on different boards remain separate.</p>
    <label>Board<select aria-label="Python net board" value={boardId} onChange={event => setBoardId(event.target.value)}><option value="">All loaded boards</option>{workspace.boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
    <input type="search" aria-label="Search Python board nets" placeholder="Find a net…" value={query} onChange={event => setQuery(event.target.value)} />
    <small role="status">{filtered.length} of {nets.length} nets{filtered.length > 150 ? " · refine search to see more" : ""}</small>
    {!workspace.boards.length && <p>No board loaded. Import a board or open a multi-board project.</p>}
    {Boolean(workspace.boards.length) && !filtered.length && <p>No matching nets.</p>}
    <div className="python-net-rows">{filtered.slice(0, 150).map(net => <article key={JSON.stringify([net.boardId, net.id])}><strong title={net.name}>{net.name}</strong><small title={net.boardName}>{net.boardName}</small><div>
      <button type="button" disabled={disabled} onClick={() => onInsert(JSON.stringify(net.name))} title={`Insert ${net.name} as a Python string`}>Name</button>
      <button type="button" disabled={disabled} onClick={() => onInsert(`spike.nets.get(name=${JSON.stringify(net.name)}, board_id=${JSON.stringify(net.boardId)})`)} title="Insert a lookup scoped to this board">Lookup</button>
      <button type="button" disabled={!onAction} onClick={() => onAction?.({ action: "select_net", board_id: net.boardId, net_id: net.id })} title="Highlight this net using explicit saved inter-board links">Highlight</button>
    </div></article>)}</div>
  </section>;
}
