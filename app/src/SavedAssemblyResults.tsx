// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { runSerializedAutomaticWorker } from "./automaticWorkerQueue";
import CoupledStudyResultTables from "./CoupledStudyResultTables";
import type { AssemblyIr } from "./mcadAssembly";
import { studyDraft } from "./multiboardStudyPresentation";
import { openNativeTextFile, runLocalWorker } from "./workerBridge";
import "./SavedAssemblyResults.css";

type Row = Record<string, any>;
type Domain = "pi" | "si" | "thermal" | "emi";
type LoadedResult = { domain: Domain; result: Row; assembly: AssemblyIr; manifestDigest: string | null };
const domains: Domain[] = ["pi", "si", "thermal", "emi"];
const labels: Record<Domain, string> = { pi: "PI", si: "SI", thermal: "Thermal", emi: "EMI" };

function savedStudies(assembly: AssemblyIr): Partial<Record<Domain, Row>> {
  const value = (assembly.extensions as Row | undefined)?.["spike.multiboard-studies"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(domains.flatMap(domain => value[domain] && typeof value[domain] === "object" && !Array.isArray(value[domain])
    ? [[domain, value[domain]]] : []));
}

export default function SavedAssemblyResults({ assembly, manifestDigest }: { assembly: AssemblyIr; manifestDigest: string | null }) {
  const studies = savedStudies(assembly);
  const [loaded, setLoaded] = useState<LoadedResult | null>(null);
  const [busyDomain, setBusyDomain] = useState<Domain | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setLoaded(null); setBusyDomain(null); setError("");
    return () => { generation.current += 1; };
  }, [assembly, manifestDigest]);

  const validate = async (domain: Domain, record: Row, current: number) => {
    if (!record.request || typeof record.request !== "object" || Array.isArray(record.request)
      || typeof record.request.contract !== "string") throw new Error(`The saved ${labels[domain]} setup is unavailable or malformed. Reopen the project, review the setup, and rerun the study.`);
    if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)
      || typeof record.result.status !== "string") throw new Error(`The saved ${labels[domain]} result data is unavailable or malformed. Reopen the project, review the setup, and rerun the study.`);
    const prepared = await runLocalWorker({ method: "prepare_multiboard_study", params: { request: { assembly, domain } } });
    if (!prepared.ok || !prepared.result) throw new Error(prepared.error || `Could not prepare the ${labels[domain]} study for validation.`);
    const preparedValue = prepared.result as Row;
    if (record.assembly_digest !== preparedValue.assembly_digest) throw new Error(`This saved ${labels[domain]} result belongs to an older assembly revision. Review the setup and rerun the study.`);
    const request = studyDraft(record.request, domain);
    const checked = await runLocalWorker({ method: "validate_multiboard_study_result", params: {
      assembly: preparedValue.request?.assembly, domain, request, result: record.result,
    } });
    if (!checked.ok) throw new Error(checked.error || `The saved ${labels[domain]} result is invalid. Review the setup and rerun the study.`);
    if (current !== generation.current) return;
    setLoaded({ domain, result: record.result, assembly, manifestDigest });
  };

  const runValidation = async (domain: Domain, record: Row) => {
    const current = ++generation.current;
    setBusyDomain(domain); setLoaded(null); setError("");
    try {
      await runSerializedAutomaticWorker(() => validate(domain, record, current), () => current === generation.current);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (current === generation.current) setBusyDomain(null);
    }
  };

  const chooseFile = async (domain: Domain) => {
    const current = ++generation.current;
    setBusyDomain(domain); setLoaded(null); setError("");
    try {
      const file = await openNativeTextFile("result");
      if (!file || current !== generation.current) return;
      if (file.contents.length > 8 * 1024 * 1024) throw new Error("Study file exceeds 8 MiB.");
      const record = JSON.parse(file.contents) as Row;
      if (record.contract !== "spike/multiboard-study-file/v1" || record.domain !== domain || !record.result) {
        throw new Error(`Choose a ${labels[domain]} coupled study file containing results.`);
      }
      await runSerializedAutomaticWorker(() => validate(domain, record, current), () => current === generation.current);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (current === generation.current) setBusyDomain(null);
    }
  };

  const inventory = domains.map(domain => ({ domain, study: studies[domain] ?? {} }));
  return <section className="saved-assembly-results" aria-label="Saved coupled assembly results">
    <h3>Saved assembly results</h3>
    <p>Select a retained result to validate it against the current assembly and show its numerical details here.</p>
    <div className="saved-assembly-results-inventory">{inventory.map(({ domain, study }) => {
      const hasResult = Object.prototype.hasOwnProperty.call(study, "result") && study.result != null;
      const result = hasResult && typeof study.result === "object" && !Array.isArray(study.result) ? study.result as Row : null;
      return <div key={domain} className="saved-assembly-result-row">
        <span><b>{labels[domain]}</b><small>{hasResult ? `${String(result?.status ?? "saved result requires review")} · ${String(result?.model_status ?? "status unspecified")}` : study.request ? "Setup saved; no retained result" : "No saved result"}</small></span>
        {hasResult
          ? <button type="button" disabled={busyDomain !== null} onClick={() => void runValidation(domain, study)}>{busyDomain === domain ? "Checking…" : `Show ${labels[domain]} result`}</button>
          : <button type="button" disabled={busyDomain !== null} onClick={() => void chooseFile(domain)}>{busyDomain === domain ? "Checking…" : "Find result file"}</button>}
      </div>;
    })}</div>
    {error && <p role="alert">{error}</p>}
    {loaded && loaded.assembly === assembly && loaded.manifestDigest === manifestDigest
      && <CoupledStudyResultTables assembly={assembly} domain={loaded.domain} result={loaded.result} />}
  </section>;
}
