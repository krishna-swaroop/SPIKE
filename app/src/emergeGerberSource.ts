// SPDX-License-Identifier: Apache-2.0
/** Native Gerber source setup. Copper parsing stays in the EMerge runtime. */
export type GerberFile = { file_name: string; content: string };
export type EMergeGerberSource = {
  contract: "spike/emerge-gerber-source/v1"; name: string;
  bounds_mm: [number, number, number, number];
  layers: (GerberFile & { name: string })[];
  dielectrics: { thickness_mm: number; epsilon_r: number; loss_tangent: number }[];
  ports: { id: string; x_mm: number; y_mm: number; width_mm: number; signal_layer: string; return_layer: string }[];
  resolution_mm: number; drills?: GerberFile[];
};
export type GerberDraft = {
  name: string; bounds: [string, string, string, string]; resolution: string;
  layers: GerberFile[]; dielectrics: { thickness: string; epsilon: string; loss: string }[];
  ports: { x: string; y: string; width: string; signal: number }[]; drills: GerberFile[];
};
export const GERBER_FILE_BYTES = 512 * 1024, GERBER_TOTAL_BYTES = 2 * 1024 * 1024;
export const copperName = (index: number, count: number) => index === 0 ? "F.Cu" : index === count - 1 ? "B.Cu" : `In${index}.Cu`;
export function newGerberDraft(): GerberDraft {
  return { name: "Gerber RF study", bounds: ["0", "0", "20", "20"], resolution: "0.01",
    layers: [{ file_name: "", content: "" }, { file_name: "", content: "" }],
    dielectrics: [{ thickness: "1.6", epsilon: "4.2", loss: "0" }],
    ports: [{ x: "5", y: "5", width: "1", signal: 0 }], drills: [] };
}
function finite(value: unknown, name: string, low = -1e6, high = 1e6): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`);
  return value;
}
export function validateGerberSource(value: unknown): EMergeGerberSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a native Gerber source package.");
  const source = value as EMergeGerberSource;
  if (source.contract !== "spike/emerge-gerber-source/v1") throw new Error("Unsupported Gerber source format.");
  if (typeof source.name !== "string" || !source.name.trim() || source.name.length > 128) throw new Error("Enter a study name of up to 128 characters.");
  if (!Array.isArray(source.bounds_mm) || source.bounds_mm.length !== 4) throw new Error("Enter all four board bounds in millimetres.");
  source.bounds_mm.forEach((value, index) => finite(value, `Board bound ${index + 1}`));
  const [xmin, ymin, xmax, ymax] = source.bounds_mm;
  if (xmax <= xmin || ymax <= ymin || (xmax - xmin) * (ymax - ymin) > 40000) throw new Error("Board bounds must enclose a positive area of at most 40,000 mm².");
  if (!Array.isArray(source.layers) || source.layers.length < 2 || source.layers.length > 8) throw new Error("Choose two to eight ordered copper files.");
  if (!Array.isArray(source.dielectrics) || source.dielectrics.length !== source.layers.length - 1) throw new Error("Define a dielectric for every adjacent copper layer pair.");
  if (source.drills !== undefined && !Array.isArray(source.drills)) throw new Error("Drill sources must be an array.");
  const files = [...source.layers, ...(source.drills ?? [])];
  if (files.length > 8) throw new Error("The source package supports at most eight files including drills.");
  let bytes = 0;
  for (const file of files) {
    if (!file || typeof file.file_name !== "string" || !file.file_name || file.file_name.length > 160 || file.file_name !== file.file_name.trim() || /[<>:"\\/|?*\x00-\x1f\x7f]/.test(file.file_name) || file.file_name.endsWith(".") || /^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])$/i.test(file.file_name.split(".")[0].trimEnd())) throw new Error("Source files require a portable plain filename of up to 160 characters.");
    if (typeof file.content !== "string" || !file.content.trim()) throw new Error(`Choose a source for ${file.file_name || "each layer"}.`);
    const length = new TextEncoder().encode(file.content).length;
    if (length > GERBER_FILE_BYTES) throw new Error(`${file.file_name} exceeds the 512 KiB file limit.`);
    bytes += length;
  }
  if (bytes > GERBER_TOTAL_BYTES) throw new Error("Gerber sources exceed the 2 MiB aggregate limit.");
  if (new Set(files.map(file => file.file_name.toLowerCase())).size !== files.length) throw new Error("Gerber and drill filenames must be unique.");
  source.layers.forEach((layer, index) => { if (layer.name !== copperName(index, source.layers.length)) throw new Error("Copper files must follow the declared top-to-bottom layer order."); });
  source.dielectrics.forEach((gap, index) => {
    if (!gap || typeof gap !== "object") throw new Error("Invalid dielectric entry.");
    finite(gap.thickness_mm, `Dielectric ${index + 1} thickness`, .01, 10);
    finite(gap.epsilon_r, `Dielectric ${index + 1} permittivity`, 1.01, 30);
    finite(gap.loss_tangent, `Dielectric ${index + 1} loss tangent`, 0, 1);
  });
  if (source.dielectrics.reduce((sum, gap) => sum + gap.thickness_mm, 0) > 10) throw new Error("Total dielectric thickness must not exceed 10 mm.");
  finite(source.resolution_mm, "Gerber sampling resolution", .001, 1);
  if (!Array.isArray(source.ports) || source.ports.length < 1 || source.ports.length > 2) throw new Error("Define one or two explicit port planes.");
  source.ports.forEach((port, index) => {
    if (!port || port.id !== `P${index + 1}`) throw new Error("Ports must be ordered P1 then P2.");
    const signal = source.layers.findIndex(layer => layer.name === port.signal_layer);
    if (signal < 0 || signal === source.layers.length - 1 || port.return_layer !== source.layers[signal + 1].name) throw new Error("Each port spans adjacent layers with signal above return.");
    finite(port.x_mm, `${port.id} X`, xmin, xmax); finite(port.y_mm, `${port.id} Y`, ymin, ymax);
    finite(port.width_mm, `${port.id} width`, .01, xmax - xmin);
    if (port.x_mm - port.width_mm / 2 < xmin || port.x_mm + port.width_mm / 2 > xmax) throw new Error(`${port.id} plane must fit within the board bounds.`);
  });
  if (source.ports.length === 2) {
    const [a, b] = source.ports;
    if (a.x_mm === b.x_mm && a.y_mm === b.y_mm && a.signal_layer === b.signal_layer && a.return_layer === b.return_layer) throw new Error("The two port planes must have distinct locations or layer pairs.");
  }
  return structuredClone(source);
}
export function gerberSourceFromDraft(draft: GerberDraft): EMergeGerberSource {
  const numeric = (value: string) => value.trim() ? Number(value) : NaN;
  return validateGerberSource({ contract: "spike/emerge-gerber-source/v1", name: draft.name,
    bounds_mm: draft.bounds.map(numeric), resolution_mm: numeric(draft.resolution),
    layers: draft.layers.map((file, index) => ({ ...file, name: copperName(index, draft.layers.length) })),
    dielectrics: draft.dielectrics.map(gap => ({ thickness_mm: numeric(gap.thickness), epsilon_r: numeric(gap.epsilon), loss_tangent: numeric(gap.loss) })),
    ports: draft.ports.map((port, index) => ({ id: `P${index + 1}`, x_mm: numeric(port.x), y_mm: numeric(port.y), width_mm: numeric(port.width),
      signal_layer: copperName(port.signal, draft.layers.length), return_layer: copperName(port.signal + 1, draft.layers.length) })),
    drills: draft.drills });
}
export function gerberDraftFromSource(value: unknown): GerberDraft {
  const source = validateGerberSource(value);
  return { name: source.name, bounds: source.bounds_mm.map(String) as GerberDraft["bounds"], resolution: String(source.resolution_mm),
    layers: source.layers.map(({ file_name, content }) => ({ file_name, content })),
    dielectrics: source.dielectrics.map(gap => ({ thickness: String(gap.thickness_mm), epsilon: String(gap.epsilon_r), loss: String(gap.loss_tangent) })),
    ports: source.ports.map(port => ({ x: String(port.x_mm), y: String(port.y_mm), width: String(port.width_mm), signal: source.layers.findIndex(layer => layer.name === port.signal_layer) })),
    drills: source.drills ?? [] };
}
/** Read only the declared native source, never infer Gerber from a filename. */
export function activeGerberSource(boardSource: string, stackup?: { name: string; type?: string; thickness?: number; thickness_mm?: number; epsilon_r?: number; loss_tangent?: number }[]): EMergeGerberSource | null {
  if (!boardSource.trimStart().startsWith("{")) return null;
  try { const snapshot = JSON.parse(boardSource); if (snapshot.contract !== "spike/design-snapshot/v1" || snapshot.design?.source_format !== "emerge-gerber") return null;
    const source = validateGerberSource(snapshot.design.metadata?.emerge_gerber_source ?? snapshot.canonical_design?.metadata?.emerge_gerber_source);
    if (stackup) {
      const gaps = stackup.filter(layer => !layer.name.endsWith(".Cu") && ["core", "prepreg", "dielectric"].includes(layer.type ?? ""));
      if (gaps.length !== source.dielectrics.length) throw new Error("Current dielectric stack does not match the Gerber source.");
      source.dielectrics = gaps.map(layer => ({ thickness_mm: layer.thickness ?? layer.thickness_mm ?? NaN, epsilon_r: layer.epsilon_r ?? NaN, loss_tangent: layer.loss_tangent ?? 0 }));
    }
    return validateGerberSource(source);
  } catch { return null; }
}
