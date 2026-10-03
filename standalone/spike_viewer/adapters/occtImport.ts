// SPDX-License-Identifier: Apache-2.0
import type { AssemblyMesh } from "../src/assembly/types";
import { ASSEMBLY_LIMITS } from "../src/assembly/validation";
import type { OcctImportResult } from "occt-import-js";

export type OcctFormat = "step" | "iges";

const OCCT_TIMEOUT_MS = 30_000;
const OCCT_WORKER_PATH = "vendor/occt-import-js/occt-import-worker.js";

type WorkerReply = { ok: true; result: OcctImportResult } | { ok: false; error: string };

function abortError(): DOMException {
  return new DOMException("The import was cancelled.", "AbortError");
}

function asFiniteNumbers(values: ArrayLike<number> | undefined, label: string): number[] {
  if (!values) throw new Error(`OCCT did not return ${label}.`);
  const output = Array.from(values, Number);
  if (output.some(value => !Number.isFinite(value))) throw new Error(`OCCT returned invalid ${label}.`);
  return output;
}

function optionalColor(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const color = value.map(Number) as [number, number, number];
  return color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1) ? color : undefined;
}

export function normalizeOcctResult(result: OcctImportResult, fallbackName: string): AssemblyMesh[] {
  if (!result?.success || !Array.isArray(result.meshes)) throw new Error("OCCT could not read this CAD file.");
  if (!result.meshes.length) throw new Error("The CAD file contains no tessellated solids or surfaces.");
  if (result.meshes.length > 2_000) throw new Error("The CAD file contains too many meshes.");
  let vertexCount = 0;
  let triangleCount = 0;
  return result.meshes.map((mesh, meshIndex) => {
    const positions = asFiniteNumbers(mesh.attributes?.position?.array, "vertex positions");
    const indices = asFiniteNumbers(mesh.index?.array, "triangle indices");
    if (!positions.length || positions.length % 3 || !indices.length || indices.length % 3) {
      throw new Error("OCCT returned incomplete triangle geometry.");
    }
    const vertices = positions.length / 3;
    if (indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= vertices)) {
      throw new Error("OCCT returned an index outside its vertex array.");
    }
    vertexCount += vertices;
    triangleCount += indices.length / 3;
    if (vertexCount > ASSEMBLY_LIMITS.vertices || triangleCount > ASSEMBLY_LIMITS.triangles) {
      throw new Error(`CAD geometry exceeds ${ASSEMBLY_LIMITS.vertices.toLocaleString()} vertices or ${ASSEMBLY_LIMITS.triangles.toLocaleString()} triangles.`);
    }
    const normals = mesh.attributes?.normal?.array
      ? asFiniteNumbers(mesh.attributes.normal.array, "vertex normals")
      : undefined;
    if (normals && normals.length !== positions.length) throw new Error("OCCT returned a mismatched normal array.");
    const faces = mesh.brep_faces?.map(face => ({
      first: Number(face.first),
      last: Number(face.last),
      color: optionalColor(face.color),
    }));
    if (faces?.some(face => !Number.isSafeInteger(face.first) || !Number.isSafeInteger(face.last)
      || face.first < 0 || face.last < face.first || face.last >= indices.length / 3)) {
      throw new Error("OCCT returned an invalid B-rep face triangle range.");
    }
    return {
      id: crypto.randomUUID(),
      name: mesh.name?.trim() || `${fallbackName} ${meshIndex + 1}`,
      positions,
      indices,
      normals,
      color: optionalColor(mesh.color),
      faces,
    };
  });
}

async function importInProcess(bytes: Uint8Array, format: OcctFormat): Promise<OcctImportResult> {
  const { default: createOcct } = await import("occt-import-js");
  const occt = await createOcct();
  const params = { linearUnit: "millimeter" };
  return format === "step" ? occt.ReadStepFile(bytes, params) : occt.ReadIgesFile(bytes, params);
}

function workerUrl(): string {
  if (typeof document === "undefined") throw new Error("A document base URL is required for the OCCT worker.");
  return new URL(OCCT_WORKER_PATH, document.baseURI).href;
}

async function importInWorker(bytes: Uint8Array, format: OcctFormat, signal?: AbortSignal): Promise<OcctImportResult> {
  if (signal?.aborted) throw abortError();
  const worker = new Worker(workerUrl());
  return new Promise<OcctImportResult>((resolve, reject) => {
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error(`CAD tessellation exceeded ${OCCT_TIMEOUT_MS / 1000} seconds.`))), OCCT_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = event => finish(() => reject(new Error(event.message || "The OCCT worker failed.")));
    worker.onmessage = (event: MessageEvent<WorkerReply>) => finish(() => {
      if (event.data?.ok) resolve(event.data.result);
      else reject(new Error(event.data?.error || "The OCCT worker failed."));
    });
    const transfer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    worker.postMessage({ format, buffer: transfer }, [transfer]);
  });
}

export async function importOcct(bytes: Uint8Array, format: OcctFormat, signal?: AbortSignal): Promise<OcctImportResult> {
  if (signal?.aborted) throw abortError();
  if (typeof Worker !== "undefined" && typeof document !== "undefined") return importInWorker(bytes, format, signal);
  // Node/test fallback. Browser imports always use the terminable worker above.
  const result = await importInProcess(bytes, format);
  if (signal?.aborted) throw abortError();
  return result;
}
