import type { AssemblyIr } from "./mcadAssembly";

export type GraphConnector = {
  key: string;
  boardId: string;
  connectorId: string;
  pins: Record<string, string>;
  positionMm: [number, number, number] | null;
  assemblyPositionMm: [number, number, number] | null;
  discovered: boolean;
};

export type GraphLink = { id: string; kind: "harness" | "mate"; endpointA: string; endpointB: string; pinMap: Record<string, string> };
export type PairSuggestion = { endpointA: string; endpointB: string; pinMap: Record<string, string>; netNames: string[] };

function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function endpoint(value: unknown): string {
  const raw = stringValue(value);
  return raw.includes("::") ? raw : raw.includes(":") ? raw.replace(":", "::") : raw;
}
function pinMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([a, b]) => a.trim() && typeof b === "string" && b.trim())) as Record<string, string>;
}
function connectorPins(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([pin, net]) => pin.trim() && typeof net === "string")) as Record<string, string>;
}

export function graphConnectors(raw: unknown, assembly: AssemblyIr): GraphConnector[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const boards = new Set(assembly.boards.map(board => stringValue(board.id)));
  return Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const boardId = stringValue(row.board_id);
    const connectorId = stringValue(row.connector_id);
    if (!boards.has(boardId) || !connectorId || key !== `${boardId}::${connectorId}`) return [];
    const position = row.assembly_position_mm;
    const local = row.position_mm;
    const positionMm: GraphConnector["positionMm"] = Array.isArray(local) && local.length === 3
      && local.every(n => typeof n === "number" && Number.isFinite(n)) ? [local[0], local[1], local[2]] : null;
    const assemblyPositionMm: GraphConnector["assemblyPositionMm"] = Array.isArray(position) && position.length === 3
      && position.every(n => typeof n === "number" && Number.isFinite(n)) ? [position[0], position[1], position[2]] : null;
    return [{ key, boardId, connectorId, pins: connectorPins(row.pins), positionMm, assemblyPositionMm, discovered: row.discovered === true }];
  }).sort((a, b) => a.boardId.localeCompare(b.boardId) || a.connectorId.localeCompare(b.connectorId));
}

export function graphLinks(assembly: AssemblyIr): GraphLink[] {
  const harnesses = (assembly.harnesses ?? []).flatMap(row => {
    const a = endpoint(row.endpoint_a), b = endpoint(row.endpoint_b);
    return a && b ? [{ id: stringValue(row.id), kind: "harness" as const, endpointA: a, endpointB: b, pinMap: pinMap(row.pin_map) }] : [];
  });
  const mates = (assembly.connector_mappings ?? []).flatMap(row => {
    if (row.kind !== "connector-mate" || !row.data || typeof row.data !== "object" || Array.isArray(row.data)) return [];
    const data = row.data as Record<string, unknown>;
    const a = endpoint(data.endpoint_a), b = endpoint(data.endpoint_b);
    return a && b ? [{ id: stringValue(row.id), kind: "mate" as const, endpointA: a, endpointB: b, pinMap: pinMap(data.pin_map) }] : [];
  });
  return [...harnesses, ...mates];
}

export function suggestedPairs(connectors: GraphConnector[], links: GraphLink[]): PairSuggestion[] {
  const occupied = new Set<string>();
  for (const link of links) for (const [a, b] of Object.entries(link.pinMap)) {
    occupied.add(`${link.endpointA}\u0000${a}`);
    occupied.add(`${link.endpointB}\u0000${b}`);
  }
  const byNet = new Map<string, Array<{ connector: GraphConnector; pin: string }>>();
  for (const connector of connectors) for (const [pin, rawNet] of Object.entries(connector.pins)) {
    const net = rawNet.trim();
    if (!net || occupied.has(`${connector.key}\u0000${pin}`)) continue;
    byNet.set(net, [...(byNet.get(net) ?? []), { connector, pin }]);
  }
  const pairs = new Map<string, PairSuggestion>();
  for (const [net, ends] of byNet) {
    if (ends.length !== 2 || ends[0].connector.boardId === ends[1].connector.boardId) continue;
    const [a, b] = ends[0].connector.key < ends[1].connector.key ? ends : [ends[1], ends[0]];
    const key = `${a.connector.key}\u0000${b.connector.key}`;
    const existing = pairs.get(key) ?? { endpointA: a.connector.key, endpointB: b.connector.key, pinMap: {}, netNames: [] };
    existing.pinMap[a.pin] = b.pin;
    existing.netNames.push(net);
    pairs.set(key, existing);
  }
  return [...pairs.values()].sort((a, b) => b.netNames.length - a.netNames.length || a.endpointA.localeCompare(b.endpointA));
}

export function ambiguousNets(connectors: GraphConnector[], links: GraphLink[]): Array<{ name: string; count: number }> {
  const occupied = new Set<string>();
  for (const link of links) for (const [a, b] of Object.entries(link.pinMap)) {
    occupied.add(`${link.endpointA}\u0000${a}`); occupied.add(`${link.endpointB}\u0000${b}`);
  }
  const counts = new Map<string, number>();
  for (const connector of connectors) for (const [pin, rawNet] of Object.entries(connector.pins)) {
    const net = rawNet.trim();
    if (net && !occupied.has(`${connector.key}\u0000${pin}`)) counts.set(net, (counts.get(net) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 2).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function suggestionForPair(suggestions: PairSuggestion[], a: string, b: string): Record<string, string> {
  const direct = suggestions.find(pair => pair.endpointA === a && pair.endpointB === b);
  if (direct) return { ...direct.pinMap };
  const reverse = suggestions.find(pair => pair.endpointA === b && pair.endpointB === a);
  return reverse ? Object.fromEntries(Object.entries(reverse.pinMap).map(([source, target]) => [target, source])) : {};
}
