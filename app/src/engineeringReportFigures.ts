// SPDX-License-Identifier: Apache-2.0
type Point = readonly number[];
type FieldSample = { x_mm: number; y_mm: number; value: number; net?: string; layer?: string };
type ReportGeometry = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  outlineLoops: Point[][];
  tracks: { s: Point; e: Point; w: number }[];
  zones: { p: Point[] }[];
  pads: { p: Point; w: number; h: number; r: number }[];
  vias: { p: Point; d: number; drill: number }[];
  components: { p: Point; w: number; h: number; r: number }[];
  fields: Record<string, FieldSample[]>;
};
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]!);
const coordinate = (value: number) => Number.isFinite(value) ? value.toFixed(3) : "0";

/** A bounded vector figure available before scripts run and in printed reports. */
export function reportBoardFigure(geometry: ReportGeometry | null, field?: { key: string; label: string; unit: string }) {
  if (!geometry) return `<figure class="report-static-figure"><div class="empty-result">No imported board geometry is attached to this report.</div><figcaption>Board visualization unavailable. Returned numerical tables and setup records are retained below.</figcaption></figure>`;
  const { minX, minY, maxX, maxY } = geometry.bounds;
  const width = maxX - minX, height = maxY - minY;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || width <= 0 || height <= 0)
    return `<figure class="report-static-figure"><div class="empty-result">Board bounds are unavailable or invalid.</div><figcaption>Review the import before using a geometry preview.</figcaption></figure>`;
  const scale = Math.min(800 / width, 340 / height), ox = (900 - width * scale) / 2, oy = (420 - height * scale) / 2;
  const point = (p: Point) => [ox + (p[0] - minX) * scale, oy + (p[1] - minY) * scale];
  const points = (ps: Point[]) => ps.filter(p => p.length >= 2 && p.slice(0, 2).every(Number.isFinite)).map(p => point(p).map(coordinate).join(",")).join(" ");
  const rectangle = (item: { p: Point; w: number; h: number; r: number }, fill: string, stroke: string) => {
    const [x, y] = point(item.p), w = Math.max(.08, item.w) * scale, h = Math.max(.08, item.h) * scale;
    return `<rect x="${coordinate(x - w / 2)}" y="${coordinate(y - h / 2)}" width="${coordinate(w)}" height="${coordinate(h)}" transform="rotate(${coordinate(item.r)} ${coordinate(x)} ${coordinate(y)})" fill="${fill}" stroke="${stroke}" stroke-width=".7"/>`;
  };
  const outlines = geometry.outlineLoops.map(loop => `<polygon points="${points(loop)}" fill="#edf5f0" stroke="#4c7564" stroke-width="1.4"/>`).join("");
  const zones = geometry.zones.map(zone => `<polygon points="${points(zone.p)}" fill="#d6a958" fill-opacity=".18"/>`).join("");
  const tracks = geometry.tracks.map(track => { const a = point(track.s), b = point(track.e); return `<line x1="${coordinate(a[0])}" y1="${coordinate(a[1])}" x2="${coordinate(b[0])}" y2="${coordinate(b[1])}" stroke="#b58031" stroke-width="${coordinate(Math.max(.7, track.w * scale))}" stroke-linecap="round"/>`; }).join("");
  const pads = geometry.pads.map(pad => rectangle(pad, "#d8ad5e", "#a58140")).join("");
  const components = geometry.components.map(component => rectangle(component, "none", "#6d8790")).join("");
  const vias = geometry.vias.map(via => { const [x, y] = point(via.p); return `<circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="${coordinate(Math.max(1, via.d * scale / 2))}" fill="#c69c4d"/><circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="${coordinate(Math.max(.5, via.drill * scale / 2))}" fill="#fff"/>`; }).join("");
  const samples = field ? (geometry.fields[field.key] ?? []).filter(s => [s.x_mm, s.y_mm, s.value].every(Number.isFinite)) : [];
  const range = samples.reduce((r, s) => ({ min: Math.min(r.min, s.value), max: Math.max(r.max, s.value) }), { min: Infinity, max: -Infinity });
  const fieldMarks = samples.map(sample => { const [x, y] = point([sample.x_mm, sample.y_mm]); const ratio = (sample.value - range.min) / (range.max - range.min || 1); return `<circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="3.4" fill="hsl(${coordinate(210 - ratio * 175)},70%,43%)" stroke="#fff" stroke-width=".6"><title>${escape(`${sample.value} ${field?.unit ?? ""} | ${sample.net ?? ""} | ${sample.layer ?? ""}`)}</title></circle>`; }).join("");
  const label = samples.length && field ? `${field.label}: ${range.min.toPrecision(5)} to ${range.max.toPrecision(5)} ${field.unit}` : "Board geometry; no field values inferred";
  return `<figure class="report-static-figure"><svg viewBox="0 0 900 445" role="img" aria-label="${escape(label)}"><rect width="900" height="445" fill="#fff"/>${outlines}${zones}${tracks}${pads}${vias}${components}${fieldMarks}<text x="24" y="431" fill="#597080" font-size="11" font-family="Arial">Board dimensions ${coordinate(width)} x ${coordinate(height)} mm | CAD coordinates retained</text></svg><figcaption><b>${escape(label)}</b>. Bounded 2D layout preview${samples.length ? " with disconnected returned field samples" : ""}. Full numerical results and source geometry remain in their saved artifacts. This figure does not imply resolved 3D component models.</figcaption></figure>`;
}

export function reportCurveFigure(raw: [number, number][], label: string, unit: string, xLabel: string, logX = false) {
  const valid = raw.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!logX || x > 0));
  if (!valid.length) return "";
  const points = valid.length <= 240 ? valid : Array.from({ length: 240 }, (_, index) => valid[Math.round(index * (valid.length - 1) / 239)]);
  const transformed = points.map(([x, y]) => [logX ? Math.log10(x) : x, y]);
  const range = transformed.reduce((r, [x, y]) => ({ xmin: Math.min(r.xmin, x), xmax: Math.max(r.xmax, x), ymin: Math.min(r.ymin, y), ymax: Math.max(r.ymax, y) }), { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity });
  const x = (value: number) => 62 + (value - range.xmin) / (range.xmax - range.xmin || 1) * 560;
  const y = (value: number) => 145 - (value - range.ymin) / (range.ymax - range.ymin || 1) * 120;
  const marks = transformed.map(p => `${coordinate(x(p[0]))},${coordinate(y(p[1]))}`).join(" ");
  const ticks = Array.from({ length: 4 }, (_, i) => { const value = range.ymin + (range.ymax - range.ymin) * i / 3; return `<line x1="62" y1="${coordinate(y(value))}" x2="622" y2="${coordinate(y(value))}" stroke="#e1e9ef"/><text x="56" y="${coordinate(y(value) + 3)}" text-anchor="end" font-size="9" fill="#597080">${value.toPrecision(4)}</text>`; }).join("");
  return `<figure class="net-plot"><figcaption>${escape(label)}<span>${escape(unit)}</span></figcaption><svg viewBox="0 0 650 185" role="img" aria-label="${escape(label)} returned sample curve">${ticks}<polyline points="${marks}" fill="none" stroke="#1778a1" stroke-width="1.8"/>${transformed.length === 1 ? `<circle cx="${coordinate(x(transformed[0][0]))}" cy="${coordinate(y(transformed[0][1]))}" r="3" fill="#1778a1"/>` : ""}<text x="62" y="160" font-family="Arial" font-size="9" fill="#597080">${escape(points[0][0].toPrecision(4))}</text><text x="622" y="160" text-anchor="end" font-family="Arial" font-size="9" fill="#597080">${escape(points[points.length - 1][0].toPrecision(4))}</text><text x="342" y="178" text-anchor="middle" font-family="Arial" font-size="10" fill="#34576d">${escape(xLabel)}${logX ? " (log scale)" : ""}</text></svg><small>${valid.length} returned points; ${points.length} displayed. Sample order is retained.</small></figure>`;
}
