// SPDX-License-Identifier: Apache-2.0
import type { BoardBinding, VirtualLayer } from "./types";

export const VIRTUAL_DATA_LIMITS = Object.freeze({ layers: 32, frames: 256, primitives: 2048, vertices: 50000, triangles: 100000, labels: 1000, jsonBytes: 16 * 1024 * 1024 });
export class VirtualDataError extends Error {
  constructor(public readonly path: string, message: string) { super(`${path}: ${message}`); this.name = "VirtualDataError"; }
}
const fail = (path: string, message: string): never => { throw new VirtualDataError(path, message); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected an array with at most ${max} entries`);
  return value as unknown[];
}
function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > 1000) fail(path, "expected text (1-1000 characters)");
  return value as string;
}
function finite(value: unknown, path: string, min = -1e12, max = 1e12): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(path, `expected a finite number in [${min}, ${max}]`);
  return value as number;
}
function unique(value: unknown, seen: Set<string>, path: string) {
  const id = string(value, path);
  if (seen.has(id)) fail(path, `duplicate ID ${id}`);
  seen.add(id);
}
function vector(value: unknown, path: string, max = 1e7) {
  const values = array(value, path, 3);
  if (values.length !== 3) fail(path, "expected three coordinates");
  values.forEach((v, i) => finite(v, `${path}[${i}]`, -max, max));
}
/** Fail closed before allocating scene/DOM resources. Limits cover all frames together. */
export function validateVirtualLayers(input: unknown, binding: BoardBinding): VirtualLayer[] {
  string(binding.boardId, "binding.boardId"); string(binding.revision, "binding.revision");
  const layers = array(input, "layers", VIRTUAL_DATA_LIMITS.layers);
  const ids = new Set<string>();
  let vertices = 0, triangles = 0, labels = 0, primitives = 0, frames = 0;
  layers.forEach((raw, li) => {
    const path = `layers[${li}]`, layer = object(raw, path);
    if (layer.schema !== "spike-viewer/virtual-layer/v1") fail(path, "unsupported schema");
    unique(layer.id, ids, `${path}.id`);
    for (const key of ["label", "quantity", "unit"]) string(layer[key], `${path}.${key}`, key === "unit");
    const b = object(layer.binding, `${path}.binding`);
    if (b.boardId !== binding.boardId || b.revision !== binding.revision) fail(`${path}.binding`, "board identity/revision mismatch; explicitly rebind or reload matching data");
    const provenance = object(layer.provenance, `${path}.provenance`);
    string(provenance.source, `${path}.provenance.source`);
    if (!["synthetic", "measured", "simulated", "approximate", "unvalidated", "validated"].includes(provenance.status as string)) fail(path, "unknown provenance status");
    if (provenance.notes !== undefined) string(provenance.notes, `${path}.provenance.notes`, true);
    if (typeof layer.visible !== "boolean") fail(path, "visible must be boolean");
    finite(layer.opacity, `${path}.opacity`, 0, 1);
    if (layer.range !== undefined) {
      const r = array(layer.range, `${path}.range`, 2);
      if (r.length !== 2 || finite(r[0], path) > finite(r[1], path)) fail(path, "range must be [minimum, maximum]");
    }
    const frameIds = new Set<string>(), fs = array(layer.frames, `${path}.frames`, VIRTUAL_DATA_LIMITS.frames);
    if (!fs.length) fail(path, "at least one frame is required");
    frames += fs.length;
    if (frames > VIRTUAL_DATA_LIMITS.frames) fail(path, "aggregate frame budget exceeded");
    fs.forEach((rawFrame, fi) => {
      const fp = `${path}.frames[${fi}]`, frame = object(rawFrame, fp);
      unique(frame.id, frameIds, `${fp}.id`); string(frame.label, `${fp}.label`);
      if (frame.timeSeconds !== undefined) finite(frame.timeSeconds, `${fp}.timeSeconds`, 0);
      if (frame.frequencyHz !== undefined) finite(frame.frequencyHz, `${fp}.frequencyHz`, 0);
      const primitiveIds = new Set<string>();
      const ps = array(frame.primitives, `${fp}.primitives`, VIRTUAL_DATA_LIMITS.primitives);
      primitives += ps.length;
      if (primitives > VIRTUAL_DATA_LIMITS.primitives) fail(fp, "aggregate primitive budget exceeded");
      ps.forEach((rawPrimitive, pi) => {
        const pp = `${fp}.primitives[${pi}]`, p = object(rawPrimitive, pp);
        unique(p.id, primitiveIds, `${pp}.id`);
        if (!["points", "vectors", "surface", "path", "labels"].includes(p.kind as string)) fail(pp, "unsupported primitive kind");
        if (p.color !== undefined && (typeof p.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(p.color))) fail(pp, "color must be #RRGGBB");
        const positions = array(p.positionsMm, `${pp}.positionsMm`, VIRTUAL_DATA_LIMITS.vertices);
        vertices += positions.length;
        if (vertices > VIRTUAL_DATA_LIMITS.vertices) fail(pp, "aggregate vertex budget exceeded");
        positions.forEach((v, vi) => vector(v, `${pp}.positionsMm[${vi}]`));
        if (p.values !== undefined) {
          if (!["points", "vectors", "surface"].includes(p.kind as string)) fail(pp, "values require points, vectors or surface");
          const values = array(p.values, `${pp}.values`, VIRTUAL_DATA_LIMITS.vertices);
          if (values.length !== positions.length) fail(pp, "one value per position is required");
          values.forEach((v, i) => { if (v !== null) finite(v, `${pp}.values[${i}]`); });
        }
        if (p.kind === "points" && p.radiusMm !== undefined) finite(p.radiusMm, `${pp}.radiusMm`, .001, 1e4);
        if (p.kind === "path") {
          if (p.widthMm !== undefined) finite(p.widthMm, `${pp}.widthMm`, .001, 1e4);
          if (p.closed !== undefined && typeof p.closed !== "boolean") fail(pp, "closed must be boolean");
        }
        if (p.kind === "vectors") {
          finite(p.displayScaleMm, `${pp}.displayScaleMm`, 1e-12, 1e6);
          const vs = array(p.vectors, `${pp}.vectors`, VIRTUAL_DATA_LIMITS.vertices);
          if (vs.length !== positions.length) fail(pp, "one vector per position is required");
          vs.forEach((v, i) => vector(v, `${pp}.vectors[${i}]`));
        }
        if (p.kind === "surface") {
          const faces = array(p.triangles, `${pp}.triangles`, VIRTUAL_DATA_LIMITS.triangles);
          triangles += faces.length;
          if (triangles > VIRTUAL_DATA_LIMITS.triangles) fail(pp, "aggregate triangle budget exceeded");
          faces.forEach((face, i) => {
            const indexes = array(face, `${pp}.triangles[${i}]`, 3);
            if (indexes.length !== 3 || new Set(indexes).size !== 3 || indexes.some(index => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= positions.length)) fail(pp, "triangle requires three distinct in-range vertex indices");
          });
        }
        if (p.kind === "labels") {
          const texts = array(p.labels, `${pp}.labels`, VIRTUAL_DATA_LIMITS.labels);
          labels += texts.length;
          if (texts.length !== positions.length || labels > VIRTUAL_DATA_LIMITS.labels) fail(pp, "labels must match positions and fit aggregate label budget");
          texts.forEach((t, i) => string(t, `${pp}.labels[${i}]`));
        }
      });
    });
  });
  return input as VirtualLayer[];
}

export function parseVirtualLayers(json: string, binding: BoardBinding): VirtualLayer[] {
  if (json.length > VIRTUAL_DATA_LIMITS.jsonBytes || new TextEncoder().encode(json).byteLength > VIRTUAL_DATA_LIMITS.jsonBytes) fail("json", "virtual data file exceeds 16 MiB");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail("json", "invalid JSON"); }
  return validateVirtualLayers(Array.isArray(parsed) ? parsed : [parsed], binding);
}
