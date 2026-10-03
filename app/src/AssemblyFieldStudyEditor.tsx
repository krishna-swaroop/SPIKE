// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import DataTable from "./DataTable";
import type { AssemblyIr } from "./mcadAssembly";
import { openNativeTextFile, runLocalWorker, runNativeProjectWorker, saveNativeTextFile, type WorkerResponse } from "./workerBridge";
import { assertFieldAssembly, fieldCanRun, fieldOwnerName, fieldStudyDirty, fieldTemperatureRows, type FieldObject, type FieldRecord, type FieldSnapshot } from "./assemblyFieldStudyPresentation";
import "./assemblyFieldStudyEditor.css";

const formatted = (value: unknown) => JSON.stringify(value, null, 2);
function workerValue(response: WorkerResponse): FieldObject {
  if (!response.ok || !response.result) throw new Error([response.error_code, response.error, response.error_detail?.detail].filter(Boolean).join(" · ") || "Assembly field worker returned no data.");
  return response.result;
}

/** Supplied physical volumes are admitted and solved by the resident worker. */
export default function AssemblyFieldStudyEditor({ assembly, projectPath, manifestDigest, disabled, onUpdated, onStatus, onDirtyChange }: {
  assembly: AssemblyIr; projectPath: string | null; manifestDigest: string | null; disabled: boolean;
  onUpdated: () => Promise<void>; onStatus: (message: string) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [physical, setPhysical] = useState<FieldObject | null>(null);
  const [record, setRecord] = useState<FieldRecord | null>(null);
  const [handoff, setHandoff] = useState<FieldObject | null>(null);
  const [requestText, setRequestText] = useState("");
  const [problemText, setProblemText] = useState("");
  const [baseline, setBaseline] = useState<FieldSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const saved = useRef<{ record: FieldRecord | null; handoff: FieldObject | null }>({ record: null, handoff: null });
  const appliedRequestText = useMemo(() => record ? formatted(record.request) : "", [record?.request]);
  const appliedProblemText = useMemo(() => record ? formatted(record.problem) : "", [record?.problem]);
  const dirty = fieldStudyDirty({ requestText, problemText, result: record?.result ?? null }, baseline);
  const unapplied = !record || requestText !== appliedRequestText || problemText !== appliedProblemText;
  const locked = disabled || busy || loading || !physical;
  useEffect(() => { onDirtyChange?.(dirty || busy); }, [onDirtyChange, dirty, busy]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const accept = (value: FieldRecord, prepared: FieldObject) => {
    setRecord(value); setHandoff(prepared); setRequestText(formatted(value.request)); setProblemText(formatted(value.problem));
  };
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    setRecord(null); setHandoff(null); setPhysical(null); setBaseline(null); setError("");
    saved.current = { record: null, handoff: null };
    setRequestText(""); setProblemText("");
    if (!projectPath || !manifestDigest) return;
    setLoading(true);
    void (async () => {
      const read = workerValue(await runNativeProjectWorker({ method: "read_assembly_field_study_in_project", params: {
        project_path: projectPath, expected_manifest_payload_sha256: manifestDigest,
      } }));
      if (!active || token !== generation.current) return;
      setPhysical(read.assembly);
      if (read.record) {
        const prepared = workerValue(await runLocalWorker({ method: "prepare_assembly_field_handoff", params: { request: read.record.request } }));
        if (!active || token !== generation.current) return;
        accept(read.record, prepared);
        saved.current = { record: read.record, handoff: prepared };
        setBaseline({ requestText: formatted(read.record.request), problemText: formatted(read.record.problem), result: read.record.result });
      } else {
        const request = formatted({ contract: "spike/assembly-field-handoff-request/v1", assembly: read.assembly, domain: "thermal", bodies: [], materials: [] });
        const problem = formatted({ contract: "spike/assembly-field-thermal-problem/v1", boundaries: [], heat_sources: [], contacts: [] });
        setRequestText(request); setProblemText(problem);
        setBaseline({ requestText: request, problemText: problem, result: null });
        if (read.state === "stale") setError(read.action);
      }
    })().catch(caught => { if (active && token === generation.current) setError(String(caught)); })
      .finally(() => { if (active && token === generation.current) setLoading(false); });
    return () => { active = false; generation.current++; };
  }, [projectPath, manifestDigest, reload]);

  const action = async (work: (token: number) => Promise<void>) => {
    if (locked) return;
    const token = generation.current;
    setBusy(true); setError("");
    try { await work(token); } catch (caught) { if (token === generation.current) { setError(String(caught)); onStatus(String(caught)); } }
    finally { setBusy(false); }
  };
  const admit = async (value: FieldRecord) => {
    assertFieldAssembly(value.request, physical);
    const admitted = workerValue(await runLocalWorker({ method: "import_assembly_field_study", params: { record: value } })) as FieldRecord;
    const prepared = workerValue(await runLocalWorker({ method: "prepare_assembly_field_handoff", params: { request: admitted.request } }));
    return { admitted, prepared };
  };
  const open = () => action(async token => {
    const file = await openNativeTextFile("result"); if (!file) return;
    if (new TextEncoder().encode(file.contents).length > 8 * 1024 * 1024) throw new Error("ASSEMBLY_FIELD_RESOURCE: study file exceeds 8 MiB.");
    const { admitted, prepared } = await admit(JSON.parse(file.contents));
    if (token !== generation.current) return;
    accept(admitted, prepared); onStatus("Assembly volume study loaded and bound to the current physical assembly. Save to retain it in this project.");
  });
  const apply = () => action(async token => {
    const request = JSON.parse(requestText), problem = JSON.parse(problemText);
    assertFieldAssembly(request, physical);
    const value = workerValue(await runLocalWorker({ method: "export_assembly_field_study", params: { request, problem, include_results: false } })) as FieldRecord;
    const { admitted, prepared } = await admit(value);
    if (token === generation.current) accept(admitted, prepared);
  });
  const run = () => action(async token => {
    if (!record || !fieldCanRun(record.request, handoff, unapplied)) return;
    setRecord({ ...record, result: null });
    const result = workerValue(await runLocalWorker({ method: "run_assembly_field_thermal", params: { request: record.request, problem: record.problem } }));
    if (token !== generation.current) return;
    const value = workerValue(await runLocalWorker({ method: "export_assembly_field_study", params: { request: record.request, problem: record.problem, result } })) as FieldRecord;
    if (token === generation.current) { accept(value, handoff!); onStatus("Experimental steady assembly thermal field completed. Save with results to retain the output."); }
  });
  const save = (includeResults: boolean) => action(async token => {
    if (!record || unapplied) return;
    const value = workerValue(await runLocalWorker({ method: "export_assembly_field_study", params: {
      request: record.request, problem: record.problem, result: record.result, include_results: includeResults,
    } })) as FieldRecord;
    const savedResponse = workerValue(await runNativeProjectWorker({ method: "save_assembly_field_study_in_project", params: {
      project_path: projectPath, expected_manifest_payload_sha256: manifestDigest, record: value,
    } }));
    if (token !== generation.current) return;
    accept(savedResponse.record, handoff!);
    // Keep a validated baseline so reset restores the admitted result too.
    saved.current = { record: savedResponse.record, handoff: handoff! };
    setBaseline({ requestText: formatted(savedResponse.record.request), problemText: formatted(savedResponse.record.problem), result: savedResponse.record.result });
    await onUpdated(); onStatus(`Assembly volume study saved ${includeResults ? "with results" : "as setup only"}.`);
  });
  const exportFile = (includeResults: boolean) => action(async () => {
    if (!record || unapplied) return;
    const value = workerValue(await runLocalWorker({ method: "export_assembly_field_study", params: {
      request: record.request, problem: record.problem, result: record.result, include_results: includeResults,
    } }));
    await saveNativeTextFile(`assembly-${record.request.domain}-volume-study.json`, formatted(value), "result");
  });
  const editProblem = (change: (copy: FieldObject) => void) => {
    if (!record) return;
    generation.current++;
    const problem = structuredClone(record.problem); change(problem);
    setRecord({ ...record, problem, result: null }); setProblemText(formatted(problem)); setError("");
  };
  const reset = () => {
    if (!baseline) return;
    generation.current++; setRequestText(baseline.requestText); setProblemText(baseline.problemText); setError("");
    setRecord(saved.current.record); setHandoff(saved.current.handoff);
  };
  const rows = fieldTemperatureRows(unapplied ? null : record?.result ?? null, assembly);
  const field = record?.result?.field_result;
  return <section className="assembly-field-study" aria-label="Assembly volume field study">
    <h4>Assembly volume field study</h4>
    <p>Import conforming tetrahedral volumes for every board, casing and physical structure. Steady solid thermal conduction is experimental. EM and SI volumes and ports can be prepared; their field solvers are not available here.</p>
    <p>Source and layer-stack hashes are caller declarations. Automatic CAD volume meshing, airflow, transient solid thermal and nonlinear radiation are pending. Unrepresented connector or harness links block execution.</p>
    {!projectPath && <p role="status">Save and open the SPIKE project before importing a field study.</p>}
    {loading && <p role="status">Checking the saved volume study…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="assembly-field-actions">
      {error && <button type="button" disabled={disabled || busy || loading || dirty || !projectPath || !manifestDigest} onClick={() => setReload(value => value + 1)}>Reload saved study</button>}
      <button type="button" disabled={locked || dirty} onClick={() => void open()}>Open volume study</button>
      <button type="button" disabled={locked || !dirty} onClick={reset}>Reset drafts</button>
      <button type="button" disabled={locked || !requestText || !problemText} onClick={() => void apply()}>Validate and apply volumes</button>
      <button type="button" className="spike-control--primary" disabled={locked || !fieldCanRun(record?.request ?? null, handoff, unapplied)} onClick={() => void run()}>Run steady thermal</button>
    </div>
    {dirty && <p role="status">Unsaved volume setup or result changes. Save this study or reset its drafts before changing the assembly.</p>}
    {handoff && !unapplied && <>
      <p>{String(record?.request.domain).toUpperCase()} · {handoff.mesh?.counts?.cells ?? 0} volume cells · {handoff.mesh?.counts?.vertices ?? 0} vertices · {handoff.source_traceability?.length ?? 0} physical occurrences</p>
      {!!handoff.execution_issues?.length && <ul aria-label="Field execution blockers">{handoff.execution_issues.map((issue: FieldObject, i: number) => <li key={i}>{issue.code} · {issue.detail || `Retained ${issue.collection} have no field model.`}</li>)}</ul>}
    </>}
    {record?.request.domain === "thermal" && !unapplied && <details><summary>Thermal boundary values</summary>
      <fieldset disabled={locked}>{(record.problem.boundaries ?? []).map((boundary: FieldObject, index: number) => <div className="assembly-field-boundary" key={index}>
        <strong>{fieldOwnerName(assembly, boundary.face.occurrence_id)} · face {boundary.face.face_id} · {boundary.type}</strong>
        {Object.entries({ temperature_k: "Temperature (K)", heat_flux_w_m2: "Inward heat flux (W/m²)", heat_transfer_coefficient_w_m2k: "Convection coefficient (W/m²K)", ambient_temperature_k: "Ambient temperature (K)" }).filter(([key]) => key in boundary).map(([key, label]) => <label key={key}>{label}<input type="number" step="any" value={boundary[key] ?? ""} onChange={event => editProblem(copy => { copy.boundaries[index][key] = event.target.value === "" ? null : Number(event.target.value); })} /></label>)}
      </div>)}</fieldset><p>Sources and matched contact faces are retained in the advanced problem definition below. Unassigned exterior faces are adiabatic.</p>
    </details>}
    <details><summary>Advanced volume request and boundary setup</summary>
      <fieldset disabled={locked}><label>Volume request JSON<textarea rows={10} spellCheck={false} value={requestText} onChange={event => { generation.current++; setRequestText(event.target.value); setHandoff(null); }} /></label>
      <label>Field problem JSON<textarea rows={8} spellCheck={false} value={problemText} onChange={event => { generation.current++; setProblemText(event.target.value); setHandoff(null); }} /></label></fieldset>
    </details>
    {!!rows.length && <><h5>Experimental steady thermal result</h5><DataTable label="Physical occurrence temperatures"><thead><tr><th>Occurrence</th><th>Minimum (K)</th><th>Maximum (K)</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.minimum.toFixed(3)}</td><td>{row.maximum.toFixed(3)}</td></tr>)}</tbody></DataTable>
      <p>Heat balance residual: {field?.heat_balance?.imbalance_w ?? "unavailable"} W. Results retain experimental status; snapshot integrity checks do not establish physical qualification.</p>
      <details><summary>Conservation, convergence and provenance</summary><pre>{formatted({ heat_balance: field?.heat_balance, diagnostics: field?.diagnostics, resources: field?.resources, source_traceability: record?.result?.source_traceability, limitations: record?.result?.limitations })}</pre></details></>}
    <div className="assembly-field-actions">
      <button type="button" disabled={locked || unapplied} onClick={() => void save(false)}>Save setup</button>
      <button type="button" disabled={locked || unapplied || !record?.result} onClick={() => void save(true)}>Save with results</button>
      <button type="button" disabled={locked || unapplied} onClick={() => void exportFile(false)}>Export setup</button>
      <button type="button" disabled={locked || unapplied || !record?.result} onClick={() => void exportFile(true)}>Export with results</button>
    </div>
  </section>;
}
