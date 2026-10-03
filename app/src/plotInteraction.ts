// SPDX-License-Identifier: Apache-2.0
export type PlotRange = readonly [number, number];
export function zoomPlotRange(range: PlotRange, factor: number, fraction = .5): [number, number] {
  if (!range.every(Number.isFinite) || !Number.isFinite(factor) || factor <= 0) throw new Error("Invalid plot zoom range.");
  const anchor = range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, fraction));
  const result: [number, number] = [anchor + (range[0] - anchor) * factor, anchor + (range[1] - anchor) * factor];
  return result.every(Number.isFinite) && result[0] !== result[1] ? result : [range[0], range[1]];
}
export function panPlotRange(range: PlotRange, fraction: number): [number, number] {
  const shift = (range[1] - range[0]) * fraction;
  const result: [number, number] = [range[0] + shift, range[1] + shift];
  return result.every(Number.isFinite) ? result : [range[0], range[1]];
}
export function wheelPlotFactor(delta: number, mode: number) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 240 : 1);
  return Math.exp(Math.max(-.7, Math.min(.7, pixels * .0015)));
}

// Plotly stores log/category ranges in axis coordinates. Dates need conversion
// to milliseconds; data arrays remain untouched for every interaction.
export type PlotAxis = { range?: readonly (number | string)[]; type?: string; fixedrange?: boolean; autorange?: boolean | string; _offset?: number; _length?: number; _name?: string; side?: string; showgrid?: boolean; showspikes?: boolean; minor?: { showgrid?: boolean } };
type PlotArea = { xaxis: PlotAxis; yaxis: PlotAxis };
type Domain = { x?: number[]; y?: number[] };
type Polar = { domain?: Domain; radialaxis?: PlotAxis; angularaxis?: { rotation?: number; direction?: string }; sector?: number[] };
type Scene = { domain?: Domain; camera?: { eye?: { x: number; y: number; z: number } }; xaxis?: PlotAxis; yaxis?: PlotAxis; zaxis?: PlotAxis };
export type FullPlotLayout = Record<string, unknown> & { _plots?: Record<string, PlotArea>; _size?: { l: number; t: number; w: number; h: number }; xaxis?: PlotAxis; yaxis?: PlotAxis; scene?: Scene };
export type WheelTarget = { kind: "cartesian"; axes: string[]; x: number; y: number } | { kind: "polar"; key: string; axis: "radial" | "angular"; fraction: number } | { kind: "scene"; key: string; axis: "camera" | "x" | "y" | "z" };
export type WheelPreference = "auto" | "both" | "x" | "y" | "z" | "radial" | "angular";
const axisNames = (full: FullPlotLayout) => Object.keys(full).filter(key => /^[xy]axis\d*$/.test(key));
const axisName = (full: FullPlotLayout, axis: PlotAxis) => axis._name ?? axisNames(full).find(key => full[key] === axis);
const numericRange = (axis?: PlotAxis): PlotRange | null => {
  if (!axis?.range || axis.range.length !== 2 || axis.fixedrange) return null;
  const pair = axis.range.map(value => axis.type === "date" && typeof value === "string" ? Date.parse(value) : Number(value));
  return pair.every(Number.isFinite) && pair[0] !== pair[1] ? pair as [number, number] : null;
};
const axisZoom = (axis: PlotAxis, factor: number, fraction: number) => {
  const range = numericRange(axis); if (!range) return null;
  const values = zoomPlotRange(range, factor, fraction);
  if (axis.type !== "date") return values;
  return values.every(value => Math.abs(value) <= 8.64e15) ? values.map(value => new Date(value).toISOString()) : null;
};
const domainBox = (full: FullPlotLayout, domain?: Domain) => {
  const size = full._size; if (!size) return null;
  const x = domain?.x ?? [0, 1], y = domain?.y ?? [0, 1];
  return { left: size.l + x[0] * size.w, top: size.t + (1 - y[1]) * size.h, width: (x[1] - x[0]) * size.w, height: (y[1] - y[0]) * size.h };
};

/** Resolve the hovered subplot and its axis rails, rather than zooming an
 * unrelated primary axis. Blank paper, legends and colorbars keep scrolling. */
export function plotWheelTarget(full: FullPlotLayout, x: number, y: number, preference: WheelPreference = "auto", hint?: string): WheelTarget | null {
  const names = axisNames(full);
  if (preference === "auto" && hint && names.includes(hint) && numericRange(full[hint] as PlotAxis)) return { kind: "cartesian", axes: [hint], x, y };
  const plots = Object.values(full._plots ?? {});
  if (!plots.length && full.xaxis && full.yaxis) plots.push({ xaxis: full.xaxis, yaxis: full.yaxis });
  const interiors = new Set<string>();
  let rail: { name: string; distance: number } | null = null;
  for (const plot of plots) {
    const xa = plot.xaxis, ya = plot.yaxis, left = xa._offset, top = ya._offset, width = xa._length, height = ya._length;
    if (left === undefined || top === undefined || !width || !height) continue;
    const xn = axisName(full, xa), yn = axisName(full, ya);
    const inX = x >= left && x <= left + width, inY = y >= top && y <= top + height;
    if (inX && inY) {
      if (xn && preference !== "y" && preference !== "z" && numericRange(xa)) interiors.add(xn);
      if (yn && preference !== "x" && preference !== "z" && numericRange(ya)) interiors.add(yn);
    }
    if (preference === "auto") {
      const candidates = [{ name: xn, distance: Math.abs(y - (xa.side === "top" ? top : top + height)), outside: inX && !inY, axis: xa },
        { name: yn, distance: Math.abs(x - (ya.side === "right" ? left + width : left)), outside: inY && !inX, axis: ya }];
      for (const candidate of candidates) if (candidate.name && candidate.outside && candidate.distance <= 56 && numericRange(candidate.axis) && (!rail || candidate.distance < rail.distance)) rail = { name: candidate.name, distance: candidate.distance };
    }
  }
  if (interiors.size) return { kind: "cartesian", axes: [...interiors], x, y };
  if (rail) return { kind: "cartesian", axes: [rail.name], x, y };
  for (const key of Object.keys(full).filter(key => /^polar\d*$/.test(key))) {
    const polar = full[key] as Polar, box = domainBox(full, polar.domain); if (!box) continue;
    const radius = Math.min(box.width, box.height) / 2, dx = x - box.left - box.width / 2, dy = box.top + box.height / 2 - y, distance = Math.hypot(dx, dy);
    if (distance > radius + 40) continue;
    const angular = preference === "angular" || (preference === "auto" && (hint === `${key}.angularaxis` || (hint !== `${key}.radialaxis` && distance > radius)));
    if (!angular && !numericRange(polar.radialaxis)) continue;
    const sector = polar.sector ?? [0, 360], direction = polar.angularaxis?.direction === "clockwise" ? -1 : 1;
    const theta = ((Math.atan2(dy, dx) * 180 / Math.PI - (polar.angularaxis?.rotation ?? 0)) * direction % 360 + 360) % 360;
    const midpoint = (sector[0] + sector[1]) / 2, unwrapped = theta + Math.round((midpoint - theta) / 360) * 360;
    return { kind: "polar", key, axis: angular ? "angular" : "radial", fraction: angular ? (unwrapped - sector[0]) / (sector[1] - sector[0] || 360) : distance / radius };
  }
  for (const key of Object.keys(full).filter(key => /^scene\d*$/.test(key))) {
    const scene = full[key] as Scene, box = domainBox(full, scene.domain); if (!box || x < box.left || x > box.left + box.width || y < box.top || y > box.top + box.height) continue;
    const axis = ["x", "y", "z"].includes(preference) ? preference as "x" | "y" | "z" : "camera";
    return axis !== "camera" && !numericRange(scene[`${axis}axis`]) ? null : { kind: "scene", key, axis };
  }
  return null;
}

export function plotZoomChanges(full: FullPlotLayout, factor: number, target?: WheelTarget): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const targets: WheelTarget[] = target ? [target] : [
    { kind: "cartesian", axes: axisNames(full), x: NaN, y: NaN },
    ...Object.keys(full).filter(key => /^polar\d*$/.test(key)).map(key => ({ kind: "polar" as const, key, axis: "radial" as const, fraction: .5 })),
    ...Object.keys(full).filter(key => /^scene\d*$/.test(key)).map(key => ({ kind: "scene" as const, key, axis: "camera" as const })),
  ];
  for (const item of targets) {
    if (item.kind === "cartesian") for (const key of item.axes) {
      const axis = full[key] as PlotAxis, pixel = key.startsWith("x") ? item.x : item.y;
      let fraction = Number.isFinite(pixel) ? (pixel - (axis._offset ?? 0)) / Math.max(1, axis._length ?? 1) : .5;
      if (key.startsWith("y") && Number.isFinite(pixel)) fraction = 1 - fraction;
      const range = axisZoom(axis, factor, fraction); if (range) { changes[`${key}.range`] = range; changes[`${key}.autorange`] = false; }
    }
    if (item.kind === "polar") {
      const polar = full[item.key] as Polar;
      if (item.axis === "radial") {
        const range = axisZoom(polar.radialaxis ?? {}, factor, item.fraction);
        if (range) { changes[`${item.key}.radialaxis.range`] = range; changes[`${item.key}.radialaxis.autorange`] = false; }
      } else {
        const sector = (polar.sector ?? [0, 360]) as [number, number], span = Math.abs(sector[1] - sector[0]);
        changes[`${item.key}.sector`] = zoomPlotRange(sector, Math.min(factor, 360 / (span || 360)), item.fraction);
      }
    }
    if (item.kind === "scene") {
      const scene = full[item.key] as Scene;
      if (item.axis === "camera") {
        const eye = scene.camera?.eye ?? { x: 1.25, y: 1.25, z: 1.25 }, distance = Math.hypot(eye.x, eye.y, eye.z);
        const scale = Math.max(.05, Math.min(100, distance * factor)) / Math.max(distance, .001);
        changes[`${item.key}.camera.eye`] = { x: eye.x * scale, y: eye.y * scale, z: eye.z * scale };
      } else {
        const key = `${item.axis}axis`, range = axisZoom(scene[key as "xaxis"] ?? {}, factor, .5);
        if (range) { changes[`${item.key}.${key}.range`] = range; changes[`${item.key}.${key}.autorange`] = false; }
      }
    }
  }
  return changes;
}

export function plotPanChanges(full: FullPlotLayout, axisName: string, fraction: number): Record<string, unknown> {
  const axis = full[axisName] as PlotAxis, range = numericRange(axis); if (!range) return {};
  const shifted = panPlotRange(range, fraction);
  if (axis.type === "date" && shifted.some(value => Math.abs(value) > 8.64e15)) return {};
  return { [`${axisName}.range`]: axis.type === "date" ? shifted.map(value => new Date(value).toISOString()) : shifted, [`${axisName}.autorange`]: false };
}

export function plotResetChanges(full: FullPlotLayout, original: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of axisNames(full)) {
    const axis = full[key] as PlotAxis, source = original[key] as PlotAxis | undefined, range = numericRange(source) ?? numericRange(axis);
    if (!axis.fixedrange) changes[`${key}.autorange`] = String(source?.autorange).includes("reversed") || range && range[0] > range[1] ? "reversed" : true;
  }
  for (const key of Object.keys(full).filter(key => /^polar\d*$/.test(key))) {
    changes[`${key}.radialaxis.autorange`] = true;
    changes[`${key}.sector`] = (original[key] as Polar | undefined)?.sector ?? [0, 360];
  }
  for (const key of Object.keys(full).filter(key => /^scene\d*$/.test(key))) {
    changes[`${key}.camera`] = (original[key] as Scene | undefined)?.camera ?? { eye: { x: 1.25, y: 1.25, z: 1.25 }, up: { x: 0, y: 0, z: 1 }, center: { x: 0, y: 0, z: 0 } };
    for (const axis of ["xaxis", "yaxis", "zaxis"]) changes[`${key}.${axis}.autorange`] = true;
  }
  return changes;
}
