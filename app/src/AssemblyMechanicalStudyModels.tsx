// SPDX-License-Identifier: Apache-2.0
import type { AssemblyIr } from "./mcadAssembly";

type Row = Record<string, any>;
type Props = { assembly: AssemblyIr; draft: Row; domain: string; edit: (change: (copy: Row) => void) => void };
export function studyOwnerName(assembly: AssemblyIr, row: Row): string {
  const id = row.board_id ?? row.part_id;
  const item = (row.part_id ? assembly.parts : assembly.boards).find(item => item.id === id);
  return String(item?.name || (row.part_id ? "Mechanical part" : "Board"));
}
function Numeric({ row, field, label, change }: { row: Row; field: string; label: string; change: (value: number | null) => void }) {
  return <label>{label}<input type="number" step="any" aria-label={label} value={row[field] ?? ""} placeholder="Required model value" onChange={event => change(event.target.value === "" ? null : Number(event.target.value))}/></label>;
}
/** Forms retain explicit model data; the worker owns all physical validation. */
export default function AssemblyMechanicalStudyModels({ assembly, draft, domain, edit }: Props) {
  if (domain === "emi") return null;
  const thermal = domain === "thermal";
  const parts: Row[] = draft.part_models ?? [];
  return <>
    {parts.length > 0 && <section aria-label="Mechanical structure models"><h5>Casings, heatsinks &amp; mechanical structures</h5>
      <p>{thermal ? "Each structure has its own heat sources, ambient path and thermal mass. Contacts and radiation connect it to the boards. Thermal mass is required for transient models." : "Define passive R/L/C paths for each structure and explicit bonds to board terminals. A metal casing is not automatically ground."} Material names and visible STEP bodies do not supply these numerical properties.</p>
      {parts.map((part, i) => <details key={part.part_id} open><summary>{studyOwnerName(assembly, part)} · {thermal ? "thermal body" : "passive circuit"}</summary>
        {part.elements.map((node: Row, j: number) => <div className="field-row" key={j}>
          {!thermal && <label>Element type<select aria-label="Mechanical element type" value={node.type} onChange={event => edit(copy => { const type = event.target.value; const field = type === "resistor" ? "resistance_ohm" : type === "inductor" ? "inductance_h" : "capacitance_f"; copy.part_models[i].elements[j] = { id: node.id, type, positive_node: node.positive_node, negative_node: node.negative_node, [field]: null }; })}>{["resistor", "inductor", "capacitor"].map(type => <option key={type}>{type}</option>)}</select></label>}
          {(thermal ? ["id"] : ["id", "positive_node", "negative_node"]).map(field => <label key={field}>{field === "id" ? (thermal ? "Thermal node" : "Element name") : field.replace(/_/g, " ")}<input value={node[field] ?? ""} onChange={event => edit(copy => { copy.part_models[i].elements[j][field] = event.target.value; })}/></label>)}
          {(thermal ? [["power_w", "Dissipation (W)"], ["ambient_resistance_c_per_w", "Ambient path (K/W)"], ["thermal_capacitance_j_per_c", "Thermal mass (J/K)"]] : [[node.type === "resistor" ? "resistance_ohm" : node.type === "inductor" ? "inductance_h" : "capacitance_f", node.type === "resistor" ? "Resistance (Ω)" : node.type === "inductor" ? "Inductance (H)" : "Capacitance (F)"]]).map(([field, label]) => <Numeric key={field} row={node} field={field} label={label} change={value => edit(copy => { if (thermal && value === null && field !== "power_w") delete copy.part_models[i].elements[j][field]; else copy.part_models[i].elements[j][field] = value; })}/>)}
          <button type="button" className="spike-control--danger" onClick={() => edit(copy => { copy.part_models[i].elements.splice(j, 1); })}>Remove {thermal ? "node" : "element"}</button>
        </div>)}
        <button type="button" onClick={() => edit(copy => { copy.part_models[i].elements.push(thermal ? { id: `body${part.elements.length + 1}`, power_w: null } : { id: `e${part.elements.length + 1}`, type: "resistor", positive_node: "", negative_node: "", resistance_ohm: null }); })}>Add {thermal ? "thermal node" : "passive element"}</button>
      </details>)}
    </section>}
    {!thermal && (draft.electrical_bond_models ?? []).length > 0 && <section aria-label="Electrical structure bonds"><h5>Board and chassis bonds</h5><p>Map each saved mechanical bond to explicit circuit nodes. R and L include the bond/contact path.</p>
      {draft.electrical_bond_models.map((bond: Row, i: number) => <details key={bond.bond_id} open><summary>{studyOwnerName(assembly, bond.endpoint_a)} ↔ {studyOwnerName(assembly, bond.endpoint_b)}</summary><div className="field-row">
        {["endpoint_a", "endpoint_b"].map(field => <label key={field}>{studyOwnerName(assembly, bond[field])} · local node<input aria-label={`${field} local node`} value={bond[field].node} onChange={event => edit(copy => { copy.electrical_bond_models[i][field].node = event.target.value; })}/></label>)}
        {[["resistance_ohm", "Bond R (Ω)"], ["inductance_h", "Bond L (H)"]].map(([field, label]) => <Numeric key={field} row={bond} field={field} label={label} change={value => edit(copy => { copy.electrical_bond_models[i][field] = value; })}/>)}
      </div></details>)}
    </section>}
  </>;
}
