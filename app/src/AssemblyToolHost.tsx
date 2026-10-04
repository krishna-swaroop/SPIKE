// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { closeAssemblyToolWindow, openAssemblyToolWindow, updateAssemblyToolWindow } from "./assemblyToolWindows";
import type { AssemblyToolAction, AssemblyToolKind, AssemblyToolSnapshot, AssemblyToolViewportData } from "./assemblyToolWindowModel";

/** Parent owns project/source state; the child owns only its disposable renderer and tool UI. */
export default function AssemblyToolHost({ kind, snapshot, viewportData, onAction, onClose }: {
  kind: AssemblyToolKind; snapshot: AssemblyToolSnapshot; viewportData?: AssemblyToolViewportData;
  onAction: (action: AssemblyToolAction) => unknown | Promise<unknown>; onClose: () => void;
}) {
  const latest = useRef({ snapshot, viewportData, onAction, onClose }); latest.current = { snapshot, viewportData, onAction, onClose };
  const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let opening: Promise<void> | undefined, disposed = false;
    const timer = setTimeout(() => {
      opening = openAssemblyToolWindow(kind, latest.current.snapshot, action => {
        if (action.type === "closed" || action.type === "close") { latest.current.onClose(); return; }
        return latest.current.onAction(action);
      }, latest.current.viewportData);
      void opening.catch(error => { if (!disposed) setError(error instanceof Error ? error.message : String(error)); });
    }, 0);
    return () => { disposed = true; clearTimeout(timer); if (opening) void opening.then(() => closeAssemblyToolWindow(kind)).catch(() => {}); };
  }, [kind, attempt]);
  useEffect(() => { void updateAssemblyToolWindow(kind, snapshot, viewportData).catch(error => setError(String(error))); }, [kind, snapshot, viewportData]);
  if (!error) return null;
  return <aside className="assembly-tool-open-error" role="alert"><b>Could not open the assembly tool window</b><span>{error}</span><button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button><button onClick={onClose}>Close</button></aside>;
}
