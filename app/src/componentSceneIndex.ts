// SPDX-License-Identifier: Apache-2.0
import type { ParsedPad } from "./boardParser";

/** One pad pass replaces per-component and per-model-node pad scans. */
export function componentMountIndex(pads: readonly ParsedPad[]) {
  const tht = new Set<string>();
  for (const pad of pads) if (pad.ref && (pad.drill > 0 || pad.type === "thru_hole" || pad.pad_kind === "thru_hole")) tht.add(pad.ref);
  return tht;
}

/** Longest exact reference followed by a KiCad model-name separator, in O(name).
 * Delimiters inside a reference remain supported; R1 never matches R10.
 */
export function componentReferenceLookup(refs: Iterable<string>) {
  const names = new Set(refs), cache = new Map<string, string | undefined>();
  return (name: string): string | undefined => {
    if (cache.has(name)) return cache.get(name);
    let ref = names.has(name) ? name : undefined;
    if (!ref) for (let i = name.length - 1; i > 0; i--) if ("_.-".includes(name[i]) && names.has(name.slice(0, i))) { ref = name.slice(0, i); break; }
    cache.set(name, ref); return ref;
  };
}
