// SPDX-License-Identifier: Apache-2.0
/** File routing only; CAD geometry and validation remain in registered importers. */
export type ImportSourceKind = "kicad" | "normalized" | "odb++" | "ipc2581" | "harness" | "mcad";
export type OpenSourceKind = ImportSourceKind | "project" | "results" | "unknown";

export function classifyOpenSource(name: string, document?: Record<string, unknown>): OpenSourceKind {
  const lower = name.toLowerCase();
  if (document) {
    if (String(document.contract ?? "").startsWith("spike/result-package/")) return "results";
    if (String(document.contract ?? "").startsWith("spike/project/")) return "project";
    if (document.contract === "spike/design-snapshot/v1") return "normalized";
    if (document.contract === "spike/harness/v1") return "harness";
    if (String(document.format ?? "").startsWith("spike-project-package/")) return "project";
    if (String(document.format ?? "").startsWith("spike-results-package/")) return "results";
    return "unknown";
  }
  if (lower.endsWith(".spike-results.json")) return "results";
  if (/\.(spike|spike\.json)$/.test(lower)) return "project";
  if (lower.endsWith(".spike-design.json")) return "normalized";
  if (/\.(spike-harness\.json|csv|tsv)$/.test(lower)) return "harness";
  if (lower.endsWith(".kicad_pcb")) return "kicad";
  if (/\.(step|stp|glb|gltf)$/.test(lower)) return "mcad";
  if (/\.(ipc|ipc2581|xml)$/.test(lower)) return "ipc2581";
  if (/\.(odb|odb\+\+|zip|tgz|tar|tar\.gz)$/.test(lower)) return "odb++";
  return "unknown";
}

export type PreparedSource =
  | { kind: "board"; fileName: string; source: string; sourcePath?: string; report?: unknown }
  | { kind: "harness"; document: Record<string, unknown> }
  | { kind: "mcad"; path: string; fileName: string };

export const HARNESS_COLUMNS = ["wire_id", "from_connector", "from_pin", "to_connector", "to_pin"] as const;
