// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "./boardParser";

export type ScopedNet = { boardId: string; netId: string; netName: string };
export type ScopedComponent = { boardId: string; componentId: string; reference: string };
export type AssemblyHighlightSeed =
  | { kind: "net"; boardId: string; netId: string }
  | { kind: "component"; boardId: string; componentId: string };

export type AssemblyNetHighlightRequest = {
  boards: Readonly<Record<string, ParsedBoard>>;
  assembly: {
    harnesses?: readonly Record<string, unknown>[];
    connector_mappings?: readonly Record<string, unknown>[];
  };
  seed: AssemblyHighlightSeed;
  /** Scoped component identities (`board occurrence::component ID`) which may
   * carry traversal from one incident non-ground net to the others. */
  passThroughComponents?: readonly string[];
};

export type AssemblyNetHighlightResult = {
  nets: ScopedNet[];
  componentBoundaries: ScopedComponent[];
  passThroughComponents: ScopedComponent[];
  unresolvedPinLinks: Array<{ endpointA: string; pinA: string; endpointB: string; pinB: string }>;
  netsByBoard: Record<string, string[]>;
};

type Link = { endpointA: string; endpointB: string; pinMap: Record<string, unknown> };
type NetIndex = { byId: Map<string, string>; idsByName: Map<string, string[]> };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): string => typeof value === "string" ? value : "";
const scoped = (boardId: string, entityId: string): string => `${boardId}::${entityId}`;

export function isGroundNetName(name: string): boolean {
  return /^(?:0|ground|vss|(?:[adp]?gnd))(?:$|[_-])/i.test(name.trim());
}

function netIndex(board: ParsedBoard): NetIndex {
  const byId = new Map<string, string>();
  const idsByName = new Map<string, string[]>();
  for (const [id, name] of Object.entries(board.nets)) {
    byId.set(id, name);
    idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  }
  return { byId, idsByName };
}

function canonicalNet(index: NetIndex, identity: unknown): string | null {
  const value = string(identity);
  if (index.byId.has(value)) return value;
  const matches = index.idsByName.get(value) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function endpoint(value: string): [string, string] | null {
  const split = value.indexOf("::");
  return split > 0 && split < value.length - 2 ? [value.slice(0, split), value.slice(split + 2)] : null;
}

function links(assembly: AssemblyNetHighlightRequest["assembly"]): Link[] {
  const result: Link[] = [];
  for (const raw of assembly.harnesses ?? []) {
    const pinMap = object(raw.pin_map);
    if (pinMap) result.push({ endpointA: string(raw.endpoint_a), endpointB: string(raw.endpoint_b), pinMap });
  }
  for (const raw of assembly.connector_mappings ?? []) {
    if (raw.kind !== "connector-mate") continue;
    const data = object(raw.data), pinMap = object(data?.pin_map);
    if (data && pinMap) result.push({ endpointA: string(data.endpoint_a), endpointB: string(data.endpoint_b), pinMap });
  }
  return result;
}

/** Compute selection highlighting without relying on global net names.
 *
 * Net traversal crosses board occurrences only through retained harness or
 * connector-mate pin maps. Component traversal stops at every encountered
 * component unless it is the component seed or is explicitly pass-through.
 */
export function assemblyNetHighlight(request: AssemblyNetHighlightRequest): AssemblyNetHighlightResult {
  const indexes = new Map(Object.entries(request.boards).map(([id, board]) => [id, netIndex(board)]));
  const padsByNet = new Map<string, Array<{ componentKey: string; component: ScopedComponent }>>();
  const netsByComponent = new Map<string, Set<string>>();
  const components = new Map<string, ScopedComponent>();

  for (const [boardId, board] of Object.entries(request.boards)) {
    const index = indexes.get(boardId)!;
    const componentByRef = new Map(board.components.map(item => [item.ref, item]));
    for (const item of board.components) components.set(scoped(boardId, item.id), { boardId, componentId: item.id, reference: item.ref });
    for (const pad of board.pads) {
      const component = pad.ref ? componentByRef.get(pad.ref) : undefined;
      const netId = canonicalNet(index, pad.net);
      if (!component || !netId) continue;
      const componentKey = scoped(boardId, component.id), netKey = scoped(boardId, netId);
      const occurrence = components.get(componentKey)!;
      padsByNet.set(netKey, [...(padsByNet.get(netKey) ?? []), { componentKey, component: occurrence }]);
      (netsByComponent.get(componentKey) ?? netsByComponent.set(componentKey, new Set()).get(componentKey)!).add(netKey);
    }
  }

  const connectorPins = new Map<string, string>();
  for (const raw of request.assembly.connector_mappings ?? []) {
    if (raw.kind === "connector-mate") continue;
    const data = object(raw.data), pins = object(data?.pins);
    const boardId = string(data?.board_id), connectorId = string(data?.connector_id ?? raw.id), index = indexes.get(boardId);
    if (!pins || !connectorId || !index) continue;
    for (const [pin, identity] of Object.entries(pins)) {
      const netId = canonicalNet(index, identity);
      if (netId) connectorPins.set(`${scoped(boardId, connectorId)}::${pin}`, scoped(boardId, netId));
    }
  }
  // Parsed pads are a safe fallback for retained connector pin ownership.
  for (const [boardId, board] of Object.entries(request.boards)) {
    const index = indexes.get(boardId)!;
    for (const pad of board.pads) {
      const netId = canonicalNet(index, pad.net);
      const pinKey = `${scoped(boardId, pad.ref ?? "")}::${pad.name}`;
      if (pad.ref && pad.name && netId && !connectorPins.has(pinKey)) connectorPins.set(pinKey, scoped(boardId, netId));
    }
  }

  const adjacent = new Map<string, Set<string>>(), unresolvedPinLinks: AssemblyNetHighlightResult["unresolvedPinLinks"] = [];
  const connect = (a: string, b: string) => { (adjacent.get(a) ?? adjacent.set(a, new Set()).get(a)!).add(b); (adjacent.get(b) ?? adjacent.set(b, new Set()).get(b)!).add(a); };
  for (const link of links(request.assembly)) {
    const left = endpoint(link.endpointA), right = endpoint(link.endpointB);
    for (const [pinA, rawPinB] of Object.entries(link.pinMap)) {
      const pinB = string(rawPinB);
      const netA = left && connectorPins.get(`${scoped(left[0], left[1])}::${pinA}`);
      const netB = right && connectorPins.get(`${scoped(right[0], right[1])}::${pinB}`);
      if (netA && netB) connect(netA, netB);
      else unresolvedPinLinks.push({ endpointA: link.endpointA, pinA, endpointB: link.endpointB, pinB });
    }
  }

  const explicitPass = new Set(request.passThroughComponents ?? []);
  let seedComponent: string | null = null;
  const pending: Array<{ net: string; filterGround: boolean }> = [];
  const enqueue = (net: string, filterGround: boolean) => pending.push({ net, filterGround });
  const ground = (net: string) => {
    const parsed = endpoint(net)!;
    return isGroundNetName(indexes.get(parsed[0])!.byId.get(parsed[1]) ?? parsed[1]);
  };
  if (request.seed.kind === "net") {
    const index = indexes.get(request.seed.boardId);
    if (!index?.byId.has(request.seed.netId)) throw new Error("Net selection must use a retained board occurrence and canonical net ID.");
    enqueue(scoped(request.seed.boardId, request.seed.netId), false);
  } else {
    seedComponent = scoped(request.seed.boardId, request.seed.componentId);
    if (!components.has(seedComponent)) throw new Error("Component selection must use a retained board occurrence and component ID.");
    for (const net of netsByComponent.get(seedComponent) ?? []) {
      if (!ground(net)) enqueue(net, true);
    }
  }

  const selected = new Set<string>(), boundaries = new Map<string, ScopedComponent>(), traversed = new Map<string, ScopedComponent>();
  while (pending.length) {
    const { net, filterGround } = pending.pop()!;
    if (filterGround && ground(net)) continue;
    if (selected.has(net)) continue;
    selected.add(net);
    for (const linked of adjacent.get(net) ?? []) if (!selected.has(linked) && (!filterGround || !ground(linked))) enqueue(linked, filterGround);
    for (const { componentKey, component } of padsByNet.get(net) ?? []) {
      if (componentKey === seedComponent || explicitPass.has(componentKey)) {
        traversed.set(componentKey, component); boundaries.delete(componentKey);
        for (const next of netsByComponent.get(componentKey) ?? []) {
          if (!ground(next) && !selected.has(next)) enqueue(next, true);
        }
      } else if (!traversed.has(componentKey)) boundaries.set(componentKey, component);
    }
  }

  const nets = [...selected].sort().map(key => { const [boardId, netId] = endpoint(key)!; return { boardId, netId, netName: indexes.get(boardId)!.byId.get(netId) ?? netId }; });
  const netsByBoard: Record<string, string[]> = {};
  for (const net of nets) (netsByBoard[net.boardId] ??= []).push(net.netId);
  return { nets, componentBoundaries: [...boundaries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
    passThroughComponents: [...traversed.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
    unresolvedPinLinks, netsByBoard };
}
