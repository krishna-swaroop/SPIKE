// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "./boardParser";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const nameIndexCache = new WeakMap<object, Record<string, string>>();

/** Names are presentation/legacy aliases, never an implicit electrical join. */
export function uniqueNetIdsByName(namesById: Readonly<Record<string, string>>): Record<string, string> {
  const cached = nameIndexCache.get(namesById);
  if (cached) return cached;
  const ids: Record<string, string> = Object.create(null);
  const ambiguous = new Set<string>();
  for (const [id, name] of Object.entries(namesById)) {
    if (hasOwn(ids, name)) ambiguous.add(name);
    else ids[name] = id;
  }
  for (const name of ambiguous) delete ids[name];
  nameIndexCache.set(namesById, ids);
  return ids;
}

export function resolveAssemblyNetId(source: ParsedBoard, namesById: Readonly<Record<string, string>> | undefined,
  idsByName: Readonly<Record<string, string>> | undefined, identity: string | undefined): string | null {
  if (!identity) return null;
  if (namesById && hasOwn(namesById, identity)) return identity;
  const name = hasOwn(source.nets, identity) ? source.nets[identity] : identity;
  if (namesById) return uniqueNetIdsByName(namesById)[name] ?? null;
  if (idsByName) return hasOwn(idsByName, name) ? idsByName[name] : null;
  if (hasOwn(source.nets, identity)) return identity;
  return uniqueNetIdsByName(source.nets)[identity] ?? null;
}

/** Bind parser geometry aliases once to the retained inventory for traversal. */
export function assemblyHighlightBoard(source: ParsedBoard, nets: Record<string, string>): ParsedBoard {
  const idsByName = uniqueNetIdsByName(nets);
  const resolve = (identity: string | undefined) => {
    if (!identity) return undefined;
    if (hasOwn(nets, identity)) return identity;
    return idsByName[source.nets[identity] ?? identity];
  };
  return { ...source, nets, pads: source.pads.map(pad => ({ ...pad, net: resolve(pad.net) })) };
}
