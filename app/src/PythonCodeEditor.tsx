// SPDX-License-Identifier: Apache-2.0
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { applyPythonCompletion, pythonBaseSuggestions, pythonCompletion, pythonSymbols, type PythonCompletion } from "./pythonCompletions";
import { PYTHON_TEMPLATES } from "./pythonWorkspaceTemplates";
import { pythonBoardNets, type PythonWorkspaceContext } from "./pythonWorkspaceContext";
import "./pythonCompletions.css";

const EMPTY_WORKSPACE: PythonWorkspaceContext = { boards: [], selected_board_id: null, assembly: null };

export default function PythonCodeEditor({ code, breakpoints, executionLine, locked, focusLine, insertion, workspace = EMPTY_WORKSPACE, onInserted, onChange, onBreakpoint, onCursor, onShortcut }: {
  code: string; breakpoints: number[]; executionLine?: number; locked: boolean;
  workspace?: PythonWorkspaceContext;
  focusLine?: { line: number; revision: number };
  insertion?: { text: string; revision: number };
  onInserted?: () => void;
  onChange: (code: string) => void; onBreakpoint: (line: number) => void;
  onCursor: (line: number, column: number) => void; onShortcut: (event: KeyboardEvent) => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [completion, setCompletion] = useState<PythonCompletion | null>(null);
  const [choice, setChoice] = useState(0);
  const [anchor, setAnchor] = useState({ left: 65, top: 12, width: 340 });
  const base = useMemo(() => pythonBaseSuggestions(PYTHON_TEMPLATES), []);
  const deferredCode = useDeferredValue(code);
  const symbols = useMemo(() => pythonSymbols(deferredCode), [deferredCode]);
  const nets = useMemo(() => pythonBoardNets(workspace), [workspace]);
  const place = () => {
    const element = editor.current, root = container.current, measuring = mirror.current;
    if (!element || !root || !measuring) return;
    const style = getComputedStyle(element);
    Object.assign(measuring.style, { font: style.font, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, padding: style.padding, tabSize: style.tabSize });
    measuring.textContent = element.value.slice(0, element.selectionStart);
    const marker = document.createElement("span"); marker.textContent = "\u200b"; measuring.appendChild(marker);
    const point = marker.getBoundingClientRect(), bounds = measuring.getBoundingClientRect();
    const x = element.offsetLeft + point.left - bounds.left - element.scrollLeft;
    const y = point.top - bounds.top - element.scrollTop;
    const width = Math.min(380, Math.max(180, root.clientWidth - element.offsetLeft - 8));
    const popupHeight = Math.min(300, Math.max(110, root.clientHeight - 16));
    setAnchor({ left: Math.min(Math.max(element.offsetLeft + 4, x), Math.max(element.offsetLeft + 4, root.clientWidth - width - 4)), top: Math.max(4, y + 20 + popupHeight > root.clientHeight ? y - popupHeight : y + 20), width });
  };
  const suggest = (value = editor.current?.value ?? code, explicit = false) => {
    const element = editor.current;
    if (!element || locked || element.selectionStart !== element.selectionEnd) { setCompletion(null); return; }
    const found = pythonCompletion(value, element.selectionStart, base, symbols, nets, workspace, explicit);
    setCompletion(found?.items.length ? found : null); setChoice(0); place();
  };
  const accept = (index: number) => {
    if (!completion || locked) return;
    const replacement = applyPythonCompletion(code, completion, completion.items[index]);
    clearTimeout(timer.current); onChange(replacement.code); setCompletion(null);
    requestAnimationFrame(() => { const element = editor.current; if (element) { element.focus(); element.selectionStart = replacement.selection?.start ?? replacement.caret; element.selectionEnd = replacement.selection?.end ?? replacement.caret; cursor(); } });
  };
  useEffect(() => { const element = editor.current; if (!element || !insertion || locked) return; const start = element.selectionStart, end = element.selectionEnd; onChange(code.slice(0, start) + insertion.text + code.slice(end)); onInserted?.(); setCompletion(null); requestAnimationFrame(() => { element.focus(); element.selectionStart = element.selectionEnd = start + insertion.text.length; cursor(); }); }, [insertion?.revision]);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const lineCount = code.split("\n").length;
  const firstLine = Math.max(1, Math.floor(scrollTop / 18) - 3);
  const lastLine = Math.min(lineCount, firstLine + Math.ceil(height / 18) + 8);
  useEffect(() => {
    const element = editor.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { setHeight(element.clientHeight); setCompletion(null); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (locked) { clearTimeout(timer.current); setCompletion(null); } }, [locked]);
  useEffect(() => { clearTimeout(timer.current); setCompletion(null); }, [workspace]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { popup.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [choice]);
  useEffect(() => {
    const element = editor.current;
    if (!element || !focusLine) return;
    const lines = code.split("\n");
    const offset = lines.slice(0, focusLine.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    element.focus(); element.selectionStart = element.selectionEnd = offset;
    element.scrollTop = Math.max(0, (focusLine.line - 1) * 18 - element.clientHeight / 3);
    setScrollTop(element.scrollTop);
  }, [focusLine?.revision]);
  const cursor = () => {
    const element = editor.current;
    if (!element) return;
    const preceding = code.slice(0, element.selectionStart).split("\n");
    onCursor(preceding.length, preceding[preceding.length - 1].length + 1);
  };
  return <div ref={container} className="python-code-editor">
    <div ref={mirror} className="python-caret-mirror" aria-hidden="true" />
    <div className="python-line-gutter" aria-label="Breakpoint gutter">
      <div style={{ transform: `translateY(${12 + (firstLine - 1) * 18 - scrollTop}px)` }}>
        {Array.from({ length: Math.max(0, lastLine - firstLine + 1) }, (_, index) => firstLine + index).map(line => <button key={line} type="button" className={`${breakpoints.includes(line) ? "has-breakpoint" : ""} ${executionLine === line ? "execution-line" : ""}`} aria-label={`${breakpoints.includes(line) ? "Remove" : "Add"} breakpoint at line ${line}`} aria-pressed={breakpoints.includes(line)} onClick={() => onBreakpoint(line)} title={`Line ${line} · Click to toggle breakpoint`}><span>{executionLine === line ? "➜" : breakpoints.includes(line) ? "●" : ""}</span>{line}</button>)}
      </div>
    </div>
    <textarea ref={editor} aria-label="Python script editor" aria-autocomplete="list" aria-controls={completion ? "python-suggestions" : undefined} aria-expanded={Boolean(completion)} aria-activedescendant={completion ? `python-suggestion-${choice}` : undefined} value={code} spellCheck={false} wrap="off" readOnly={locked} onChange={event => { const value = event.target.value; onChange(value); setCompletion(null); clearTimeout(timer.current); timer.current = setTimeout(() => suggest(value), 70); }} onBlur={() => { clearTimeout(timer.current); setCompletion(null); }} onClick={() => { clearTimeout(timer.current); setCompletion(null); }} onSelect={cursor} onScroll={event => { clearTimeout(timer.current); setScrollTop(event.currentTarget.scrollTop); setCompletion(null); }} onKeyDown={event => {
      if (["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) clearTimeout(timer.current);
      if (!locked && (event.ctrlKey || event.metaKey) && event.code === "Space") { event.preventDefault(); event.stopPropagation(); suggest(code, true); return; }
      if (completion && !locked) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); setChoice(current => (current + (event.key === "ArrowDown" ? 1 : -1) + completion.items.length) % completion.items.length); return; }
        if (event.key === "Tab" || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); accept(choice); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clearTimeout(timer.current); setCompletion(null); return; }
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) setCompletion(null);
      }
      onShortcut(event);
      if (event.defaultPrevented || locked) return;
      if (event.key === "Tab") {
        event.preventDefault();
        const element = event.currentTarget, start = element.selectionStart, end = element.selectionEnd;
        onChange(`${code.slice(0, start)}    ${code.slice(end)}`);
        requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 4; cursor(); });
      }
    }} />
    {completion && <div className="python-completion-popup" style={{ ...anchor, maxHeight: Math.max(100, Math.min(300, height - 8)) }} onPointerDown={event => event.preventDefault()}>
      <div ref={popup} id="python-suggestions" role="listbox" aria-label="Python suggestions">{completion.items.map((item, index) => <button type="button" role="option" id={`python-suggestion-${index}`} key={`${item.label}:${index}`} aria-selected={choice === index} tabIndex={-1} onMouseEnter={() => setChoice(index)} onClick={() => accept(index)}><small>{item.kind}</small><span>{item.label}</span>{item.kind === "net" && <em>{item.detail}</em>}</button>)}</div>
      <div className="python-completion-detail"><span>{completion.items[choice]?.detail}</span><small>↑ ↓ choose · Tab / Enter insert · Esc dismiss</small></div>
    </div>}
  </div>;
}
