// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import DataTable from "./DataTable";
import { studyOwnerName } from "./AssemblyMechanicalStudyModels";
import type { AssemblyIr } from "./mcadAssembly";
import { studyResultRows, studyElementResultRows, studyResultSummary } from "./multiboardStudyPresentation";
import "./multiboardStudyEditor.css";

type Row = Record<string, any>;
export default function CoupledStudyResultTables({ assembly, result, domain }: {
  assembly: AssemblyIr; result: Row; domain: "pi" | "si" | "thermal" | "emi";
}) {
  const [point, setPoint] = useState(0);
  useEffect(() => setPoint(0), [result, domain]);
  const frequencies: number[] = result.native_result?.data?.frequency_hz ?? result.samples?.map((sample: Row) => sample.frequency_hz) ?? [];
  const selectedPoint = Math.min(point, Math.max(0, frequencies.length - 1));
  const rows = studyResultRows(result, domain, selectedPoint);
  const elements = studyElementResultRows(result, selectedPoint);
  const owner = (row: { board: string; owner_kind?: "part" }) => studyOwnerName(assembly, { [row.owner_kind === "part" ? "part_id" : "board_id"]: row.board });
  return <section className="coupled-study-tables" aria-label="Coupled study results">
    <h5>{domain.toUpperCase()} results</h5>
    <p>Result: {String(result.status)} · {String(result.model_status)} · production qualified: {String(result.production_qualified)}</p>
    {frequencies.length > 0 && <label>Result frequency<select value={selectedPoint} onChange={event => setPoint(Number(event.target.value))}>{frequencies.map((frequency, i) => <option key={i} value={i}>{frequency} Hz</option>)}</select></label>}
    <DataTable label="Multiboard study results"><thead><tr><th>Board / structure</th><th>Node / loop</th><th>Value</th><th>Unit</th></tr></thead><tbody>{rows.map(row => <tr key={JSON.stringify([row.owner_kind ?? "board", row.board, row.node])}><td>{owner(row)}</td><td>{row.node}</td><td>{row.value === undefined ? "Unavailable" : String(row.value)}</td><td>{row.unit}</td></tr>)}</tbody></DataTable>
    {elements.length > 0 && <><h5>Element currents and power</h5><p>Signed quantities follow the model's terminal direction and passive power convention; negative active power indicates supply.</p><DataTable label="Coupled element currents and power"><thead><tr><th>Board / structure</th><th>Element</th><th>Quantity</th><th>Value</th><th>Unit</th></tr></thead><tbody>{elements.map(row => <tr key={JSON.stringify([row.owner_kind ?? "board", row.board, row.element, row.quantity])}><td>{owner(row)}</td><td>{row.element}</td><td>{row.quantity}</td><td>{row.value}</td><td>{row.unit}</td></tr>)}</tbody></DataTable></>}
    <details><summary>Conservation, diagnostics and limitations</summary><pre>{JSON.stringify(studyResultSummary(result), null, 2)}</pre></details>
  </section>;
}
