// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import DataTable from "./DataTable";
import PlotlyChart from "./PlotlyChart";
import { numericExtent } from "./numericRange";
import "./ACPowerIntegrityEffects.css";

type Pair = [number, number];
type Reply = { ok: boolean; result?: Record<string, unknown>; error?: string };
type Request = { contract: "spike/ac-pi-request/v1"; frequencies_hz: number[]; length_m: number;
  R_ohm_per_m: number; L_h_per_m: number; G_s_per_m: number; C_f_per_m: number;
  source_impedance_ohm: Pair; load_impedance_ohm: Pair | null;
  conductor?: { width_m: number; thickness_m: number; conductivity_s_m: number; relative_permeability: number; field_bias_ratio: Pair } };
export type ACPIForm = { length_mm: string; R: string; L_nh: string; G: string; C_pf: string;
  source_real: string; source_imag: string; load: "open" | "complex" | "short"; load_real: string; load_imag: string;
  sweep: "list" | "linear" | "log"; frequencies: string; start: string; stop: string; points: string;
  slab: boolean; width_mm: string; thickness_um: string; conductivity: string; permeability: string; bias_real: string; bias_imag: string };
export function defaultACPIForm(): ACPIForm {
  return { length_mm: "", R: "", L_nh: "", G: "", C_pf: "", source_real: "0", source_imag: "0",
    load: "open", load_real: "", load_imag: "", sweep: "log", frequencies: "", start: "", stop: "", points: "101",
    slab: false, width_mm: "", thickness_um: "", conductivity: "", permeability: "1", bias_real: "0", bias_imag: "0" };
}
function number(text: string, label: string, minimum = -Infinity, positive = false): number {
  const value = text.trim() ? Number(text) : NaN;
  if (!Number.isFinite(value) || value < minimum || (positive && value === 0)) throw new Error(`${label} requires a finite ${positive ? "positive" : minimum === 0 ? "nonnegative" : "numeric"} value.`);
  return value;
}
export function buildACPIRequest(form: ACPIForm): Request {
  let frequencies: number[];
  if (form.sweep === "list") {
    if (!form.frequencies.trim()) throw new Error("Enter a frequency list in Hz.");
    frequencies = form.frequencies.trim().split(/[\s,;]+/).map(value => number(value, "Frequency", 0));
  } else {
    const start = number(form.start, "Start frequency", 0, form.sweep === "log");
    const stop = number(form.stop, "Stop frequency", 0, form.sweep === "log");
    const count = number(form.points, "Sweep points", 2);
    if (!Number.isInteger(count) || count > 2048 || stop <= start) throw new Error("Sweep needs 2–2048 integer points and stop above start; logarithmic frequencies must be positive.");
    frequencies = Array.from({ length: count }, (_, i) => i === 0 ? start : i === count-1 ? stop : form.sweep === "log"
      ? Math.exp(Math.log(start)+(Math.log(stop)-Math.log(start))*i/(count-1)) : start+(stop-start)*i/(count-1));
  }
  if (!frequencies.length || frequencies.length > 2048 || frequencies.some((f,i) => i > 0 && f <= frequencies[i-1])) throw new Error("Use 1–2048 strictly increasing frequencies.");
  const request: Request = { contract: "spike/ac-pi-request/v1", frequencies_hz: frequencies,
    length_m: number(form.length_mm, "Line length", 0, true)*1e-3,
    R_ohm_per_m: number(form.R, "R", 0), L_h_per_m: number(form.L_nh, "L", 0)*1e-9,
    G_s_per_m: number(form.G, "G", 0), C_f_per_m: number(form.C_pf, "C", 0)*1e-12,
    source_impedance_ohm: [number(form.source_real, "Source real impedance", 0), number(form.source_imag, "Source imaginary impedance")],
    load_impedance_ohm: form.load === "open" ? null : form.load === "short" ? [0,0] : [number(form.load_real, "Load real impedance", 0), number(form.load_imag, "Load imaginary impedance")] };
  if (form.slab) request.conductor = { width_m: number(form.width_mm, "Slab width", 0, true)*1e-3,
    thickness_m: number(form.thickness_um, "Slab thickness", 0, true)*1e-6,
    conductivity_s_m: number(form.conductivity, "Conductivity", 0, true),
    relative_permeability: number(form.permeability, "Relative permeability", 0, true),
    field_bias_ratio: [number(form.bias_real, "Imposed field bias real"), number(form.bias_imag, "Imposed field bias imaginary")] };
  return request;
}
function formFromRequest(initial?: Record<string, unknown> | null): ACPIForm {
  const form = defaultACPIForm();
  if (initial?.contract !== "spike/ac-pi-request/v1") return form;
  const fields = [["length_mm","length_m",1e3],["R","R_ohm_per_m",1],["L_nh","L_h_per_m",1e9],["G","G_s_per_m",1],["C_pf","C_f_per_m",1e12]] as const;
  for (const [key, source, scale] of fields) if (typeof initial[source] === "number") form[key] = String(initial[source]*scale);
  for (const [name, prefix] of [["source_impedance_ohm","source"],["load_impedance_ohm","load"]] as const) {
    const pair = initial[name];
    if (Array.isArray(pair) && pair.length === 2) { form[`${prefix}_real`] = String(pair[0]); form[`${prefix}_imag`] = String(pair[1]); }
  }
  form.load = initial.load_impedance_ohm === null ? "open" : "complex";
  if (Array.isArray(initial.frequencies_hz)) { form.sweep = "list"; form.frequencies = initial.frequencies_hz.join(", "); }
  const conductor = record(initial.conductor);
  if (Object.keys(conductor).length) {
    form.slab = true;
    for (const [key, source, scale] of [["width_mm","width_m",1e3],["thickness_um","thickness_m",1e6],["conductivity","conductivity_s_m",1],["permeability","relative_permeability",1]] as const)
      if (typeof conductor[source] === "number") form[key] = String(conductor[source]*scale);
    if (Array.isArray(conductor.field_bias_ratio)) [form.bias_real,form.bias_imag] = conductor.field_bias_ratio.map(String);
  }
  return form;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
function pair(value: unknown): Pair | null { return Array.isArray(value) && value.length === 2 && value.every(v => finite(v) !== null) ? value as Pair : null; }
export const acpiFormat = (value: unknown): string => finite(value) === null ? "—" : Number(value).toPrecision(5);
const magnitude = (value: unknown): number | null => { const v = pair(value); return v ? Math.hypot(...v) : null; };
const phase = (value: unknown): number | null => { const v = pair(value); return v && Math.hypot(...v) > 0 ? Math.atan2(v[1],v[0])*180/Math.PI : null; };
type Series = { label: string; color: string; values: (number | null)[] };
export function ACPISampleChart({ frequencies, series, unit, title, interactive = true }: { frequencies: number[]; series: Series[]; unit: string; title: string; interactive?: boolean }) {
  const all = series.flatMap(s => s.values).filter((v): v is number => finite(v) !== null);
  if (!frequencies.length || !all.length) return <figure className="acpi-chart"><figcaption>{title}</figcaption><p>No finite returned samples.</p></figure>;
  const log = frequencies[0] > 0 && frequencies[frequencies.length-1]/frequencies[0] > 10;
  if (!interactive) {
    const xs = frequencies.map(frequency => log ? Math.log10(frequency) : frequency);
    const xmin = xs[0], xmax = xs[xs.length - 1], { minimum: ymin, maximum: ymax } = numericExtent(all);
    const x = (index: number) => 55 + ((xs[index] - xmin) / (xmax - xmin || 1)) * 460;
    const y = (value: number) => 155 - (value - ymin) / (ymax - ymin || Math.max(1, Math.abs(ymin))) * 120;
    return <figure className="acpi-chart"><figcaption>{title}</figcaption><svg viewBox="0 0 540 215" role="img" aria-label={`${title}, actual returned samples`}
      data-spike-plot={JSON.stringify({ frame: [55, 35, 515, 155], x: [xmin, xmax], y: [ymin, ymax], ...(log ? { logX: true } : {}) })}>
      <path d="M55 35V155H515" fill="none" stroke="currentColor" opacity=".35" />
      <g data-plot-ticks><text x="8" y="34">{acpiFormat(ymax)}</text><text x="8" y="159">{acpiFormat(ymin)}</text><text x="55" y="185">{acpiFormat(frequencies[0])}</text><text x="430" y="185">{acpiFormat(frequencies[frequencies.length - 1])}</text></g><text x="180" y="207">Frequency (Hz{log ? ", log scale" : ""}) · {unit}</text>
      <g data-plot-traces>{series.map(item => { let gap = true; const commands = item.values.map((value, index) => { if (finite(value) === null) { gap = true; return ""; } const command = `${gap ? "M" : "L"}${x(index).toFixed(3)} ${y(value!).toFixed(3)}`; gap = false; return command; }).join(" ");
        return <g key={item.label}><path data-series={item.label} d={commands} fill="none" stroke={item.color} strokeWidth="2" />{item.values.map((value, index) => finite(value) !== null ? <circle key={index} data-frequency-hz={frequencies[index]} data-value={value!} cx={x(index)} cy={y(value!)} r="2" fill={item.color}><title>{`${item.label}: ${frequencies[index]} Hz, ${acpiFormat(value)} ${unit}`}</title></circle> : null)}</g>; })}
      </g></svg><div className="acpi-legend">{series.map(item => <span key={item.label} style={{ color: item.color }}>{item.label}</span>)}</div><small>Lines join adjacent computed samples only; singular samples leave gaps.</small></figure>;
  }
  const data = series.map(item => ({ type: "scatter", mode: "lines+markers", name: item.label, x: frequencies, y: item.values,
    connectgaps: false, line: { color: item.color, width: 2 }, marker: { color: item.color, size: 5 },
    hovertemplate: `%{x:.6g} Hz<br>%{y:.6g} ${unit}<extra>${item.label}</extra>` }));
  return <figure className="acpi-chart"><figcaption>{title}</figcaption><PlotlyChart title={title} data={data} revision={`acpi:${title}:${JSON.stringify([frequencies, series.map(item => item.values)])}`}
    layout={{ margin: { l: 68, r: 20, t: 20, b: 58 }, hovermode: "closest", xaxis: { title: "Frequency (Hz)", type: log ? "log" : "linear" }, yaxis: { title: unit }, legend: { orientation: "h" } }} />
    <small>Lines join adjacent computed samples only; singular samples leave gaps.</small></figure>;
}
export function ACPISamplePlots({ result, interactive = true }: { result: Record<string, unknown> | null; interactive?: boolean }) {
  if (result?.contract !== "spike/ac-pi-result/v1" || !Array.isArray(result.samples) || result.samples.length > 2048) return null;
  const samples = result.samples.map(record);
  if (samples.some(s => finite(s.frequency_hz) === null)) return <p role="alert">Returned sample frequencies are malformed.</p>;
  const frequencies = samples.map(s => Number(s.frequency_hz));
  const values = (get: (s: Record<string, unknown>) => number | null) => samples.map(s => s.status === "computed" ? get(s) : null);
  const series = (label: string, color: string, get: (s: Record<string, unknown>) => number | null): Series => ({ label,color,values:values(get) });
  const slab = samples.some(s => Object.keys(record(s.slab)).length);
  return <section className="acpi-results"><p><b>{String(result.model_status ?? "Unqualified")}</b> · RMS phasors, exp(+jωt). Source normalization: {pair(result.source_voltage_v_rms) ? `${acpiFormat(magnitude(result.source_voltage_v_rms))} V RMS` : "not reported"}. These are explicit uniform-line results.</p>
    <div className="acpi-plots"><ACPISampleChart interactive={interactive} frequencies={frequencies} title="Voltage gain" unit="V/V" series={[series("Load / source","#4ea5ff",s => finite(s.load_to_source_voltage_gain)),series("Load / sending end","#f3ab48",s => finite(s.load_to_sending_voltage_gain))]} />
      <ACPISampleChart interactive={interactive} frequencies={frequencies} title="Voltage phase relative to source" unit="degrees, wrapped" series={[series("Load phase","#4ea5ff",s => phase(s.load_voltage_v_rms)),series("Sending phase","#f3ab48",s => phase(s.sending_voltage_v_rms))]} />
      <ACPISampleChart interactive={interactive} frequencies={frequencies} title="Input impedance magnitude" unit="Ω" series={[series("|Zin|","#4ea5ff",s => magnitude(s.input_impedance_ohm))]} />
      <ACPISampleChart interactive={interactive} frequencies={frequencies} title="Input impedance phase" unit="degrees, wrapped" series={[series("arg Zin","#4ea5ff",s => phase(s.input_impedance_ohm))]} />
      <ACPISampleChart interactive={interactive} frequencies={frequencies} title="Line resistance R(f)" unit="Ω/m" series={[series("Actual line R","#f3ab48",s => finite(s.R_ohm_per_m))]} />
      {slab && <><ACPISampleChart interactive={interactive} frequencies={frequencies} title="Slab Joule loss at unit total current" unit="W/m" series={[series("Isolated skin","#4ea5ff",s => finite(record(s.slab).isolated_skin_loss_w_per_m)),series("Imposed field proximity","#f3ab48",s => finite(record(s.slab).imposed_field_proximity_loss_w_per_m))]} />
        <ACPISampleChart interactive={interactive} frequencies={frequencies} title="Skin depth" unit="µm" series={[series("Slab skin depth","#4ea5ff",s => { const v = finite(record(s.slab).skin_depth_m); return v === null ? null : v*1e6; })]} /></>}
    </div><details><summary>Sample values and voltage-rise diagnostics ({samples.length})</summary><p>Ferranti-type voltage rise is reported only from the worker’s explicit load/sending flag. Load/source gain includes the source impedance; the two references differ.</p><div className="acpi-table"><DataTable label="AC power integrity sample values"><thead><tr>{["Hz","Status","Load / source","Load / sending","Voltage rise above sending","Load phase (°)","|Zin| (Ω)","Zin phase (°)","R (Ω/m)","Relative denominator margin"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{samples.map((s,i) => <tr key={i}><td>{acpiFormat(s.frequency_hz)}</td><td>{String(s.status ?? "not reported")}</td><td>{acpiFormat(s.load_to_source_voltage_gain)}</td><td>{acpiFormat(s.load_to_sending_voltage_gain)}</td><td>{s.voltage_rise_above_sending === true ? "Reported voltage rise" : s.voltage_rise_above_sending === false ? "No reported rise" : "Not reported"}</td><td>{acpiFormat(phase(s.load_voltage_v_rms))}</td><td>{s.input_impedance_state === "open" ? "Open" : acpiFormat(magnitude(s.input_impedance_ohm))}</td><td>{acpiFormat(phase(s.input_impedance_ohm))}</td><td>{acpiFormat(s.R_ohm_per_m)}</td><td>{acpiFormat(s.denominator_relative_margin)}</td></tr>)}</tbody></DataTable></div></details>
    {Array.isArray(result.assumptions) && <ul>{result.assumptions.filter(v => typeof v === "string").map((v,i) => <li key={i}>{String(v)}</li>)}</ul>}
  </section>;
}

export function ACPowerIntegrityEffects({ callWorker, onStatus, onResult, initialRequest, initialResult }: {
  callWorker: (request: { method: string; params: Record<string, unknown> }) => Promise<Reply>;
  onStatus?: (status: string) => void; onResult?: (result: Record<string, unknown>, request: Request) => void;
  initialRequest?: Record<string, unknown> | null; initialResult?: Record<string, unknown> | null;
}) {
  const [form,setForm] = useState(() => formFromRequest(initialRequest));
  const [result,setResult] = useState(initialResult ?? null), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const prepared = useMemo(() => { try { return { request:buildACPIRequest(form), error:"" }; } catch (e) { return { request:null,error:e instanceof Error ? e.message : String(e) }; } },[form]);
  const patch = (key: keyof ACPIForm, value: string | boolean) => setForm(current => ({ ...current,[key]:value }));
  const field = (key: keyof ACPIForm, label: string) => <label key={key}>{label}<input type="number" step="any" aria-label={label} value={String(form[key])} onChange={e => patch(key,e.target.value)} /></label>;
  const run = async () => { if (!prepared.request || busy) return; setBusy(true); setError(""); setResult(null); onStatus?.("Running explicit uniform-line AC analysis…");
    try { const response = await callWorker({method:"analyze_ac_power_integrity",params:{request:prepared.request}});
      if (!response.ok || response.result?.contract !== "spike/ac-pi-result/v1" || !Array.isArray(response.result.samples)) throw new Error(response.error || "Worker returned no supported AC result.");
      setResult(response.result); onResult?.(response.result,prepared.request); onStatus?.("Uniform-line AC analysis completed; model remains experimental.");
    } catch (e) { const message = e instanceof Error ? e.message : String(e); setError(message); onStatus?.(message); } finally { setBusy(false); }
  };
  return <section className="acpi-workbench"><h3>AC power integrity effects</h3><p>Enter an explicit uniform passive line. This experimental model requires no board and does not extract PCB geometry, return paths, nearby conductor fields or radiation. Voltages use a 1 V RMS source.</p>
    <fieldset disabled={busy}><legend>Uniform line and source</legend><div className="acpi-fields">{field("length_mm","Length (mm)")}{field("R","R (Ω/m)")}{field("L_nh","L (nH/m)")}{field("G","G (S/m)")}{field("C_pf","C (pF/m)")}{field("source_real","Source impedance real (Ω)")}{field("source_imag","Source impedance imaginary (Ω)")}</div>
      <label>Load boundary<select value={form.load} onChange={e => patch("load",e.target.value)}><option value="open">Open circuit</option><option value="complex">Explicit complex impedance</option><option value="short">Ideal short circuit</option></select></label>{form.load === "complex" && <div className="acpi-fields">{field("load_real","Load impedance real (Ω)")}{field("load_imag","Load impedance imaginary (Ω)")}</div>}
    </fieldset><fieldset disabled={busy}><legend>Frequency sweep</legend><label>Sampling<select value={form.sweep} onChange={e => patch("sweep",e.target.value)}><option value="log">Logarithmic sweep</option><option value="linear">Linear sweep</option><option value="list">Explicit frequency list</option></select></label>{form.sweep === "list" ? <label>Ascending frequencies (Hz)<textarea aria-label="Ascending frequencies (Hz)" value={form.frequencies} onChange={e => patch("frequencies",e.target.value)} placeholder="0, 1000, 10000" /></label> : <div className="acpi-fields">{field("start","Start frequency (Hz)")}{field("stop","Stop frequency (Hz)")}{field("points","Frequency points (2–2048)")}</div>}</fieldset>
    <fieldset disabled={busy}><legend>Optional exact 1D conductor slab loss</legend><label><input type="checkbox" checked={form.slab} onChange={e => patch("slab",e.target.checked)} />Replace line R with slab resistance from explicit conductor and imposed surface fields</label><p>Infinite-width diffusion approximation. The imposed bias is Haverage / Hdifference, a complex ratio supplied by you. It is not inferred from neighboring PCB conductors; return-conductor loss and internal reactive energy are not added automatically.</p>{form.slab && <div className="acpi-fields">{field("width_mm","Conductor width (mm)")}{field("thickness_um","Conductor thickness (µm)")}{field("conductivity","Conductivity (S/m)")}{field("permeability","Relative permeability")}{field("bias_real","Imposed field bias real ratio")}{field("bias_imag","Imposed field bias imaginary ratio")}</div>}</fieldset>
    <button className="primary-btn" disabled={busy || !prepared.request} onClick={() => void run()}>{busy ? "Running…" : "Run AC analysis"}</button>{prepared.error && <small>{prepared.error}</small>}{error && <p role="alert">{error}</p>}{result && <><small>Result uses the submitted parameters; editing the form requires another run.</small><ACPISamplePlots result={result} /></>}
  </section>;
}
