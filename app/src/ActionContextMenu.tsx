// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Atom, ClipboardPaste, Code2, Copy, Hash, IndentDecrease, IndentIncrease, Layers3, MousePointer2, Pencil, Scissors, TextSelect } from "./icons";
import "./ActionContextMenu.css";

export type ContextAction = { label: string; description?: string; disabled?: boolean; run: () => void };
export default function ActionContextMenu({ x, y, title, actions, onClose }: { x: number; y: number; title: string; actions: ContextAction[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const close = () => { onClose(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  useEffect(() => {
    const element = menu.current; if (!element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => { if (!element.contains(event.target as Node)) closeRef.current(); };
    const escape = () => closeRef.current();
    document.addEventListener("pointerdown", dismiss); window.addEventListener("resize", escape); window.addEventListener("scroll", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", escape); window.removeEventListener("scroll", escape, true); };
  }, [x, y]);
  return createPortal(<div ref={menu} className="spike-action-context-menu" role="menu" aria-label={`${title} context menu`} style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
    }}><strong>{title}</strong>{actions.map(action => { const Icon = /^cut$/i.test(action.label) ? Scissors : /^paste$/i.test(action.label) ? ClipboardPaste : /^select all$/i.test(action.label) ? TextSelect : /^dedent$/i.test(action.label) ? IndentDecrease : /^indent$/i.test(action.label) ? IndentIncrease : /comment/i.test(action.label) ? Hash : /script/i.test(action.label) ? Code2 : /copy|duplicate/i.test(action.label) ? Copy : /material/i.test(action.label) ? Atom : /layer/i.test(action.label) ? Layers3 : /edit/i.test(action.label) ? Pencil : MousePointer2;
      return <button type="button" key={action.label} role="menuitem" title={action.description ?? action.label} disabled={action.disabled} onClick={() => { close(); action.run(); }}><Icon size={15} aria-hidden="true"/><span>{action.label}</span></button>; })}</div>, document.body);
}
