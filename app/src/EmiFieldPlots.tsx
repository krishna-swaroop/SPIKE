import { useMemo } from "react";
import DataTable from "./DataTable";
import PlotlyChart from "./PlotlyChart";
import type { EmiFarFieldResult } from "./EmiWorkbench";
import { emiSpectrum, fieldDbUvM } from "./emiFieldData";

export function EmiFieldPlots({ field, frequencyIndex, onFrequency }: { field: EmiFarFieldResult; frequencyIndex: number; onFrequency: (index: number) => void }) {
  const rows = useMemo(() => emiSpectrum(field), [field]);
  const nt = field.theta_deg.length, np = field.phi_deg.length;
  const peak = rows[frequencyIndex]?.db;
  const angular = Array.from({ length: nt }, (_, thetaIndex) => Array.from({ length: np }, (_, phiIndex) =>
    fieldDbUvM(field.e_field_v_m.magnitude[(frequencyIndex * nt + thetaIndex) * np + phiIndex])));
  return <>
    <div className="emi-spectrum"><h3>Radiated field spectrum · {field.radius_m} m</h3>
      <PlotlyChart title="Peak total electric field over sampled directions" revision={`emi-spectrum:${frequencyIndex}:${rows.map(row => `${row.frequency}:${row.db}`).join(",")}`}
        data={[{ type: "scatter", mode: "lines+markers", name: "Angular peak, total E", x: rows.map(row => row.frequency), y: rows.map(row => row.db), connectgaps: false,
          line: { color: "#64dacf", width: 2 }, marker: { color: rows.map((_, index) => index === frequencyIndex ? "#ffc673" : "#64dacf"), size: rows.map((_, index) => index === frequencyIndex ? 10 : 6) },
          hovertemplate: "%{x:.6g} Hz<br>%{y:.4f} dBµV/m<extra></extra>" }]}
        layout={{ margin: { l: 70, r: 20, t: 18, b: 55 }, xaxis: { title: "Frequency (Hz)", type: "log" }, yaxis: { title: "Angular peak total E (dBµV/m)" }, showlegend: false }}
        onPointClick={point => { const index = rows.findIndex(row => row.frequency === point.x); if (index >= 0) onFrequency(index); }} />
      <p className="emi-note">Computed total-field angular envelope at the result radius. No receiver detector, antenna factor or regulatory limit has been applied.</p>
      <DataTable label="EMI far-field frequency peaks"><thead><tr><th>MHz</th><th>dBµV/m</th><th>θ / φ peak</th></tr></thead><tbody>{rows.map((row, i) => <tr key={i}><td><button onClick={() => onFrequency(i)}>{(row.frequency / 1e6).toFixed(3)}</button></td><td>{row.db?.toFixed(2) ?? "Zero"}</td><td>{row.theta}° / {row.phi}°</td></tr>)}</tbody></DataTable>
    </div>
    <div className="emi-angular-map"><h3>Angular field map · {(rows[frequencyIndex].frequency / 1e6).toFixed(3)} MHz</h3><PlotlyChart title="Theta phi electric field map, 40 dB below peak to peak"
      revision={`emi-angular:${frequencyIndex}:${field.frequencies_hz[frequencyIndex]}`} data={[{ type: "heatmap", x: field.phi_deg, y: field.theta_deg, z: angular, connectgaps: false,
        zmin: peak === null || peak === undefined ? undefined : peak - 40, zmax: peak ?? undefined, colorscale: [[0, "hsl(225 75% 18%)"], [1, "hsl(30 75% 58%)"]], colorbar: { title: "dBµV/m" },
        hovertemplate: "θ %{y}°<br>φ %{x}°<br>%{z:.4f} dBµV/m<extra></extra>" }]}
      layout={{ margin: { l: 60, r: 70, t: 18, b: 50 }, xaxis: { title: "Phi (deg)" }, yaxis: { title: "Theta (deg)", autorange: "reversed" } }} /></div>
  </>;
}
