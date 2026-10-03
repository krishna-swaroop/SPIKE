// SPDX-License-Identifier: Apache-2.0
import { HARNESS_COLUMNS } from "./importSourceRouting";

export const OPTIONAL_HARNESS_COLUMNS = ["net", "length_mm", "area_mm2", "resistance_ohm", "inductance_h", "color", "part_number"] as const;

/** Read a bounded CSV header for mapping controls; the worker validates rows. */
export function connectionListHeader(text: string, delimiter: string): string[] {
  if (![",", ";", "\t", "|"].includes(delimiter)) throw new Error("Unsupported connection-list delimiter.");
  const input = text.replace(/^\uFEFF/, "");
  const headers: string[] = [];
  let field = "", quoted = false, closed = false;
  const append = () => {
    if (headers.length >= 256) throw new Error("Connection list has too many columns.");
    if (!field || headers.includes(field)) throw new Error("Connection-list column names must be nonempty and unique.");
    headers.push(field); field = ""; closed = false;
  };
  for (let index = 0; index < input.length; index++) {
    if (index >= 65536) throw new Error("Connection-list header exceeds the 64 KiB limit.");
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else field += character;
    } else if (character === delimiter) append();
    else if (character === "\r" || character === "\n") { append(); return headers; }
    else if (closed) throw new Error("Malformed quoted connection-list column.");
    else if (character === '"' && !field) quoted = true;
    else field += character;
  }
  if (quoted) throw new Error("Unterminated quoted connection-list column.");
  append(); return headers;
}

export function connectionColumnMap(headers: string[], overrides: Record<string, string>): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const key of [...HARNESS_COLUMNS, ...OPTIONAL_HARNESS_COLUMNS]) {
    const explicit = overrides[key]?.trim();
    const source = explicit || key;
    if (explicit || HARNESS_COLUMNS.includes(key as typeof HARNESS_COLUMNS[number]) || headers.includes(source)) {
      if (!headers.includes(source)) throw new Error(`Column '${source}' for ${key} was not found. Check the delimiter and column mapping.`);
      if (Object.values(mapping).includes(source)) throw new Error(`Column '${source}' is mapped more than once.`);
      mapping[key] = source;
    }
  }
  return mapping;
}
