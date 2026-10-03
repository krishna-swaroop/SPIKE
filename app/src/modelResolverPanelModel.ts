// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard, ParsedComponent } from "./boardParser";

export type ResolverBoard = { id: string; name: string; board: ParsedBoard };

export type ModelCandidate = {
  path: string;
  name: string;
  format?: string;
  root?: string;
  reason?: string;
  confidence?: number;
  exact?: boolean;
};

export function componentModelPaths(component: ParsedComponent): string[] {
  const paths = component.models?.map(model => model.path)
    ?? component.modelPaths
    ?? (component.modelPath ? [component.modelPath] : []);
  return paths.filter((path, index) => Boolean(path) && paths.indexOf(path) === index);
}

export function componentNeedsModel(component: ParsedComponent): boolean {
  const paths = componentModelPaths(component);
  return paths.length === 0 || paths.some(path => !component.modelUrl && !/^https?:|^blob:|^data:/i.test(path));
}

export function resolverComponents(board: ParsedBoard): ParsedComponent[] {
  return [...board.components].sort((left, right) => {
    const missing = Number(componentNeedsModel(right)) - Number(componentNeedsModel(left));
    return missing || left.ref.localeCompare(right.ref, undefined, { numeric: true });
  });
}

export function parseModelCandidates(value: unknown): ModelCandidate[] {
  const source = Array.isArray(value) ? value : [];
  return source.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path : "";
    if (!path) return [];
    return [{
      path,
      name: typeof row.name === "string" && row.name ? row.name : path.replace(/\\/g, "/").split("/").pop() || path,
      format: typeof row.format === "string" ? row.format : undefined,
      root: typeof row.root === "string" ? row.root : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      exact: typeof row.exact === "boolean" ? row.exact : undefined,
    }];
  });
}

export function parseModelLibraryResult(value: unknown): { candidates: ModelCandidate[]; count?: number; roots?: unknown[]; indexedAt?: string } {
  if (Array.isArray(value)) return { candidates: parseModelCandidates(value) };
  if (!value || typeof value !== "object") return { candidates: [] };
  const row = value as Record<string, unknown>;
  const index = row.index && typeof row.index === "object" ? row.index as Record<string, unknown> : {};
  const models = Array.isArray(row.models) ? row.models : Array.isArray(row.entries) ? row.entries : Array.isArray(row.items) ? row.items : [];
  const rawCount = row.count ?? row.asset_count ?? row.model_count ?? index.count ?? index.asset_count ?? index.model_count;
  const rawRoots = row.roots ?? index.roots;
  const rawIndexedAt = row.indexed_at ?? row.index_updated_at ?? index.indexed_at ?? index.updated_at;
  return {
    candidates: parseModelCandidates(models),
    count: typeof rawCount === "number" ? rawCount : undefined,
    roots: Array.isArray(rawRoots) ? rawRoots : undefined,
    indexedAt: typeof rawIndexedAt === "string" ? rawIndexedAt : undefined,
  };
}

export function workerError(response: unknown, fallback: string): string | null {
  if (!response || typeof response !== "object") return fallback;
  const row = response as Record<string, unknown>;
  return row.ok === true ? null : typeof row.error === "string" ? row.error : fallback;
}

export function candidateCanOverride(candidate: Pick<ModelCandidate, "path" | "format">): boolean {
  const format = candidate.format?.toLowerCase().replace(/^\./, "");
  if (format) return ["step", "stp", "wrl", "vrml"].includes(format);
  return /\.(?:step|stp|wrl|vrml)$/i.test(candidate.path);
}
