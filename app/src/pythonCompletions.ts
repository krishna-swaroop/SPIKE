// SPDX-License-Identifier: Apache-2.0
import apiCatalog from "../../schemas/python-workspace-api-v1.json";
import type { PythonTemplate } from "./pythonWorkspaceTemplates";
import type { PythonNetContext, PythonWorkspaceContext } from "./pythonWorkspaceContext";

export type PythonSuggestion = { label: string; insert: string; kind: string; detail: string; search?: string };
export type PythonCompletion = { start: number; end: number; items: PythonSuggestion[] };
const modules = ["spike", "math", "json", "csv", "pathlib", "statistics", "collections", "itertools", "datetime", "typing", "os", "sys", "re", "numpy", "scipy", "matplotlib"];
const moduleMembers: Record<string, string[]> = {
  math: ["sqrt", "sin", "cos", "tan", "pi", "log", "log10", "exp", "isfinite", "ceil", "floor"],
  json: ["loads", "dumps", "load", "dump"], pathlib: ["Path", "PurePath"],
  statistics: ["mean", "median", "stdev", "pstdev", "fmean"], csv: ["reader", "writer", "DictReader", "DictWriter"],
  numpy: ["array", "asarray", "linspace", "logspace", "zeros", "ones", "mean", "abs", "sqrt", "fft", "linalg"],
};
const keywords = ["import", "from", "def", "class", "return", "for", "while", "if", "elif", "else", "try", "except", "finally", "with", "as", "in", "is", "not", "and", "or", "True", "False", "None", "raise", "pass", "break", "continue", "lambda", "yield"];
const builtins = ["print", "len", "range", "enumerate", "zip", "sorted", "sum", "min", "max", "abs", "float", "int", "str", "list", "dict", "set", "tuple", "isinstance", "round", "open"];

// Static lexical scan: completion never imports modules, evaluates expressions or runs scripts.
export function pythonLexicalContext(code: string, caret: number) {
  let clean = "", quote = "", triple = false, stringStart = 0, comment = false;
  for (let i = 0; i < caret; i++) {
    const ch = code[i];
    if (comment) { if (ch === "\n") comment = false; clean += ch === "\n" ? ch : " "; continue; }
    if (quote) {
      if (ch === "\\") { clean += "  "; i++; continue; }
      if (ch === quote && (!triple || code.slice(i, i + 3) === quote.repeat(3))) { const count = triple ? 3 : 1; clean += " ".repeat(count); i += count - 1; quote = ""; }
      else clean += ch === "\n" ? ch : " ";
      continue;
    }
    if (ch === "#") { comment = true; clean += " "; }
    else if (ch === "'" || ch === '"') { quote = ch; triple = code.slice(i, i + 3) === ch.repeat(3); const count = triple ? 3 : 1; stringStart = i + count; clean += " ".repeat(count); i += count - 1; }
    else clean += ch;
  }
  return { clean, quote, triple, stringStart, comment };
}

export function pythonSymbols(code: string): PythonSuggestion[] {
  const clean = pythonLexicalContext(code, code.length).clean, result = new Map<string, PythonSuggestion>();
  const add = (label: string, kind: string, detail: string) => { if (result.size < 1500 && /^[A-Za-z_]\w*$/.test(label)) result.set(label, { label, insert: label, kind, detail }); };
  for (const match of clean.matchAll(/\b(def|class)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/g)) {
    add(match[2], match[1] === "def" ? "function" : "class", `${match[1]} ${match[2]}${match[3] !== undefined ? `(${match[3].trim()})` : ""}`);
    if (match[1] === "def") for (const argument of (match[3] ?? "").split(",")) { const name = argument.trim().match(/^\**([A-Za-z_]\w*)/); if (name) add(name[1], "variable", `Parameter of ${match[2]}`); }
  }
  for (const match of clean.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/g)) add(match[1], "variable", "Variable in this script");
  for (const match of clean.matchAll(/\bfor\s+([\w, ]+)\s+in\b/g)) for (const name of match[1].split(",")) add(name.trim(), "variable", "Loop variable");
  for (const match of clean.matchAll(/\b(?:import|from)\s+([\w.]+)(?:\s+as\s+(\w+))?/g)) add(match[2] ?? match[1].split(".")[0], "module", `Imported ${match[1]}`);
  for (const match of clean.matchAll(/\bfrom\s+[\w.]+\s+import\s+([^\n]+)/g)) for (const name of match[1].split(",")) { const entry = name.trim().match(/^(\w+)(?:\s+as\s+(\w+))?/); if (entry) add(entry[2] ?? entry[1], "symbol", `Imported ${entry[1]}`); }
  return [...result.values()];
}

export function pythonBaseSuggestions(templates: PythonTemplate[]): PythonSuggestion[] {
  return [
    ...keywords.map(label => ({ label, insert: label, kind: "keyword", detail: "Python keyword" })),
    ...builtins.map(label => ({ label, insert: label, kind: "function", detail: "Python built-in function" })),
    ...modules.map(label => ({ label, insert: label, kind: "module", detail: `${label === "spike" ? "Bound SPIKE workspace library" : "Module; availability depends on the Python environment"}` })),
    ...apiCatalog.members.map(member => ({ label: member.path, insert: member.insert_text ? member.insert_text.startsWith("spike.") ? member.insert_text : `spike.${member.insert_text}` : member.path, kind: member.kind, detail: `${member.signature} — ${member.description}` })),
    ...templates.map(template => ({ label: `template_${template.id.split("-").join("_")}`, insert: template.code, kind: "template", detail: `${template.title}: ${template.description}`, search: `${template.title} ${template.category}` })),
  ];
}

function score(label: string, query: string): number {
  const name = label.toLowerCase(), prefix = query.toLowerCase();
  if (!prefix) return 10;
  if (name === prefix) return 0;
  if (name.startsWith(prefix)) return 1 + (name.length - prefix.length) / 1000;
  if (name.includes(prefix)) return 3 + name.indexOf(prefix) / 100;
  let position = 0;
  for (const char of prefix) { position = name.indexOf(char, position); if (position < 0) break; position++; }
  const subsequence = position >= 0 ? 6 + (name.length - prefix.length) / 100 : Infinity;
  // A small edit-distance bound helps misspellings without making huge fuzzy lists.
  if (prefix.length < 3 || Math.abs(name.length - prefix.length) > 2) return subsequence;
  let row = Array.from({ length: prefix.length + 1 }, (_, i) => i);
  for (let i = 0; i < name.length; i++) { const next = [i + 1]; for (let j = 0; j < prefix.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(name[i] !== prefix[j]))); row = next; }
  return row[prefix.length] <= 2 ? 4 + row[prefix.length] / 10 : subsequence;
}

export function rankedPythonSuggestions(items: PythonSuggestion[], query: string, limit = 60) {
  return items.map(item => ({ item, score: Math.min(score(item.label, query), query && item.search?.toLowerCase().includes(query.toLowerCase()) ? 4 : Infinity) }))
    .filter(entry => Number.isFinite(entry.score)).sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label)).slice(0, limit).map(entry => entry.item);
}

export function pythonCompletion(code: string, caret: number, base: PythonSuggestion[], symbols: PythonSuggestion[], nets: PythonNetContext[], workspace: PythonWorkspaceContext, explicit = false): PythonCompletion | null {
  const context = pythonLexicalContext(code, caret), before = code.slice(0, caret);
  if (context.comment || context.triple) return null;
  if (context.quote) {
    const leading = code.slice(Math.max(0, context.stringStart - 240), context.stringStart - 1);
    const query = code.slice(context.stringStart, caret);
    if (query.includes("\\") || query.includes("\n")) return null;
    const call = leading.match(/spike\.(nets\.get|ui\.select_net|boards\.get|ui\.focus_board)\s*\(([^()]*)$/);
    const boardField = /\bboard_id\s*=\s*$/.test(leading) || call && ["boards.get", "ui.focus_board"].includes(call[1]);
    let items: PythonSuggestion[];
    if (boardField) items = workspace.boards.map(board => ({ label: board.name, search: board.id, insert: escapeString(board.id, context.quote), kind: "board", detail: "Board occurrence" }));
    else {
      const netField = /\b(?:net|net_name|net_id)\s*[:=]\s*$/.test(leading) || call?.[1] === "nets.get" || call?.[1] === "ui.select_net" && call[2].includes(",");
      if (!netField) return null;
      const explicitBoard = (leading + code.slice(caret, caret + 240).split(")")[0]).match(/\bboard_id\s*=\s*(['"])(.*?)\1/);
      const positionalBoard = call?.[1] === "ui.select_net" ? call[2].match(/^\s*(['"])(.*?)\1\s*,/) : null;
      const boardId = explicitBoard?.[2] ?? positionalBoard?.[2] ?? workspace.selected_board_id;
      const useName = /\bname\s*=\s*$/.test(leading) || /\b(?:net|net_name)\s*[:=]\s*$/.test(leading);
      items = nets.filter(net => (!boardId || net.boardId === boardId) && (useName || typeof net.id === "string")).map(net => ({ label: net.name, insert: escapeString(useName ? net.name : String(net.id), context.quote), kind: "net", detail: net.boardName }));
    }
    const tail = code.slice(caret).match(new RegExp(`^[^${context.quote}\\\\\\n\\r]*${context.quote}`))?.[0];
    return { start: context.stringStart, end: tail ? caret + tail.length - 1 : caret, items: rankedPythonSuggestions(items, query) };
  }
  const match = before.match(/[A-Za-z_][\w.]*$/), token = match?.[0] ?? "";
  const argument = before.match(/spike\.(nets\.get|ui\.select_net|boards\.get|ui\.focus_board)\s*\(([^()]*)$/);
  if (argument && (!token || !token.includes("."))) {
    const preceding = argument[2].slice(0, argument[2].length - token.length), namedNet = /\bname\s*=\s*$/.test(preceding) && argument[1] === "nets.get";
    const boardField = /\bboard_id\s*=\s*$/.test(preceding) || argument[1] === "boards.get" || argument[1] === "ui.focus_board" || argument[1] === "ui.select_net" && !preceding.includes(",");
    const idField = argument[1] === "nets.get" && (!preceding.trim() || /\bnet_id\s*=\s*$/.test(preceding)) || argument[1] === "ui.select_net" && preceding.includes(",");
    if (boardField || idField || namedNet) {
      const explicitBoard = preceding.match(/\bboard_id\s*=\s*(['"])(.*?)\1/), positionalBoard = argument[1] === "ui.select_net" ? preceding.match(/^\s*(['"])(.*?)\1\s*,/) : null;
      const boardId = explicitBoard?.[2] ?? positionalBoard?.[2] ?? workspace.selected_board_id;
      const items = boardField ? workspace.boards.map(board => ({ label: board.name, insert: JSON.stringify(board.id), kind: "board", detail: "Board occurrence" })) : nets.filter(net => !boardId || net.boardId === boardId).map(net => ({ label: net.name, insert: JSON.stringify(namedNet ? net.name : net.id), kind: "net", detail: net.boardName }));
      return { start: caret - token.length, end: caret, items: rankedPythonSuggestions(items, token) };
    }
  }
  if (!explicit && !token) return null;
  const start = caret - token.length, dot = token.lastIndexOf(".");
  let items = [...symbols, ...base], query = token;
  const fromImport = before.match(/\bfrom\s+([\w.]+)\s+import\s+\w*$/);
  if (fromImport) items = fromImport[1] === "spike" ? base.filter(item => item.label.startsWith("spike.") && !item.label.slice(6).includes(".")).map(item => ({ ...item, label: item.label.slice(6), insert: item.label.slice(6) })) : (moduleMembers[fromImport[1]] ?? []).map(label => ({ label, insert: label, kind: "member", detail: `from ${fromImport[1]} import ${label}` }));
  else if (/\b(?:import|from)\s+[\w.]*$/.test(before)) items = base.filter(item => item.kind === "module");
  else if (dot >= 0) {
    const prefix = token.slice(0, dot), root = prefix.split(".")[0];
    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alias = context.clean.match(new RegExp(`(?:^|\\n)\\s*import\\s+([\\w.]+)\\s+as\\s+${escapedRoot}\\b`))?.[1];
    const imported = context.clean.match(new RegExp(`\\bfrom\\s+spike\\s+import\\s+(\\w+)(?:\\s+as\\s+(\\w+))?\\b`, "g"))?.find(statement => (statement.match(/\s+as\s+(\w+)$/)?.[1] ?? statement.match(/import\s+(\w+)/)?.[1]) === root);
    const importedPath = imported?.match(/import\s+(\w+)/)?.[1];
    const module = `${alias ?? (importedPath ? `spike.${importedPath}` : root)}${prefix.slice(root.length)}`;
    items = module === "spike" || module.startsWith("spike.") ? base.filter(item => item.label.startsWith(`${module}.`) && !item.label.slice(module.length + 1).includes(".")).map(item => ({ ...item, label: item.label.slice(module.length + 1), insert: item.insert.startsWith(`${module}.`) ? item.insert.slice(module.length + 1) : item.insert }))
      : (moduleMembers[module] ?? []).map(label => ({ label, insert: label, kind: "member", detail: `${module}.${label}` }));
    query = token.slice(dot + 1);
  }
  const unique = new Map<string, PythonSuggestion>();
  for (const item of items) if (!unique.has(item.label)) unique.set(item.label, item);
  return { start: dot >= 0 ? start + dot + 1 : start, end: caret + (code.slice(caret).match(/^\w*/)?.[0].length ?? 0), items: rankedPythonSuggestions([...unique.values()], query) };
}

function escapeString(value: string, quote: string) { return value.split("\\").join("\\\\").split(quote).join(`\\${quote}`).split("\n").join("\\n").split("\r").join("\\r"); }

export function applyPythonCompletion(code: string, completion: PythonCompletion, item: PythonSuggestion) {
  const lines = code.slice(0, completion.start).split("\n");
  const line = lines[lines.length - 1] ?? "";
  const indent = line.match(/^\s*/)?.[0] ?? "";
  let selection: { start: number; end: number } | undefined;
  let insert = item.kind === "template" ? item.insert.split("\n").join(`\n${indent}`) : item.insert;
  if (item.kind === "function") insert = insert.replace(/\$\{\d+:([^}]+)\}/g, (whole, value: string, offset: number) => { if (!selection) selection = { start: completion.start + offset, end: completion.start + offset + value.length }; return value; });
  return { code: code.slice(0, completion.start) + insert + code.slice(completion.end), caret: completion.start + insert.length, selection };
}
