// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PythonWorkspace from "../src/PythonWorkspace";
import { admittedPythonUiActions, pythonBoardNets, type PythonWorkspaceContext } from "../src/pythonWorkspaceContext";
import "../src/styles.css";
import "../src/buttonStandard.css";

async function start() {
  const response = await fetch("/.tmp/assembly-performance/source.json");
  if (!response.ok) throw new Error("Capture the real assembly fixture before opening this page.");
  const snapshot = await response.json(), design = snapshot.design;
  if (!design?.nets || !design?.design_id) throw new Error("Fixture has no normalized board net inventory.");
  const initial: PythonWorkspaceContext = { boards: [
    { id: "sailor-A", name: "Sailor HAT · A", design_id: design.design_id, design },
    { id: "sailor-B", name: "Sailor HAT · B", design_id: design.design_id, design },
  ], selected_board_id: "sailor-A", assembly: null };
  function Preview() {
    const [workspace, setWorkspace] = useState(initial), [message, setMessage] = useState(""), [open, setOpen] = useState(true);
    return <><p role="status" data-interface-action={message}>Real retained board inventory, duplicated occurrences. Browser editing only; no solver results.</p>{open && <PythonWorkspace design={design} results={null} workspace={workspace} onClose={() => { setOpen(false); setMessage("Workspace closed"); }} onStatus={setMessage} onUiAction={candidate => {
      const action = admittedPythonUiActions([candidate], workspace)[0];
      if (action.action === "focus_board") setWorkspace(current => ({ ...current, selected_board_id: action.board_id }));
      setMessage(action.action === "select_net" ? `Requested ${pythonBoardNets(workspace).find(net => net.boardId === action.board_id && net.id === action.net_id)?.name} on ${workspace.boards.find(board => board.id === action.board_id)?.name}` : `Requested ${action.action}`);
    }}/>}</>;
  }
  createRoot(document.getElementById("root")!).render(<Preview/>);
}
start().catch(error => { document.getElementById("root")!.textContent = String(error); });
