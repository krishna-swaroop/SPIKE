// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import DataTable from "./DataTable";
import AssemblyMechanicalStudyModels, { studyOwnerName } from "./AssemblyMechanicalStudyModels";
import type { AssemblyIr } from "./mcadAssembly";
import { openNativeTextFile, runLocalWorker, runNativeProjectWorker, saveNativeTextFile } from "./workerBridge";
import { studyDraft, studyResultRows, studyResultSummary } from "./multiboardStudyPresentation";
import "./multiboardStudyEditor.css";

type Row = Record<string, any>;
type Domain = "pi" | "si" | "thermal" | "emi";
const labels: Record<Domain, string> = { pi: "PI · shared DC/AC circuit", si: "SI · shared AC circuit", thermal: "Thermal · shared RC network", emi: "EM · mutual magnetic loops" };
const methods: Record<Domain, string> = { pi: "run_multiboard_circuit", si: "run_multiboard_circuit", thermal: "run_multiboard_thermal", emi: "run_multiboard_em" };
export type StudyEditorSnapshot = { rawDraft: string; result: Row | null };
type StudyBaseline = StudyEditorSnapshot;
export const studyEditorStateDirty = (current: StudyEditorSnapshot, baseline: StudyEditorSnapshot | null) =>
  baseline !== null && (current.rawDraft !== baseline.rawDraft || current.result !== baseline.result);

function NumberField({ row, field, label, change }: { row: Row; field: string; label: string; change: (field: string, value: number | null) => void }) {
  return <label>{label}<input type="number" step="any" aria-label={label} value={row[field] ?? ""} placeholder="Required model value" onChange={event => change(field, event.target.value === "" ? null : Number(event.target.value))} /></label>;
}

/** The worker owns topology, models, units, validation and numerical execution. */
export default function MultiboardStudyEditor({ assembly, projectPath, manifestDigest, disabled, onUpdated, onStatus, onDirtyChange }: {
  assembly: AssemblyIr; projectPath: string | null; manifestDigest: string | null; disabled: boolean;
  onUpdated: () => Promise<void>; onStatus: (message: string) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [domain, setDomain] = useState<Domain>("pi");
  const [draft, setDraft] = useState<Row | null>(null);
  const [physicalAssembly, setPhysicalAssembly] = useState<Row | null>(null);
  const [digest, setDigest] = useState("");
  const [result, setResult] = useState<Row | null>(null);
  const [displayPoint, setDisplayPoint] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawDraft, setRawDraft] = useState("");
  const [baseline, setBaseline] = useState<StudyBaseline | null>(null);
  const [pendingDomain, setPendingDomain] = useState<Domain | null>(null);
  const generation = useRef(0);
  const studyDirty = studyEditorStateDirty({ rawDraft, result }, baseline);
  useEffect(() => { setDisplayPoint(0); }, [result]);
  useEffect(() => { onDirtyChange?.(studyDirty); }, [onDirtyChange, studyDirty]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    setDraft(null); setResult(null); setError(""); setDigest(""); setPhysicalAssembly(null); setBaseline(null); setPendingDomain(null);
    void runLocalWorker({ method: "prepare_multiboard_study", params: { request: { assembly, domain } } }).then(async response => {
      if (!active || current !== generation.current) return;
      if (!response.ok || !response.result) throw new Error(response.error || "Study preparation failed.");
      const prepared = response.result as Row;
      const saved = (assembly.extensions as Row | undefined)?.["spike.multiboard-studies"]?.[domain];
      const request = studyDraft(saved?.request ?? prepared.request, domain);
      const serialized = JSON.stringify(request, null, 2);
      let retainedResult: Row | null = null;
      if (saved?.assembly_digest === prepared.assembly_digest && saved.result) {
        const validation = await runLocalWorker({ method: "validate_multiboard_study_result", params: {
          assembly: prepared.request.assembly, domain, request, result: saved.result,
        } });
        if (!active || current !== generation.current) return;
        if (validation.ok) retainedResult = saved.result;
        else setError(validation.error || "Saved result does not match its setup. Rerun the study.");
      }
      else if (saved && saved.assembly_digest !== prepared.assembly_digest) setError("Assembly changed since the saved study. Review models and rerun; old results are not active.");
      if (!active || current !== generation.current) return;
      setPhysicalAssembly(prepared.request.assembly); setDigest(prepared.assembly_digest);
      setDraft(request); setRawDraft(serialized); setResult(retainedResult);
      setBaseline({ rawDraft: serialized, result: retainedResult });
    }).catch(caught => { if (active) setError(String(caught)); });
    return () => { active = false; generation.current++; };
  }, [assembly, domain, manifestDigest]);
  const edit = (change: (copy: Row) => void) => {
    if (!draft) return;
    generation.current++;
    const copy = structuredClone(draft); change(copy);
    setDraft(copy); setRawDraft(JSON.stringify(copy, null, 2)); setResult(null); setError("");
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (caught) { setError(String(caught)); onStatus(String(caught)); }
    finally { setBusy(false); }
  };
  const run = () => action(async () => {
    if (!draft || !physicalAssembly) return;
    const current = generation.current;
    setResult(null);
    const response = await runLocalWorker({ method: methods[domain], params: { request: { ...draft, assembly: physicalAssembly } } });
    if (current !== generation.current) return;
    if (!response.ok || !response.result) throw new Error(response.error || "Coupled solver returned no result.");
    setResult(response.result); onStatus(`${domain.toUpperCase()} coupled model: ${response.result.status}. Save the study to retain its setup and results.`);
  });
  const save = (includeResults: boolean) => action(async () => {
    if (!draft) return;
    const response = await runNativeProjectWorker({ method: "save_multiboard_study_in_project", params: {
      project_path: projectPath, expected_manifest_payload_sha256: manifestDigest, domain,
      assembly_digest: digest, request: draft, result: includeResults ? result : null,
    } });
    if (!response.ok) throw new Error(response.error || "Study save failed.");
    setBaseline({ rawDraft: JSON.stringify(draft, null, 2), result: includeResults ? result : null });
    await onUpdated(); onStatus(`Saved ${domain.toUpperCase()} coupled study ${includeResults ? "with results" : "setup"} in the SPIKE project.`);
  });
  const load = () => action(async () => {
    const current = generation.current;
    const file = await openNativeTextFile("result"); if (!file) return;
    if (file.contents.length > 8 * 1024 * 1024) throw new Error("Study file exceeds 8 MiB.");
    const value = JSON.parse(file.contents);
    if (value.contract !== "spike/multiboard-study-file/v1" || value.domain !== domain || value.assembly_digest !== digest) throw new Error("Choose a study file for this domain and exact physical assembly.");
    const response = await runLocalWorker({ method: "validate_multiboard_study_result", params: { assembly: physicalAssembly, domain, request: value.request, result: value.result } });
    if (current !== generation.current) return;
    if (!response.ok) throw new Error(response.error || "Study file binding failed.");
    const imported = studyDraft(value.request, domain);
    generation.current++;
    setDraft(imported); setRawDraft(JSON.stringify(imported, null, 2)); setResult(value.result ?? null);
    onStatus(`Loaded ${domain.toUpperCase()} setup and retained results. Imported results retain their original experimental status.`);
  });
  const exportFile = () => action(async () => { await saveNativeTextFile(`assembly-${domain}-study.json`, JSON.stringify({
    contract: "spike/multiboard-study-file/v1", domain, assembly_digest: digest, request: draft, result,
  }, null, 2), "result"); });
  const resetStudy = () => {
    if (!baseline) return;
    generation.current++;
    const restored = studyDraft(JSON.parse(baseline.rawDraft), domain);
    setDraft(restored); setRawDraft(baseline.rawDraft); setResult(baseline.result); setError(""); setPendingDomain(null);
  };
  const chooseDomain = (next: Domain) => {
    if (next === domain) return;
    if (studyDirty) setPendingDomain(next);
    else setDomain(next);
  };
  const locked = disabled || busy;
  const unapplied = !!draft && rawDraft !== JSON.stringify(draft, null, 2);
  const resultRows = result ? studyResultRows(result, domain, displayPoint) : [];
  const resultFrequencies = result?.native_result?.data?.frequency_hz ?? result?.samples?.map((sample: Row) => sample.frequency_hz) ?? [];
  const number = (row: Row, field: string, label: string, change: (field: string, value: number | null) => void) =>
    <NumberField key={field} row={row} field={field} label={label} change={change} />;
  const linkFields = [["resistance_ohm", "Conductor R (Ω)"], ["inductance_h", "Conductor L (H)"],
    ["contact_a_resistance_ohm", "Connector A R (Ω)"], ["contact_b_resistance_ohm", "Connector B R (Ω)"],
    ["contact_a_inductance_h", "Connector A L (H)"], ["contact_b_inductance_h", "Connector B L (H)"]] as const;
  return <section className="multiboard-study"><h4>Coupled assembly analysis</h4>
    <p>Boards and physical mechanical structures share one reduced-model solve. Define measured or extracted properties for each occurrence and connection. Blank values require review; 0 explicitly means an ideal property. These models are experimental.</p>
    <label>Study <select disabled={busy} value={domain} onChange={event => chooseDomain(event.target.value as Domain)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {pendingDomain && <div className="multiboard-study-dirty-warning" role="alert"><span>Switching to {labels[pendingDomain]} will discard unsaved setup or result changes.</span><button type="button" onClick={() => setPendingDomain(null)}>Keep current study</button><button type="button" onClick={() => { const next = pendingDomain; setPendingDomain(null); setDomain(next); }}>Discard changes and switch</button></div>}
    {studyDirty && <div className="multiboard-study-dirty-warning" role="status"><span>This study has unsaved setup or result changes.</span><button type="button" disabled={busy} onClick={resetStudy}>Reset to saved study</button></div>}
    {draft && <fieldset disabled={locked}>
      {(domain === "pi" || domain === "si") && <>
        <p>Use board-local terminal names <code>connector:pin</code> (for example <code>J1:2</code>). Model the supply, load, board copper and return explicitly. A node named 0 on another board is not automatically grounded.</p>
        <label>Ground owner <select aria-label="Ground owner" value={`${draft.ground.part_id ? "part" : "board"}:${draft.ground.part_id ?? draft.ground.board_id}`} onChange={event => edit(copy => { const colon = event.target.value.indexOf(":"); const kind = event.target.value.slice(0, colon); const id = event.target.value.slice(colon + 1); copy.ground = { [kind === "part" ? "part_id" : "board_id"]: id, node: "" }; })}>{assembly.boards.map(b => <option key={`board:${b.id}`} value={`board:${b.id}`}>{String(b.name || "Board")}</option>)}{(draft.part_models ?? []).map((p: Row) => <option key={`part:${p.part_id}`} value={`part:${p.part_id}`}>{studyOwnerName(assembly, p)} · mechanical</option>)}</select></label>
        <label>Ground local node <input value={draft.ground.node} onChange={event => edit(copy => { copy.ground.node = event.target.value; })} /></label>
        {draft.board_models.map((board: Row, i: number) => <details key={board.board_id} open><summary>Board circuit · {board.board_id}</summary>
          <p>Native linear R/L/C/source elements, in SI units. Add elements, then define both terminals and values. Advanced model JSON also supports controlled sources.</p>
          {board.elements.map((element: Row, j: number) => <div className="field-row" key={j}>
            <label>Type <select value={element.type} onChange={event => edit(copy => { copy.board_models[i].elements[j] = { id: element.id, type: event.target.value, positive_node: element.positive_node, negative_node: element.negative_node }; })}>{["resistor", "inductor", "capacitor", "voltage_source", "current_source"].map(type => <option key={type}>{type}</option>)}</select></label>
            {["id", "positive_node", "negative_node"].map(field => <label key={field}>{field.replace(/_/g, " ")}<input value={element[field] ?? ""} onChange={event => edit(copy => { copy.board_models[i].elements[j][field] = event.target.value; })} /></label>)}
            {(element.type.endsWith("source") ? [["dc_value", "DC value (V/A)"], ["ac_magnitude", "AC RMS magnitude (V/A)"], ["ac_phase_deg", "AC phase (°)"]] : [[element.type === "resistor" ? "resistance_ohm" : element.type === "inductor" ? "inductance_h" : "capacitance_f", "Value (Ω/H/F)"]]).map(([field, label]) => number(element, field, label, (f, v) => edit(copy => { copy.board_models[i].elements[j][f] = v; })))}
            <button onClick={() => edit(copy => { copy.board_models[i].elements.splice(j, 1); })}>Remove element</button>
          </div>)}
          <button onClick={() => edit(copy => { copy.board_models[i].elements.push({ id: `e${board.elements.length + 1}`, type: "resistor", positive_node: "", negative_node: "", resistance_ohm: null }); })}>Add circuit element</button>
        </details>)}
        {draft.link_models.map((link: Row, i: number) => <details key={link.link_id} open><summary>{link.kind} · {link.link_id} · connector properties</summary>
          {link.pins.map((pin: Row, j: number) => <div key={j}><strong>{pin.source_pin} → {pin.target_pin}</strong><div className="field-row">{linkFields.map(([f, label]) => number(pin, f, label, (field, value) => edit(copy => { copy.link_models[i].pins[j][field] = value; })))}</div></div>)}
          <p>Optional π capacitance needs an explicit reference node in model JSON. Harness R/L and each endpoint contact R/L are retained separately.</p>
        </details>)}
        {domain === "si" && <div className="field-row">{[["start_hz", "Start (Hz)"], ["stop_hz", "Stop (Hz)"], ["points", "Frequency points"]].map(([field, label]) => number(draft.analysis, field, label, (f, v) => edit(copy => { copy.analysis[f] = v; })))}</div>}
      </>}
      {domain === "thermal" && <>
        <p>Radiation surfaces use explicit area, emissivity and reciprocal view factors in model JSON (radiation_surfaces). View factors must close to one including ambient. They are not inferred from viewport separation. Retained contacts can represent standoffs.</p>
        <p>Define board and structure nodes, dissipation and ambient paths below. Add physical contacts in the assembly Thermal contacts editor. Internal spreading links and radiation surfaces can be entered in model JSON. Enclosed bodies can omit an ambient resistance and transfer heat through their contacts or explicit radiation paths.</p>
        <label>Thermal mode<select aria-label="Thermal mode" value={draft.mode} onChange={event => edit(copy => { copy.mode = event.target.value; })}><option value="steady_state">Steady state</option><option value="transient">Transient</option></select></label>
        {draft.mode === "transient" && <div className="field-row">{[["time_step_s", "Time step (s)"], ["duration_s", "Duration (s)"]].map(([field, label]) => number(draft, field, label, (f, v) => edit(copy => { copy[f] = v; })))}</div>}
        {number(draft, "ambient_temperature_c", "Ambient (°C)", (f, v) => edit(copy => { copy[f] = v; }))}
        {draft.board_models.map((board: Row, i: number) => <div key={board.board_id}><strong>{studyOwnerName(assembly, board)}</strong>{board.elements.map((node: Row, j: number) => <div className="field-row" key={node.id}><code>{node.id}</code>{[["power_w", "Power (W)"], ["ambient_resistance_c_per_w", "Ambient resistance (K/W)"], ["thermal_capacitance_j_per_c", "Thermal mass (J/K)"]].map(([field, label]) => number(node, field, label, (f, v) => edit(copy => { if (v === null && f !== "power_w") delete copy.board_models[i].elements[j][f]; else copy.board_models[i].elements[j][f] = v; })))}</div>)}</div>)}
        {draft.contact_models.map((contact: Row, i: number) => <details key={contact.contact_id} open><summary>{studyOwnerName(assembly, contact.from)} → {studyOwnerName(assembly, contact.to)}</summary><div className="field-row">{["from", "to"].map(field => <label key={field}>{studyOwnerName(assembly, contact[field])} · thermal node<input value={contact[field].node} onChange={event => edit(copy => { copy.contact_models[i][field].node = event.target.value; })}/></label>)}{number(contact, "conductance_w_per_k", "Contact conductance (W/K)", (f, v) => edit(copy => { copy.contact_models[i][f] = v; }))}</div></details>)}
      </>}
      {domain === "emi" && <>
        <p>Quasi-static magnetic coupling of explicit closed loops on boards and conductive mechanical structures. Supply mutual inductance extracted or measured for this assembly placement. This does not calculate radiation, general shielding, electric-field coupling or EMI compliance.</p>
        <label>Frequencies (Hz, comma separated)<input value={draft.frequency_hz.join(", ")} onChange={event => edit(copy => { copy.frequency_hz = event.target.value.split(",").filter(v => v.trim()).map(Number); })} /></label>
        {draft.loops.map((loop: Row, i: number) => <div key={loop.loop_id}><strong>{studyOwnerName(assembly, loop)} · {loop.part_id ? "structure" : "board"} loop</strong><div className="field-row">{[["resistance_ohm", "Loop R (Ω)"], ["self_inductance_h", "Loop L (H)"], ["voltage_real_v", "Drive real RMS (V)"], ["voltage_imag_v", "Drive imaginary RMS (V)"]].map(([field, label]) => number(loop, field, label, (f, v) => edit(copy => { copy.loops[i][f] = v; })))}</div></div>)}
        {draft.mutual_inductances.map((pair: Row, i: number) => <div key={i}><strong>{pair.loop_a} ↔ {pair.loop_b}</strong>{number(pair, "mutual_inductance_h", "Signed mutual inductance (H)", (f, v) => edit(copy => { copy.mutual_inductances[i][f] = v; }))}</div>)}
        <h5>Connector contacts in magnetic loops</h5>
        {draft.connector_models.map((contact: Row, i: number) => <div className="field-row" key={i}>
          <label>Loop <select value={contact.loop_id} onChange={event => edit(copy => { const loop = copy.loops.find((row: Row) => row.loop_id === event.target.value); copy.connector_models[i].loop_id = loop.loop_id; copy.connector_models[i].board_id = loop.board_id; })}>{draft.loops.filter((loop: Row) => loop.board_id).map((loop: Row) => <option key={loop.loop_id} value={loop.loop_id}>{studyOwnerName(assembly, loop)}</option>)}</select></label>
          {["connector_id", "pin"].map(field => <label key={field}>{field}<input value={contact[field]} onChange={event => edit(copy => { copy.connector_models[i][field] = event.target.value; })} /></label>)}
          {[["resistance_ohm", "Contact R (Ω)"], ["inductance_h", "Contact L (H)"]].map(([field, label]) => number(contact, field, label, (f, v) => edit(copy => { copy.connector_models[i][f] = v; })))}
          <button onClick={() => edit(copy => { copy.connector_models.splice(i, 1); })}>Remove contact</button>
        </div>)}
        <button disabled={!draft.loops.some((loop: Row) => loop.board_id)} onClick={() => edit(copy => { const loop = copy.loops.find((row: Row) => row.board_id); copy.connector_models.push({ loop_id: loop.loop_id, board_id: loop.board_id, connector_id: "", pin: "", resistance_ohm: null, inductance_h: null }); })}>Add connector contact to loop</button>
        <p>Each contact identifies a retained connector and physical pin on its loop board.</p>
      </>}
      <AssemblyMechanicalStudyModels assembly={assembly} draft={draft} domain={domain} edit={edit}/>
      <details><summary>Advanced model JSON / extracted model import</summary><textarea aria-label="Coupled study model JSON" rows={14} value={rawDraft} onChange={event => { generation.current++; setRawDraft(event.target.value); setResult(null); }} /><button onClick={() => { try { const parsed = studyDraft(JSON.parse(rawDraft), domain); generation.current++; setDraft(parsed); setRawDraft(JSON.stringify(parsed, null, 2)); setResult(null); setError(""); } catch (caught) { setError(String(caught)); } }}>Apply model JSON</button></details>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <div className="field-row"><button disabled={locked || !draft || unapplied} onClick={() => void run()}>Run coupled {domain.toUpperCase()}</button>
      <button disabled={locked || !draft || unapplied || !projectPath || !manifestDigest} onClick={() => void save(false)}>Save study setup</button>
      <button disabled={locked || !result || unapplied || !projectPath || !manifestDigest} onClick={() => void save(true)}>Save study with results</button>
      <button disabled={locked || !draft || unapplied} onClick={() => void exportFile()}>Export setup / results file</button>
      <button disabled={locked || !digest} onClick={() => void load()}>Open setup / results file</button></div>
    {result && <><p>Result: {String(result.status)} · {String(result.model_status)} · production qualified: {String(result.production_qualified)}</p>
      {resultFrequencies.length > 0 && <label>Result frequency <select value={displayPoint} onChange={event => setDisplayPoint(Number(event.target.value))}>{resultFrequencies.map((frequency: number, i: number) => <option key={i} value={i}>{frequency} Hz</option>)}</select></label>}
      <p>Full sweeps are retained in the project and exported study file.</p>
      <DataTable label="Multiboard study results" className="data-table"><thead><tr><th>Board / structure</th><th>Node / loop</th><th>Value</th><th>Unit</th></tr></thead><tbody>{resultRows.map(row => <tr key={JSON.stringify([row.owner_kind ?? "board", row.board, row.node])}><td>{studyOwnerName(assembly, { [row.owner_kind === "part" ? "part_id" : "board_id"]: row.board })}</td><td>{row.node}</td><td>{row.value === undefined ? "Unavailable" : String(row.value)}</td><td>{row.unit}</td></tr>)}</tbody></DataTable>
      <details><summary>Conservation, diagnostics and limitations</summary><pre>{JSON.stringify(studyResultSummary(result), null, 2)}</pre></details></>}
  </section>;
}
