// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { availableEMQuantities, emResultFrequencies, emViewportPayload, type EMViewportRecord, type EMViewportSettings, type EMViewportData } from "./emViewportResults";
import { downloadEMergeText, exportEMergeNetwork } from "./emergeSampleExport";
import { reviewEMergeNetwork } from "./emergeNetworkReview";
import { numericExtent } from "./numericRange";
import "./EMViewportResultManager.css";

type Props = {
  records: EMViewportRecord[]; activeRecordId: string; settings: EMViewportSettings; data: EMViewportData | null;
  onSelectRecord: (id: string) => void; onSettingsChange: (settings: EMViewportSettings) => void; onClose: () => void;
};
const recordOf = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const payloadOf = emViewportPayload;

export default function EMViewportResultManager({ records, activeRecordId, settings, data, onSelectRecord, onSettingsChange, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false), [error, setError] = useState("");
  const active = records.find(record => record.id === activeRecordId) ?? records[0];
  const quantities = active ? availableEMQuantities(active) : [];
  const frequencies = active ? emResultFrequencies(active) : [];
  const update = (patch: Partial<EMViewportSettings>) => onSettingsChange({ ...settings, ...patch });
  const sample = data && data.values.length ? Math.max(0, Math.min(settings.selectedSample, data.values.length - 1)) : 0;
  const nodeEligible = settings.projection === "magnitude" && !/interference|poynting|delta|change/i.test(settings.quantity);
  const scalarQuantity = ["pattern_delta", "interference"].includes(settings.quantity);
  const exportSamples = () => {
    if (!data) return;
    const rows = ["frequency_hz,sample_index,x_mm,y_mm,z_mm,display_value,unit", ...data.values.map((value, index) => [data.frequencyHz, index, ...data.positionsMm[index], value, JSON.stringify(data.unit)].join(","))];
    downloadEMergeText("em-viewport-samples.csv", rows.join("\n") + "\n");
  };
  return <aside className="em-viewport-manager" aria-label="EM viewport result manager" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header><strong>EM RESULT MANAGER</strong><span className="em-manager-heading-actions"><button aria-label={collapsed ? "Expand EM result manager" : "Collapse EM result manager"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "+" : "−"}</button><button aria-label="Close EM result manager" onClick={onClose}>×</button></span></header>
    {!collapsed && <div className="em-manager-body">
      {!active ? <p className="em-manager-empty">Run EMerge or Optycal to add solved results to this viewport.</p> : <>
        <div className="em-manager-controls">
          <label className="em-manager-wide">Result<select aria-label="EM viewport result" value={active.id} onChange={event => onSelectRecord(event.target.value)}>{records.map(record => <option key={record.id} value={record.id}>{record.label}</option>)}</select></label>
          <label>Frequency<select aria-label="EM viewport frequency" value={Math.min(settings.frequencyIndex, Math.max(0, frequencies.length - 1))} disabled={!frequencies.length} onChange={event => update({ frequencyIndex: Number(event.target.value), selectedSample: 0 })}>{frequencies.map((frequency, index) => <option key={frequency} value={index}>{frequency.toPrecision(6)} Hz</option>)}</select></label>
          <label>Quantity<select aria-label="EM viewport quantity" value={settings.quantity} onChange={event => update({ quantity: event.target.value, selectedSample: 0 })}>{quantities.map(quantity => <option key={quantity.id} value={quantity.id}>{quantity.label}</option>)}</select></label>
          <label>Component<select aria-label="EM viewport component" disabled={scalarQuantity} value={settings.component} onChange={event => update({ component: event.target.value as EMViewportSettings["component"] })}><option value="norm" disabled={settings.projection !== "magnitude"}>Vector norm</option>{["x", "y", "z"].map(component => <option key={component} value={component}>{component.toUpperCase()}</option>)}</select></label>
          <label>Projection<select aria-label="EM viewport projection" disabled={scalarQuantity} value={settings.projection} onChange={event => update({ projection: event.target.value as EMViewportSettings["projection"], ...(event.target.value !== "magnitude" && settings.component === "norm" ? { component: "x" as const } : {}) })}><option value="magnitude">Magnitude</option><option value="real">Real</option><option value="imaginary">Imaginary</option><option value="phase">Phase</option><option value="instantaneous">Instantaneous phasor</option></select></label>
          <label>Style<select aria-label="EM viewport style" value={settings.style} onChange={event => update({ style: event.target.value as EMViewportSettings["style"] })}><option value="surface">Surface</option><option value="samples">Samples</option><option value="vectors">Vectors</option><option value="contours">Contours</option></select></label>
          <label>Opacity<input aria-label="EM viewport opacity" type="range" min="0.05" max="1" step="0.05" value={settings.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
          <label>Phasor phase (deg)<input aria-label="EM viewport phasor phase" type="number" min="-360" max="360" step="5" disabled={settings.projection !== "instantaneous"} value={settings.phaseDeg} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 360) update({ phaseDeg: value }); }} /></label>
          <label>Pattern display radius (mm)<input aria-label="EM viewport pattern radius" type="number" min="1" max="10000" value={settings.displayRadiusMm} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 10000) update({ displayRadiusMm: value }); }} /></label>
        </div>
        <div className="em-manager-checks"><label><input type="checkbox" checked={settings.visible} onChange={event => update({ visible: event.target.checked })} />Show overlay</label><label><input type="checkbox" checked={settings.showStructure} onChange={event => update({ showStructure: event.target.checked })} />Show structure</label><label><input type="checkbox" disabled={!nodeEligible} checked={nodeEligible && settings.nodes} onChange={event => update({ nodes: event.target.checked })} />Low amplitude</label><label><input type="checkbox" disabled={!nodeEligible} checked={nodeEligible && settings.antinodes} onChange={event => update({ antinodes: event.target.checked })} />High amplitude</label></div>
        <label className="em-manager-controls">Node / antinode threshold (% of peak)<input aria-label="EM viewport amplitude threshold" type="range" min="1" max="25" step="1" disabled={!nodeEligible} value={settings.thresholdPct} onChange={event => update({ thresholdPct: Number(event.target.value) })} /></label>
        <small className="em-manager-warning">{String(payloadOf(active.result).model_status ?? "unvalidated")} · Low/high amplitude samples are candidate nodes/antinodes, not certified standing-wave locations. Pattern radius is a display scale, not spatial field extent.</small>
        {data ? <>
          <small>{data.label} · {data.frequencyHz.toPrecision(6)} Hz · {data.values.length} actual samples · {data.unit}</small>
          <div className="em-manager-controls"><label className="em-manager-wide">Linked viewport probe<input aria-label="EM viewport sample probe" type="number" min="0" max={Math.max(0, data.values.length - 1)} step="1" value={sample} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value < data.values.length) update({ selectedSample: value }); }} /></label></div>
          {data.positionsMm[sample] && <small role="status">Sample {sample}: ({data.positionsMm[sample].map(value => value.toPrecision(6)).join(", ")}) mm · {typeof data.values[sample] === "number" ? data.values[sample]!.toPrecision(6) : "invalid / unavailable"} {data.unit}</small>}
          <LinkedSampleGraph values={data.values} selected={sample} label={`${data.label} (${data.unit})`} onSelect={index => update({ selectedSample: index })} />
          {data.notices.map((notice, index) => <small key={index} className="em-manager-warning">{notice}</small>)}
        </> : <small className="em-manager-warning">This result has no admitted samples for the current quantity/frequency. Choose an available quantity; missing fields are not synthesized.</small>}
        <EMResultGraphs key={active.id} result={active.result} frequencyIndex={settings.frequencyIndex} onFrequencyChange={index => update({ frequencyIndex: index, selectedSample: 0 })} />
        <div className="extension-actions"><button className="secondary-btn" disabled={!data} onClick={exportSamples}>Export displayed samples</button><button className="secondary-btn" onClick={() => { try { downloadEMergeText("em-analysis.json", JSON.stringify(payloadOf(active.result), null, 2)); setError(""); } catch { setError("Result export failed."); } }}>Export result JSON</button></div>{error && <small role="alert">{error}</small>}
      </>}
    </div>}
  </aside>;
}

function LinkedSampleGraph({ values, selected, label, onSelect }: { values: Array<number | null>; selected: number; label: string; onSelect: (index: number) => void }) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const range = numericExtent(valid), span = range.maximum - range.minimum || 1;
  const x = (index: number) => 35 + index / Math.max(1, values.length - 1) * 265;
  const y = (value: number) => 125 - (value - range.minimum) / span * 100;
  const pick = (event: React.MouseEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width <= 0) return; const logicalX = (event.clientX - rect.left) / rect.width * 320; onSelect(Math.round(Math.max(0, Math.min(1, (logicalX - 35) / 265)) * Math.max(0, values.length - 1))); };
  let drawing = false;
  const path = values.map((value, index) => { if (value === null || !Number.isFinite(value)) { drawing = false; return ""; } const command = drawing ? "L" : "M"; drawing = true; return `${command}${x(index)},${y(value)}`; }).join(" ");
  return <section className="em-manager-graph"><b>{label}</b><svg viewBox="0 0 320 155" role="button" tabIndex={0} aria-label="Linked EM sample graph. Click to probe; arrow keys move the selected sample." onClick={pick} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); onSelect(Math.max(0, Math.min(values.length - 1, selected + (event.key === "ArrowRight" ? 1 : -1)))); } }}><line x1="35" y1="125" x2="300" y2="125" stroke="#46616c" /><path d={path} stroke="#71d2e9" strokeWidth="1.5" fill="none" />{typeof values[selected] === "number" && <circle cx={x(selected)} cy={y(values[selected]!)} r="4" fill="#ffbd69" />}<text x="32" y="22" textAnchor="end">{range.maximum.toPrecision(3)}</text><text x="32" y="127" textAnchor="end">{range.minimum.toPrecision(3)}</text><text x="165" y="148" textAnchor="middle">Actual sample index</text></svg><small>Click or use arrow keys to move the viewport probe. Invalid solver samples leave gaps.</small></section>;
}

function EMResultGraphs({ result, frequencyIndex, onFrequencyChange }: { result: Record<string, unknown>; frequencyIndex: number; onFrequencyChange: (index: number) => void }) {
  const payload = payloadOf(result), fields = recordOf(payload.fields), radiation = recordOf(fields.radiation), comparison = recordOf(fields.comparison);
  const [receive, setReceive] = useState(0), [excited, setExcited] = useState(0), [networkProjection, setNetworkProjection] = useState("magnitude");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ bare: true, installed: true, radiation: true });
  const review = reviewEMergeNetwork({ data: { analysis_result: payload } });
  const network = recordOf(recordOf(payload.networks).s_parameters);
  const ports = Array.isArray(network.ports) ? network.ports as string[] : [];
  const matrices = Array.isArray(network.values) ? network.values as number[][][][] : [];
  const frequencies = Array.isArray(network.frequencies_hz) ? network.frequencies_hz as number[] : [];
  const radiationCuts = Array.isArray(radiation.cuts) ? radiation.cuts : [];
  const cut = recordOf(radiationCuts[Math.min(frequencyIndex, Math.max(0, radiationCuts.length - 1))]);
  const angularTraces: GraphTrace[] = [];
  if (Array.isArray(cut.angles_deg) && Array.isArray(cut.relative_amplitude_db) && cut.angles_deg.length === cut.relative_amplitude_db.length) angularTraces.push({ id: "radiation", label: "Radiation", x: cut.angles_deg as number[], y: cut.relative_amplitude_db as number[], color: "#70d4e8" });
  if (Array.isArray(comparison.theta_deg) && Array.isArray(comparison.phi_deg)) for (const [id, key, color] of [["bare", "bare_relative_db", "#70d4e8"], ["installed", "structure_relative_db", "#eabc71"]]) {
    const values = comparison[key];
    if (Array.isArray(values) && values.length === comparison.theta_deg.length * comparison.phi_deg.length) angularTraces.push({ id, label: id === "bare" ? "Bare" : "Installed", x: comparison.theta_deg as number[], y: (comparison.theta_deg as number[]).map((_, index) => values[index * (comparison.phi_deg as number[]).length] as number), color });
  }
  const traces = angularTraces.filter(trace => trace.x.every(Number.isFinite) && trace.y.every(value => typeof value === "number" && Number.isFinite(value)));
  const networkValues = review.issue === null ? frequencies.flatMap((frequency, index) => { const pair = matrices[index]?.[Math.min(receive, ports.length - 1)]?.[Math.min(excited, ports.length - 1)]; if (!pair) return []; return [{ x: frequency, y: networkProjection === "phase" ? (pair[0] === 0 && pair[1] === 0 ? null : Math.atan2(pair[1], pair[0]) * 180 / Math.PI) : 20 * Math.log10(Math.max(Math.hypot(...pair), 1e-15)) }]; }) : [];
  return <>
    {traces.length > 0 && <section className="em-manager-graph"><b>Linked radiation cuts · {Array.isArray(comparison.theta_deg) ? "phi = 0°, common bare reference" : `phi = ${String(cut.phi_deg ?? 0)}°`}</b><div className="em-manager-traces">{traces.map(trace => <label key={trace.id}><input type="checkbox" checked={enabled[trace.id] !== false} onChange={event => setEnabled({ ...enabled, [trace.id]: event.target.checked })} />{trace.label}</label>)}</div><MultiTraceGraph traces={traces.filter(trace => enabled[trace.id] !== false)} xLabel="Theta (deg)" yLabel="Relative field (dB)" /></section>}
    {networkValues.length > 0 && <section className="em-manager-graph"><b>S-parameter sweep</b><div className="em-manager-controls"><label>Receive<select aria-label="EM graph receive port" value={receive} onChange={event => setReceive(Number(event.target.value))}>{ports.map((port, index) => <option key={port} value={index}>{port}</option>)}</select></label><label>Excited<select aria-label="EM graph excited port" value={excited} onChange={event => setExcited(Number(event.target.value))}>{ports.map((port, index) => <option key={port} value={index}>{port}</option>)}</select></label><label>Network display<select aria-label="EM graph network display" value={networkProjection} onChange={event => setNetworkProjection(event.target.value)}><option value="magnitude">Magnitude (dB)</option><option value="phase">Phase (deg)</option></select></label></div><MultiTraceGraph traces={[{ id: "network", label: "S", x: networkValues.map(point => point.x), y: networkValues.map(point => point.y), color: "#70d4e8" }]} xLabel="Frequency (Hz)" yLabel={networkProjection === "phase" ? "Phase (deg)" : "Magnitude (dB)"} onSelect={onFrequencyChange} selectedIndex={frequencyIndex} /><button className="secondary-btn" onClick={() => { const output = exportEMergeNetwork({ data: { analysis_result: payload } }, "touchstone"); downloadEMergeText(output.name, output.text); }}>Export Touchstone</button></section>}
  </>;
}
type GraphTrace = { id: string; label: string; x: number[]; y: Array<number | null>; color: string };
function MultiTraceGraph({ traces, xLabel, yLabel, onSelect, selectedIndex = 0 }: { traces: GraphTrace[]; xLabel: string; yLabel: string; onSelect?: (index: number) => void; selectedIndex?: number }) {
  if (!traces.length) return <small>No graph traces selected.</small>;
  const xRange = numericExtent(traces.flatMap(trace => trace.x)), yRange = numericExtent(traces.flatMap(trace => trace.y).filter((value): value is number => typeof value === "number"));
  const x = (value: number) => 40 + (value - xRange.minimum) / (xRange.maximum - xRange.minimum || 1) * 260;
  const y = (value: number) => 120 - (value - yRange.minimum) / (yRange.maximum - yRange.minimum || 1) * 95;
  const click = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onSelect) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const logicalX = (event.clientX - rect.left) / rect.width * 320;
    const target = xRange.minimum + Math.max(0, Math.min(1, (logicalX - 40) / 260)) * (xRange.maximum - xRange.minimum);
    const samples = traces[0].x;
    onSelect(samples.reduce((best, value, index) => Math.abs(value - target) < Math.abs(samples[best] - target) ? index : best, 0));
  };
  return <><svg viewBox="0 0 320 155" role={onSelect ? "button" : "img"} tabIndex={onSelect ? 0 : undefined} aria-label={`${yLabel} versus ${xLabel}${onSelect ? ". Click to select the viewport frequency; arrow keys move frequency." : ""}`} onClick={click} onKeyDown={event => { if (onSelect && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); onSelect(Math.max(0, Math.min(traces[0].x.length - 1, selectedIndex + (event.key === "ArrowRight" ? 1 : -1)))); } }}>{traces.map(trace => <path key={trace.id} d={tracePath(trace, x, y)} fill="none" stroke={trace.color} strokeWidth="1.5" />)}{onSelect && traces[0].x[selectedIndex] !== undefined && <line x1={x(traces[0].x[selectedIndex])} x2={x(traces[0].x[selectedIndex])} y1="20" y2="125" stroke="#ffbd69" strokeDasharray="3 3" />}<text x="35" y="25" textAnchor="end">{yRange.maximum.toPrecision(3)}</text><text x="35" y="122" textAnchor="end">{yRange.minimum.toPrecision(3)}</text><text x="165" y="148" textAnchor="middle">{xLabel}</text></svg><small>{yLabel}; straight segments connect solved samples.{onSelect ? " Click a frequency to update the viewport." : ""}</small></>;
}

function tracePath(trace: GraphTrace, x: (value: number) => number, y: (value: number) => number): string {
  let drawing = false;
  return trace.y.map((value, index) => { if (value === null) { drawing = false; return ""; } const command = drawing ? "L" : "M"; drawing = true; return `${command}${x(trace.x[index])},${y(value)}`; }).join(" ");
}
