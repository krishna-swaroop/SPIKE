// SPDX-License-Identifier: Apache-2.0
import type { AssemblyAsset, BoardAsset, MechanicalAsset } from "../src/assembly/types";
import { validateAssemblyAsset } from "../src/assembly/validation";
import { parseKicad } from "./kicadImport";
import { importMesh, type MeshFormat, type MeshUnit } from "./meshImport";
import { importOcct, normalizeOcctResult, type OcctFormat } from "./occtImport";

export type ImportAssemblyFileOptions = {
  signal?: AbortSignal;
  /** Source units for STL and OBJ. GLB always follows its specification's metre unit. */
  meshUnit?: MeshUnit;
};

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_KICAD_BYTES = 16 * 1024 * 1024;

function abortError(): DOMException {
  return new DOMException("The import was cancelled.", "AbortError");
}

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9_]+)$/);
  return match?.[1] ?? "";
}

function displayName(fileName: string): string {
  const leaf = fileName.replace(/\\/g, "/").split("/").pop() || "Imported asset";
  return leaf.replace(/\.[^.]+$/, "").trim().slice(0, 1_000) || "Imported asset";
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function defaultMeshUnit(): MeshUnit { return "mm"; }

async function importBoard(file: File, bytes: Uint8Array, signal?: AbortSignal): Promise<BoardAsset> {
  if (bytes.byteLength > MAX_KICAD_BYTES) throw new Error("KiCad PCB files are limited to 16 MiB.");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The KiCad PCB file is not valid UTF-8 text.");
  }
  const board = await parseKicad(source, signal);
  if (signal?.aborted) throw abortError();
  const id = crypto.randomUUID();
  const asset: BoardAsset = {
    id,
    kind: "board",
    name: displayName(file.name),
    board,
    binding: { boardId: id, revision: await sha256(bytes) },
    source: {
      fileName: file.name,
      format: "kicad_pcb",
      notes: ["KiCad board coordinates are millimetres; native model paths are retained only as inert provenance."],
    },
  };
  return validateAssemblyAsset(asset) as BoardAsset;
}

async function importMechanical(
  file: File,
  bytes: Uint8Array,
  format: OcctFormat | MeshFormat,
  options: ImportAssemblyFileOptions,
): Promise<MechanicalAsset> {
  const name = displayName(file.name);
  const isOcct = format === "step" || format === "iges";
  const unit = isOcct ? "mm" : format === "glb" ? "m" : options.meshUnit ?? defaultMeshUnit();
  const meshes = isOcct
    ? normalizeOcctResult(await importOcct(bytes, format, options.signal), name)
    : await importMesh(bytes, format, unit as MeshUnit, name);
  if (options.signal?.aborted) throw abortError();
  const asset: MechanicalAsset = {
    id: crypto.randomUUID(),
    kind: "mechanical",
    name,
    meshes,
    source: {
      fileName: file.name,
      format,
      unit: "mm",
      notes: isOcct
        ? ["OCCT converted the source document length units to millimetres and returned a display tessellation; B-rep editing data is not retained."]
        : [`Input coordinates were interpreted as ${unit} and converted to millimetres.`, "Imported geometry is a display mesh; solid/B-rep editing data is not retained."],
    },
  };
  return validateAssemblyAsset(asset) as MechanicalAsset;
}

/**
 * Imports one user-selected local file into the portable assembly contract.
 * The adapter never follows model URLs or external GLB/OBJ resources.
 */
export async function importAssemblyFile(file: File, options: ImportAssemblyFileOptions = {}): Promise<AssemblyAsset> {
  if (!(file instanceof File)) throw new TypeError("Expected a browser File object.");
  if (options.signal?.aborted) throw abortError();
  if (file.size <= 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Import files are limited to 64 MiB.");
  const extension = extensionOf(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (options.signal?.aborted) throw abortError();
  if (extension === "kicad_pcb") return importBoard(file, bytes, options.signal);
  if (extension === "step" || extension === "stp") return importMechanical(file, bytes, "step", options);
  if (extension === "iges" || extension === "igs") return importMechanical(file, bytes, "iges", options);
  if (extension === "glb" || extension === "stl" || extension === "obj") return importMechanical(file, bytes, extension, options);
  throw new Error("Unsupported file type. Choose .kicad_pcb, .step/.stp, .iges/.igs, .glb, .stl, or .obj.");
}
