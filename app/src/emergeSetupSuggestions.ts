// SPDX-License-Identifier: Apache-2.0
import type { ParsedPad } from "./boardParser";
export type EMergePadPair = { signalId: string; returnId: string; signalLayer: string; returnLayer: string };

/** Conservative convenience proposals from explicit pad locations; solver preflight remains authoritative. */
export function suggestEMergePadPairs(pads: readonly ParsedPad[], signalNet: string, returnNet: string, copperLayerOrder: readonly string[] = []): EMergePadPair[] {
  if (!signalNet || !returnNet || signalNet === returnNet) return [];
  const depth = (layer: string) => layer === "F.Cu" ? 0 : layer === "B.Cu" ? 33 : /^In\d+\.Cu$/.test(layer) ? Number(layer.slice(2, -3)) : -1;
  const admissible = (pad: ParsedPad) => pad.id && pad.drill === 0 && pad.layers.length === 1 && depth(pad.layers[0]) >= 0
    && pad.at.every(Number.isFinite) && ["rect", "roundrect", "circle", "oval"].includes(pad.shape);
  const returns = new Map<string, ParsedPad[]>();
  const key = (pad: ParsedPad) => `${pad.at[0]},${pad.at[1]}`;
  for (const pad of pads) if (pad.net === returnNet && admissible(pad)) {
    const bucket = returns.get(key(pad)) ?? [];
    if (bucket.length < 32) bucket.push(pad);
    returns.set(key(pad), bucket);
  }
  const pairs: EMergePadPair[] = [];
  for (const signal of pads) if (signal.net === signalNet && admissible(signal)) {
    for (const ground of returns.get(key(signal)) ?? []) if (copperLayerOrder.indexOf(signal.layers[0]) >= 0
        && copperLayerOrder.indexOf(ground.layers[0]) === copperLayerOrder.indexOf(signal.layers[0]) + 1) {
      pairs.push({ signalId: signal.id, returnId: ground.id, signalLayer: signal.layers[0], returnLayer: ground.layers[0] });
      if (pairs.length >= 100) return pairs;
    }
  }
  return pairs;
}
